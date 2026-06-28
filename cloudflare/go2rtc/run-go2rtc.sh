#!/bin/bash
# Run on the lab Mac Studio (same machine as cloudflared).
# Usage: ./run-go2rtc.sh

set -euo pipefail

CONFIG="${HOME}/.config/go2rtc/go2rtc.yaml"

if [[ ! -f "$CONFIG" ]]; then
  echo "Missing $CONFIG"
  echo "Copy cloudflare/go2rtc/go2rtc.yaml.example and edit ESP32 IP + token."
  exit 1
fi

if ! command -v go2rtc >/dev/null 2>&1; then
  echo "go2rtc not found. Install from cloudflare/go2rtc/README.md"
  exit 1
fi

echo "Starting go2rtc (hub) on http://127.0.0.1:1984 ..."
exec go2rtc -config "$CONFIG"
