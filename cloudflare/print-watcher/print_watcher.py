#!/usr/bin/env python3
"""
Print-finished detector for the lab camera hub.

Samples a short burst of frames from go2rtc, compares consecutive frames for motion,
and sends a Telegram alert when the printer looks stopped (confirmed by two bursts
back-to-back, not 30 minutes apart).

Telegram goes through the Cloudflare Worker (works when the lab network blocks api.telegram.org).
"""

from __future__ import annotations

import io
import json
import logging
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path

import requests
from PIL import Image, ImageChops, ImageStat

LOG = logging.getLogger("print_watcher")

DEFAULT_CONFIG_PATH = Path.home() / ".config/lab-camera" / "print-watcher.json"
DEFAULT_STATE_PATH = Path.home() / ".config/lab-camera" / "print-watcher-state.json"


@dataclass
class Config:
    go2rtc_base_url: str
    go2rtc_stream: str
    worker_url: str
    internal_secret: str
    motion_threshold: float
    burst_frames: int
    burst_interval_sec: float
    schedule_interval_minutes: int
    worker_poll_interval_sec: float
    frame_width: int
    frame_height: int

    @classmethod
    def load(cls, path: Path) -> Config:
        data = json.loads(path.read_text())
        worker_url = data.get("worker_url", "https://cam.alighavam.com").rstrip("/")
        internal_secret = data.get("internal_secret", "")
        if not internal_secret:
            raise ValueError("internal_secret is required (same as Wrangler INTERNAL_SECRET)")
        return cls(
            go2rtc_base_url=data.get("go2rtc_base_url", "http://127.0.0.1:1984").rstrip("/"),
            go2rtc_stream=data.get("go2rtc_stream", "lab_cam"),
            worker_url=worker_url,
            internal_secret=internal_secret,
            motion_threshold=float(data.get("motion_threshold", 3.5)),
            burst_frames=int(data.get("burst_frames", 5)),
            burst_interval_sec=float(data.get("burst_interval_sec", 1.0)),
            schedule_interval_minutes=int(data.get("schedule_interval_minutes", 30)),
            worker_poll_interval_sec=float(data.get("worker_poll_interval_sec", 5.0)),
            frame_width=int(data.get("frame_width", 160)),
            frame_height=int(data.get("frame_height", 120)),
        )

    @property
    def frame_url(self) -> str:
        return f"{self.go2rtc_base_url}/api/frame.jpeg?src={self.go2rtc_stream}"


@dataclass
class State:
    last_motion: str  # "moving" | "stopped"
    notified_done: bool

    @classmethod
    def load(cls, path: Path) -> State:
        if not path.exists():
            return cls(last_motion="moving", notified_done=False)
        data = json.loads(path.read_text())
        return cls(
            last_motion=data.get("last_motion", "moving"),
            notified_done=bool(data.get("notified_done", False)),
        )

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                {"last_motion": self.last_motion, "notified_done": self.notified_done},
                indent=2,
            )
        )


class PrintWatcher:
    RESULT_MOVING = "moving"
    RESULT_FINISHED = "finished_confirmed"
    RESULT_CAMERA_OFFLINE = "camera_offline"

    def __init__(self, config: Config, state_path: Path) -> None:
        self.cfg = config
        self.state_path = state_path
        self.state = State.load(state_path)
        self._lock = threading.Lock()

    def worker_headers(self) -> dict[str, str]:
        return {"X-Watcher-Secret": self.cfg.internal_secret}

    def send_telegram(self, text: str, chat_id: str | None = None) -> None:
        url = f"{self.cfg.worker_url}/internal/watcher/notify"
        payload: dict[str, str] = {"text": text}
        if chat_id:
            payload["chat_id"] = chat_id
        try:
            resp = requests.post(url, json=payload, headers=self.worker_headers(), timeout=20)
            resp.raise_for_status()
        except Exception as exc:
            LOG.error("Notify via Worker failed: %s", exc)

    def fetch_frame(self) -> Image.Image | None:
        try:
            resp = requests.get(self.cfg.frame_url, timeout=15)
            resp.raise_for_status()
            img = Image.open(io.BytesIO(resp.content))
            img.load()
            return img.convert("RGB")
        except Exception as exc:
            LOG.warning("Frame fetch failed: %s", exc)
            return None

    def capture_burst(self) -> list[Image.Image]:
        frames: list[Image.Image] = []
        for i in range(self.cfg.burst_frames):
            frame = self.fetch_frame()
            if frame is not None:
                frames.append(frame)
            if i < self.cfg.burst_frames - 1:
                time.sleep(self.cfg.burst_interval_sec)
        return frames

    def _prep(self, img: Image.Image) -> Image.Image:
        return img.convert("L").resize((self.cfg.frame_width, self.cfg.frame_height))

    def frame_diff(self, a: Image.Image, b: Image.Image) -> float:
        diff = ImageChops.difference(self._prep(a), self._prep(b))
        return float(ImageStat.Stat(diff).mean[0])

    def burst_is_stopped(self, frames: list[Image.Image]) -> tuple[bool, float]:
        if len(frames) < 2:
            return False, 0.0
        diffs = [self.frame_diff(frames[i], frames[i + 1]) for i in range(len(frames) - 1)]
        peak = max(diffs)
        return peak < self.cfg.motion_threshold, peak

    def run_check(self, *, double_confirm: bool = True) -> tuple[str, float]:
        burst1 = self.capture_burst()
        if len(burst1) < 2:
            return self.RESULT_CAMERA_OFFLINE, 0.0
        stopped1, peak1 = self.burst_is_stopped(burst1)
        del burst1

        if not stopped1:
            return self.RESULT_MOVING, peak1

        if not double_confirm:
            return self.RESULT_FINISHED, peak1

        LOG.info("First burst looks stopped (peak=%.2f); running confirm burst now", peak1)
        burst2 = self.capture_burst()
        stopped2, peak2 = self.burst_is_stopped(burst2)
        del burst2

        if stopped2:
            return self.RESULT_FINISHED, max(peak1, peak2)
        return self.RESULT_MOVING, peak1

    def describe_result(self, result: str, peak: float) -> str:
        if result == self.RESULT_FINISHED:
            return f"Print looks finished (no motion in two 5s bursts, peak diff {peak:.1f})."
        if result == self.RESULT_MOVING:
            return f"Still printing or moving (peak diff {peak:.1f})."
        if result == self.RESULT_CAMERA_OFFLINE:
            return "Camera unavailable — is the lab hub running and ESP32 online?"
        return "Could not sample the camera."

    def handle_finished_confirmed(self, *, notify: bool, peak: float) -> None:
        with self._lock:
            should_notify = notify and not self.state.notified_done
            self.state.last_motion = "stopped"
            if should_notify:
                self.state.notified_done = True
            self.state.save(self.state_path)
        if should_notify:
            self.send_telegram(
                f"Lab camera: print looks finished.\n"
                f"(No motion in two back-to-back bursts, peak diff {peak:.1f})"
            )
            LOG.info("Sent finished notification via Worker")

    def handle_moving(self) -> None:
        with self._lock:
            self.state.last_motion = "moving"
            self.state.notified_done = False
            self.state.save(self.state_path)

    def process_scheduled(self) -> None:
        result, peak = self.run_check(double_confirm=True)
        LOG.info("Scheduled check: %s (peak=%.2f)", result, peak)

        if result == self.RESULT_CAMERA_OFFLINE:
            LOG.info("Scheduled check skipped — camera unreachable")
            return

        if result == self.RESULT_FINISHED:
            self.handle_finished_confirmed(notify=True, peak=peak)
        elif result == self.RESULT_MOVING:
            self.handle_moving()

    def process_on_demand(self, chat_id: str | None) -> None:
        result, peak = self.run_check(double_confirm=True)
        LOG.info("On-demand check: %s (peak=%.2f)", result, peak)

        if result == self.RESULT_FINISHED:
            with self._lock:
                already_notified = self.state.notified_done
            self.handle_finished_confirmed(notify=True, peak=peak)
            reply = self.describe_result(result, peak)
            if already_notified:
                reply += "\n\n(Already notified for this print — no duplicate alert.)"
            self.send_telegram(reply, chat_id=chat_id)
        elif result == self.RESULT_MOVING:
            self.handle_moving()
            self.send_telegram(self.describe_result(result, peak), chat_id=chat_id)
        else:
            self.send_telegram(self.describe_result(result, peak), chat_id=chat_id)

    def worker_poll_loop(self) -> None:
        LOG.info("Worker poll loop started (Telegram via Cloudflare)")
        url = f"{self.cfg.worker_url}/internal/watcher/poll"
        while True:
            try:
                resp = requests.get(url, headers=self.worker_headers(), timeout=20)
                resp.raise_for_status()
                data = resp.json()
                if data.get("check"):
                    chat_id = data.get("chat_id")
                    threading.Thread(
                        target=self.process_on_demand,
                        args=(str(chat_id) if chat_id else None,),
                        daemon=True,
                    ).start()
            except Exception as exc:
                LOG.warning("Worker poll error: %s", exc)
            time.sleep(self.cfg.worker_poll_interval_sec)

    def scheduler_loop(self) -> None:
        interval = self.cfg.schedule_interval_minutes * 60
        LOG.info("Scheduler started (every %s min)", self.cfg.schedule_interval_minutes)
        while True:
            time.sleep(interval)
            try:
                self.process_scheduled()
            except Exception as exc:
                LOG.exception("Scheduled check failed: %s", exc)

    def run(self) -> None:
        poll_thread = threading.Thread(target=self.worker_poll_loop, daemon=True)
        poll_thread.start()
        self.scheduler_loop()


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    config_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_CONFIG_PATH
    if not config_path.exists():
        LOG.error("Missing config: %s", config_path)
        LOG.error("Copy cloudflare/print-watcher/print-watcher.json.example and edit it.")
        sys.exit(1)

    try:
        cfg = Config.load(config_path)
    except ValueError as exc:
        LOG.error("%s", exc)
        sys.exit(1)

    state_path = config_path.parent / "print-watcher-state.json"
    PrintWatcher(cfg, state_path).run()


if __name__ == "__main__":
    main()
