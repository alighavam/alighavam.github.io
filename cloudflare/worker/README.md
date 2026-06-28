# Deploy the password gate (secrets stay on Cloudflare, never GitHub)

## 1. Install Wrangler (no npm needed on Mac)

**Mac (Homebrew — same as cloudflared):**

```bash
brew install cloudflare-wrangler
wrangler login
```

**If you don't have Homebrew:** install from [brew.sh](https://brew.sh), then run the commands above.

**Alternative (only if you want npm later):** `brew install node` then `npm install -g wrangler`

## 2. Set secrets (do this once, then again if you rotate passwords)

```bash
cd cloudflare/worker

# Shared password your friends type on the login page
wrangler secret put VIEWER_PASSWORD

# Must match STREAM_TOKEN in esp32_lab_camera/secrets.h
wrangler secret put STREAM_TOKEN

# Random string — prevents worker auth loop (openssl rand -hex 32)
wrangler secret put INTERNAL_SECRET

# Print watcher Telegram relay (see cloudflare/print-watcher/README.md)
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_CHAT_ID
# Optional: wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

Wrangler prompts for each value interactively. Nothing is stored in this repo.

## 3. Deploy

```bash
wrangler deploy
```

## 4. Verify

1. `wrangler secret list` — must show `VIEWER_PASSWORD`, `STREAM_TOKEN`, `INTERNAL_SECRET`
2. `STREAM_TOKEN` must **exactly match** `esp32_lab_camera/secrets.h` (re-flash ESP32 if you change it)
3. `cloudflared` tunnel must be **running** on the lab Mac
4. Open `https://cam.alighavam.com` — login → live stream
5. Incognito → `https://cam.alighavam.com/stream` — **401** without login

### Stream shows "Connecting..." but no video?

```bash
# On lab Mac — ESP32 must respond
curl --max-time 5 -I "http://192.168.0.131/"

# Re-deploy after worker.js fixes
wrangler deploy
```

If login works but stream is blank: almost always **STREAM_TOKEN mismatch** or **tunnel not running**.

## 5. Rotate the stream token (recommended)

Your old token may have been exposed in GitHub/browser. Generate a new one:

```bash
openssl rand -hex 32
```

Update `esp32_lab_camera/secrets.h`, re-flash ESP32, then:

```bash
wrangler secret put STREAM_TOKEN
```

## How it works

```
Browser → cam.alighavam.com (Cloudflare Worker)
            ├─ /           login page
            ├─ /auth         checks password (server-side secret)
            ├─ /stream       cookie required; Worker adds token, forwards to tunnel → ESP32
            └─ secrets never sent to browser
```

GitHub `camera.html` only redirects to `https://cam.alighavam.com`.
