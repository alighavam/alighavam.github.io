#!/bin/bash
# Start go2rtc + Caddy + cloudflared in the background (Mac Studio lab hub).
# Double-click "Start Lab Camera.command" or run: ./start-all.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STATE_DIR="${HOME}/Library/Application Support/lab-camera"
LOG_DIR="${HOME}/Library/Logs/lab-camera"
GO2RTC_CONFIG="${HOME}/.config/go2rtc/go2rtc.yaml"
TUNNEL_CONFIG="${HOME}/.cloudflared/config.yml"
CADDYFILE="${SCRIPT_DIR}/../go2rtc/Caddyfile"

mkdir -p "$STATE_DIR" "$LOG_DIR"

red() { printf '\033[0;31m%s\033[0m\n' "$*"; }
green() { printf '\033[0;32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[0;33m%s\033[0m\n' "$*"; }

pid_file() { echo "${STATE_DIR}/$1.pid"; }

is_alive() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

read_pid() {
  local file
  file="$(pid_file "$1")"
  if [[ -f "$file" ]]; then
    cat "$file"
  fi
}

start_service() {
  local name="$1"
  shift
  local existing
  existing="$(read_pid "$name")"
  if is_alive "$existing"; then
    yellow "$name already running (PID $existing)"
    return 0
  fi
  rm -f "$(pid_file "$name")"

  local log="${LOG_DIR}/${name}.log"
  nohup "$@" >>"$log" 2>&1 &
  local pid=$!
  disown "$pid" 2>/dev/null || true
  echo "$pid" >"$(pid_file "$name")"
  sleep 1
  if is_alive "$pid"; then
    green "$name started (PID $pid)"
  else
    red "$name failed to start — see ${log}"
    rm -f "$(pid_file "$name")"
    return 1
  fi
}

fail=0

echo ""
echo "=== Lab Camera — starting services ==="
echo ""

if [[ ! -f "$GO2RTC_CONFIG" ]]; then
  red "Missing $GO2RTC_CONFIG"
  echo "Copy cloudflare/go2rtc/go2rtc.yaml.example and edit it."
  fail=1
fi

if [[ ! -f "$TUNNEL_CONFIG" ]]; then
  red "Missing $TUNNEL_CONFIG"
  echo "See CAMERA_SETUP.md Part 2."
  fail=1
fi

if [[ ! -f "$CADDYFILE" ]]; then
  red "Missing Caddyfile at $CADDYFILE"
  fail=1
fi

for cmd in go2rtc caddy cloudflared; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    red "$cmd not found in PATH"
    fail=1
  fi
done

if [[ "$fail" -ne 0 ]]; then
  echo ""
  red "Fix the errors above, then try again."
  exit 1
fi

start_service go2rtc go2rtc -config "$GO2RTC_CONFIG" || fail=1
start_service caddy caddy run --config "$CADDYFILE" || fail=1
start_service cloudflared cloudflared tunnel --config "$TUNNEL_CONFIG" run || fail=1

echo ""
if [[ "$fail" -ne 0 ]]; then
  red "Some services failed. Logs: $LOG_DIR"
  exit 1
fi

green "All services running."
echo ""
echo "  Local hub:   http://127.0.0.1:8080/stream"
echo "  Public site: https://cam.alighavam.com/"
echo "  Logs:        $LOG_DIR"
echo ""
echo "To stop: double-click \"Stop Lab Camera.command\""
echo ""
read -r -p "Press Enter to close this window (services keep running)…"
