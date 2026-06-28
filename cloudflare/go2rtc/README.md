# Stream hub (go2rtc) — one ESP32 connection, many viewers

The ESP32 `/stream` endpoint blocks on a single long-lived MJPEG connection.
A second viewer cannot connect until the hub sits in front of it.

```
ESP32 (1 connection) → go2rtc on Mac Studio → cloudflared → Cloudflare Worker → viewers
```

## 1. Install go2rtc (Mac Studio)

**Apple Silicon (M1/M2/M3):**

```bash
curl -L -o /tmp/go2rtc.zip \
  https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_mac_arm64.zip
unzip -o /tmp/go2rtc.zip -d /tmp/go2rtc
sudo mv /tmp/go2rtc/go2rtc /usr/local/bin/go2rtc
chmod +x /usr/local/bin/go2rtc
go2rtc -version
```

**Intel Mac:** use `go2rtc_mac_amd64.zip` instead.

## 2. Config

```bash
mkdir -p ~/.config/go2rtc
cp cloudflare/go2rtc/go2rtc.yaml.example ~/.config/go2rtc/go2rtc.yaml
nano ~/.config/go2rtc/go2rtc.yaml
```

Set the ESP32 IP and `STREAM_TOKEN` from `esp32_lab_camera/secrets.h`.

## 3. Test locally

Terminal 1:

```bash
./cloudflare/go2rtc/run-go2rtc.sh
```

Terminal 2:

```bash
curl --max-time 5 -sI "http://127.0.0.1:1984/api/stream.mjpeg?src=lab_cam"
```

Expect `HTTP/1.1 200 OK` and `Content-Type: multipart/x-mixed-replace`.

Open two browser tabs:

```
http://127.0.0.1:1984/api/stream.mjpeg?src=lab_cam
```

Both should show video.

## 4. Point the tunnel at the Caddy proxy (not ESP32, not go2rtc directly)

The Worker still requests `/stream` and `/frame`. Caddy rewrites those to go2rtc API paths.

**Terminal 1 — go2rtc:**
```bash
./cloudflare/go2rtc/run-go2rtc.sh
```

**Terminal 2 — Caddy proxy:**
```bash
brew install caddy   # once
./cloudflare/go2rtc/run-caddy-proxy.sh
```

**Terminal 3 — test Caddy (simulates what the tunnel sees):**
```bash
curl --max-time 5 -sI "http://127.0.0.1:8080/stream"
curl --max-time 5 -sI "http://127.0.0.1:8080/frame"
```

Both should return `HTTP/1.1 200 OK`.

Edit `~/.cloudflared/config.yml`:

```yaml
ingress:
  - hostname: cam.alighavam.com
    service: http://127.0.0.1:8080
  - service: http_status:404
```

Restart cloudflared.

## 5. Deploy Worker (only if you deployed the broken /api/ rewrite version)

If you already deployed the Worker before this fix, redeploy so `/stream` paths are used again:

```bash
cd cloudflare/worker
wrangler deploy
```

## 6. Verify

1. go2rtc running
2. cloudflared running
3. Two devices → `https://cam.alighavam.com/` → both see stream

## Run on boot

Run go2rtc and cloudflared as LaunchAgents (see CAMERA_SETUP.md).
