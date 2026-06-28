# One-click lab hub (Mac Studio)

Double-click to start or stop all three services — no need to remember terminal commands.

## Start

Double-click **`Start Lab Camera.command`**

Starts in the background (safe to close the window after):

1. **go2rtc** — pulls one stream from the ESP32  
2. **Caddy** — proxy on `127.0.0.1:8080`  
3. **cloudflared** — tunnel to `https://cam.alighavam.com`  
4. **print-watcher** — motion detection + Telegram alerts (if configured)

## Stop

Double-click **`Stop Lab Camera.command`**

## Logs

```
~/Library/Logs/lab-camera/
  go2rtc.log
  caddy.log
  cloudflared.log
  print-watcher.log
```

## First-time setup on Mac

Make scripts executable (once):

```bash
cd cloudflare/lab-camera
chmod +x start-all.sh stop-all.sh "Start Lab Camera.command" "Stop Lab Camera.command"
```

Optional: drag **`Start Lab Camera.command`** to the Dock for one-click access.

## Prerequisites (same as before)

- `go2rtc` installed, config at `~/.config/go2rtc/go2rtc.yaml`
- `caddy` installed (`brew install caddy`)
- `cloudflared` installed, config at `~/.cloudflared/config.yml`

If something fails to start, open the log file listed above.

## Terminal alternative

```bash
./cloudflare/lab-camera/start-all.sh
./cloudflare/lab-camera/stop-all.sh
```
