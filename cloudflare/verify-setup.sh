#!/bin/bash
# Run on your LAB Mac (same WiFi as ESP32). Checks tunnel + ESP32 reachability.

set -euo pipefail

ESP32_IP="${1:-192.168.0.131}"
CONFIG="${HOME}/.cloudflared/config.yml"

echo "========== 1. Tunnel status =========="
if command -v cloudflared >/dev/null 2>&1; then
  cloudflared tunnel list || true
else
  echo "ERROR: cloudflared not installed"
fi

echo ""
echo "========== 2. Config file =========="
if [[ -f "$CONFIG" ]]; then
  cat "$CONFIG"
else
  echo "ERROR: missing $CONFIG"
fi

echo ""
echo "========== 3. DNS (cam.alighavam.com) =========="
if command -v dig >/dev/null 2>&1; then
  dig cam.alighavam.com +short
  echo "(If you see 1033 in browser, tunnel DNS is OK but cloudflared is not running.)"
fi

echo ""
echo "========== 4. ESP32 ping =========="
ping -c 2 "$ESP32_IP" || echo "WARN: ping failed"

echo ""
echo "========== 5. ESP32 HTTP (status page) =========="
curl --max-time 5 -sI "http://${ESP32_IP}/" || echo "WARN: HTTP to ESP32 failed"

echo ""
echo "========== 6. Public URL (no secrets printed) =========="
CODE=$(curl --max-time 10 -s -o /dev/null -w "%{http_code}" "https://cam.alighavam.com/" || true)
echo "https://cam.alighavam.com/ returned HTTP $CODE"
echo "  200/401 = tunnel working"
echo "  530/1033 = tunnel NOT connected — run: cloudflared tunnel --config ~/.cloudflared/config.yml run"
