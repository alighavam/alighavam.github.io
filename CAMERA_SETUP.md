# Lab Camera Setup

Live ESP32-CAM stream on your portfolio site, with **no video stored on GitHub**.

## How it works

```
ESP32-CAM (lab WiFi)  →  Cloudflare Tunnel (lab PC)  →  HTTPS stream URL
GitHub Pages          →  camera.html (password gate)  →  embeds stream in browser
```

- GitHub only hosts the viewer page (a few KB).
- Video bytes go **directly** from ESP32 → Cloudflare → browser.
- Two passwords:
  - **Viewer password** — friends enter on `camera.html`
  - **Stream token** — secret query param the ESP32 checks (`/stream?token=...`)

---

## Your board (confirmed)

From your Amazon listing ([B0FLPMGHLR](https://www.amazon.ca/dp/B0FLPMGHLR)):

| Item | Value |
|------|-------|
| Module | ESP32-CAM-MB (camera slots into programmer board) |
| Camera | OV2640 |
| USB chip | CH340C (use the **MB board** micro-USB port) |
| Pinout | **AI-Thinker** (standard ESP32-CAM) |
| Antenna | External IPEX (good for university WiFi) |

You do **not** need an SD card for this project.

---

## Part 1 — Flash the ESP32

### 1.1 Install Arduino IDE + ESP32 support

1. Install [Arduino IDE 2.x](https://www.arduino.cc/en/software).
2. **Settings → Additional boards manager URLs**, add:
   ```
   https://espressif.github.io/arduino-esp32/package_esp32_index.json
   ```
3. **Tools → Board → Boards Manager** → install **esp32** by Espressif (v3.x).
4. Install CH340 driver on Mac if needed: search "CH340 Mac driver" or use the driver from the chip manufacturer.

### 1.2 Open the sketch

1. Open `esp32-lab-camera/esp32_lab_camera.ino` in Arduino IDE.
2. Copy secrets template:
   ```bash
   cp esp32-lab-camera/secrets.h.example esp32-lab-camera/esp32_lab_camera/secrets.h
   ```
3. Edit `esp32-lab-camera/esp32_lab_camera/secrets.h` (must be next to the `.ino` file):
   - `WIFI_SSID` / `WIFI_PASSWORD` — university WiFi credentials
   - `STREAM_TOKEN` — long random string, e.g. `openssl rand -hex 24`

### 1.3 Board settings

Connect the **ESP32-CAM module into the MB board**, then USB to the **MB board** (not the camera module alone).

| Setting | Value |
|---------|-------|
| Board | **AI Thinker ESP32-CAM** |
| PSRAM | **Enabled** |
| Partition Scheme | **Huge APP (3MB No OTA / 1MB SPIFFS)** or default |
| Upload Speed | 115200 (use 921600 only if uploads fail) |
| Port | `/dev/cu.usbserial-*` or `COMx` (CH340) |

### 1.4 Upload

1. Click **Upload**.
2. If upload fails, press the **RST** button on the MB board once and retry.
3. Open **Serial Monitor** at **115200 baud**.
4. On success you should see:
   ```
   WiFi connected
   Camera IP address: 192.168.x.x
   HTTP server started on port 80
   ```

**Save that IP address** — you need it for Cloudflare Tunnel.

### 1.5 Test locally (same WiFi)

On a phone/laptop on the **same WiFi** as the ESP32, open:

```
http://192.168.x.x/stream?token=YOUR_STREAM_TOKEN
```

You should see a live MJPEG stream.

### University WiFi notes

- Works with **WPA2 personal** (SSID + password).
- **Eduroam / WPA2-Enterprise** (username@domain + password) is often **not supported** on ESP32 without extra libraries. Ask IT for a **device/IoT SSID** or use a lab access point.
- Some networks **isolate devices** from each other. Your lab PC and ESP32 must be able to reach each other (ping the ESP32 IP from the lab PC).

---

## Part 2 — Cloudflare Tunnel (lab computer)

This exposes `http://ESP32_IP:80` as `https://cam.yourdomain.com`.

### 2.1 Prerequisites

- Domain on Cloudflare (DNS managed by Cloudflare).
- Lab computer always on, on the **same network** as the ESP32.

### 2.2 Install cloudflared

**macOS (lab PC):**
```bash
brew install cloudflared
```

**Windows:** download from [Cloudflare Zero Trust docs](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).

### 2.3 Log in and create tunnel

```bash
cloudflared tunnel login
cloudflared tunnel create lab-camera
```

Note the **tunnel UUID** and credentials file path (printed after create).

### 2.4 DNS route

```bash
cloudflared tunnel route dns lab-camera cam.yourdomain.com
```

Replace `yourdomain.com` with your real domain.

### 2.5 Config file

```bash
mkdir -p ~/.cloudflared
cp cloudflare/tunnel-config.example.yml ~/.cloudflared/config.yml
```

Edit `~/.cloudflared/config.yml`:

```yaml
tunnel: YOUR_TUNNEL_UUID
credentials-file: /Users/YOU/.cloudflared/YOUR_TUNNEL_UUID.json

ingress:
  - hostname: cam.yourdomain.com
    service: http://192.168.x.x:80    # ESP32 IP from Serial Monitor
  - service: http_status:404
```

### 2.6 Run the tunnel

```bash
cloudflared tunnel --config ~/.cloudflared/config.yml run
```

Or use `cloudflare/run-tunnel.sh` from this repo.

Test in a browser:

```
https://cam.yourdomain.com/stream?token=YOUR_STREAM_TOKEN
```

### 2.7 Run on boot (recommended)

**macOS (launchd)** — create `~/Library/LaunchAgents/com.lab.camera.tunnel.plist` (adjust paths):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.lab.camera.tunnel</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/cloudflared</string>
    <string>tunnel</string>
    <string>--config</string>
    <string>/Users/YOU/.cloudflared/config.yml</string>
    <string>run</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.lab.camera.tunnel.plist
```

**Windows:** install as a service:
```bash
cloudflared service install
```

### 2.8 If ESP32 IP changes

Ask IT for a **DHCP reservation** for the ESP32 MAC address, or update `config.yml` when the IP changes and restart cloudflared.

---

## Part 3 — Secure viewer (Cloudflare Worker)

**Do not put passwords or stream tokens on GitHub.** The viewer and password check run on Cloudflare's edge.

See **`cloudflare/worker/README.md`** for full steps. Summary:

```bash
npm install -g wrangler
wrangler login
cd cloudflare/worker
wrangler secret put VIEWER_PASSWORD
wrangler secret put STREAM_TOKEN
wrangler secret put INTERNAL_SECRET
wrangler deploy
```

Share with friends:

- URL: `https://cam.alighavam.com`
- Password: the `VIEWER_PASSWORD` you set in Wrangler

`camera.html` on GitHub only redirects to that URL — no secrets in the repo.

### Rotate your stream token

If the old token was ever committed or shared, generate a new one (`openssl rand -hex 32`), update `secrets.h`, re-flash the ESP32, then `wrangler secret put STREAM_TOKEN`.

---

## Part 4 — Validation checklist

| Step | Check |
|------|-------|
| ESP32 Serial Monitor | WiFi connected + IP printed |
| Same WiFi | `http://ESP32_IP/stream?token=...` works |
| Tunnel running | `cloudflared tunnel list` shows connections |
| Worker deployed | `https://cam.alighavam.com` shows login |
| Incognito `/stream` | **401** without logging in |
| After login | Live stream on phone (cellular) |
| GitHub | No `camera-config.js` with secrets in repo |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Camera init error `0x105` | Wrong board selected — use **AI Thinker ESP32-CAM** |
| PSRAM not found | Try a different module from the 2-pack; contact seller |
| WiFi failed | Check SSID/password; confirm university allows IoT devices |
| Upload timeout | Lower upload speed; press RST; check CH340 driver |
| Stream works locally, not via Cloudflare | Tunnel not running; wrong ESP32 IP in config |
| Login works, stream blank | `STREAM_TOKEN` mismatch between ESP32 and Worker secret |
| HTTPS page, no stream | Stream URL must be `https://` (Cloudflare), not `http://` |
| Choppy video | Normal with multiple viewers; ESP32 limits ~2–3 simultaneous streams |

---

## Security

| Layer | What it does |
|-------|----------------|
| **Cloudflare Worker** | Password checked server-side; stream token never sent to browser |
| **HttpOnly cookie** | Session after login; `/stream` returns 401 without it |
| **ESP32 token** | Second layer — Worker adds token when proxying to ESP32 |
| **GitHub** | No secrets — `camera.html` is redirect only |

**Cloudflare dashboard login** (your account at cloudflare.com) is only for **you** managing DNS/tunnels. Random people cannot log into your Cloudflare account and see the stream.

**Cloudflare Access** (optional, stronger): email allowlist + one-time PIN per visitor — see `cloudflare/worker/README.md` if you want that later.

---

## File map

```
esp32-lab-camera/
  esp32_lab_camera/esp32_lab_camera.ino
  esp32_lab_camera/secrets.h          # gitignored
camera.html                           # redirects to cam.alighavam.com
cloudflare/
  worker/worker.js                    # password gate (deploy with wrangler)
  worker/wrangler.toml
  worker/README.md
  tunnel-config.example.yml
  run-tunnel.sh
  verify-setup.sh
```
