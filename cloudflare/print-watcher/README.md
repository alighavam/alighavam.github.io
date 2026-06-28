# Print-finished detector

Detects when your 3D printer has stopped moving by sampling short frame bursts from go2rtc.
Telegram goes through **Cloudflare Worker** (works when the lab network blocks `api.telegram.org`).

## How it works

```
Telegram  ↔  Cloudflare Worker (edge)  ↔  HTTPS  ↔  Mac Studio print_watcher  ↔  go2rtc  ↔  ESP32
```

1. **Scheduled** (every 30 min): Mac Studio samples frames; if done → Worker sends Telegram.
2. **`/check` in Telegram** → Worker queues request → Mac Studio polls every 5s → runs burst → Worker replies.
3. **Double confirm**: two 5s bursts back-to-back before “finished” (immediate, not 30 min apart).

## Setup

### A — Cloudflare Worker (MacBook or any network with wrangler)

Do this **once** — not on the lab Mac if Telegram is blocked there.

```bash
cd cloudflare/worker

# 1. Create KV namespace
wrangler kv namespace create WATCHER_KV
```

Copy the `"id"` into `wrangler.toml` → replace `REPLACE_WITH_KV_NAMESPACE_ID`.

```bash
# 2. Telegram secrets (bot token from @BotFather, chat id from @userinfobot)
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_CHAT_ID

# Optional but recommended:
wrangler secret put TELEGRAM_WEBHOOK_SECRET

# 3. Deploy
wrangler deploy

# 4. Register webhook (uses Cloudflare edge to call Telegram — works from anywhere)
curl -X POST "https://cam.alighavam.com/internal/watcher/setup-webhook" \
  -H "X-Watcher-Secret: YOUR_INTERNAL_SECRET"
```

Expect `"ok":true` in the response.

Or run the interactive script:

```bash
./setup-telegram.sh
```

### B — Lab Mac Studio

```bash
pip3 install -r cloudflare/print-watcher/requirements.txt

mkdir -p ~/.config/lab-camera
cp cloudflare/print-watcher/print-watcher.json.example ~/.config/lab-camera/print-watcher.json
nano ~/.config/lab-camera/print-watcher.json
```

Set:

```json
"worker_url": "https://cam.alighavam.com",
"internal_secret": "same as wrangler INTERNAL_SECRET"
```

**Remove** any old `telegram_bot_token` / `telegram_chat_id` lines — those live in Wrangler now.

Restart **Start Lab Camera.command**.

### C — Test

1. Telegram → your bot → `/help` (instant reply from Worker)
2. `/check` → “Checking camera now…” then result after ~10–15s

Logs: `~/Library/Logs/lab-camera/print-watcher.log` should show `Worker poll loop started`.

## Telegram commands

| Command | Action |
|---------|--------|
| `/check` | Sample now (two 5s bursts) |
| `/status` | Same as `/check` |
| `/help` | Usage |

## Config reference

| Key | Purpose |
|-----|---------|
| `worker_url` | `https://cam.alighavam.com` |
| `internal_secret` | Same as Wrangler `INTERNAL_SECRET` |
| `motion_threshold` | Lower = more sensitive (default 3.5) |
| `schedule_interval_minutes` | Auto-check interval (default 30) |

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Bot silent on `/help` | Redo webhook setup (step A.4); check `TELEGRAM_*` secrets |
| `/check` says “Checking…” but no follow-up | Lab Mac not polling — restart Start Lab Camera; check print-watcher.log |
| Worker poll errors | Wrong `internal_secret` in print-watcher.json |
| `KV not bound` | Create KV namespace and update wrangler.toml, redeploy |

## Security

- Revoke any bot token that appeared in logs (`/revoke` in @BotFather).
- `internal_secret` must match on Worker and lab Mac — never commit it.
