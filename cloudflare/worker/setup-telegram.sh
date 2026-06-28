#!/bin/bash
# One-time Telegram relay setup (run from MacBook or any network — NOT the lab Mac if blocked).
# Usage: ./setup-telegram.sh

set -euo pipefail

cd "$(dirname "$0")"

echo "=== 1. Create KV namespace (skip if already in wrangler.toml) ==="
echo "Run: wrangler kv namespace create WATCHER_KV"
echo "Copy the id into wrangler.toml → [[kv_namespaces]] → id = \"...\""
echo ""
read -r -p "Press Enter after wrangler.toml has the KV id…"

echo ""
echo "=== 2. Set Telegram secrets on the Worker ==="
echo "Get bot token from @BotFather; chat id from @userinfobot"
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_CHAT_ID
echo ""
echo "Optional webhook hardening (recommended):"
echo "  openssl rand -hex 16"
read -r -p "Set TELEGRAM_WEBHOOK_SECRET? [y/N] " SET_SECRET
if [[ "$SET_SECRET" == "y" || "$SET_SECRET" == "Y" ]]; then
  wrangler secret put TELEGRAM_WEBHOOK_SECRET
fi

echo ""
echo "=== 3. Deploy Worker ==="
wrangler deploy

echo ""
echo "=== 4. Register Telegram webhook (via Cloudflare edge) ==="
read -r -p "Paste INTERNAL_SECRET (same as wrangler secret): " INTERNAL_SECRET
curl -s -X POST "https://cam.alighavam.com/internal/watcher/setup-webhook" \
  -H "X-Watcher-Secret: ${INTERNAL_SECRET}" | python3 -m json.tool || true

echo ""
echo "=== Done ==="
echo "Update ~/.config/lab-camera/print-watcher.json on the lab Mac:"
echo '  "worker_url": "https://cam.alighavam.com"'
echo '  "internal_secret": "<same INTERNAL_SECRET>"'
echo "Remove telegram_bot_token and telegram_chat_id from that file."
echo "Restart Start Lab Camera.command, then send /help to your bot."
