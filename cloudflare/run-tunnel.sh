#!/bin/bash
# Run on your lab computer after cloudflared is installed.
# Usage: ./run-tunnel.sh

set -euo pipefail

CONFIG="${HOME}/.cloudflared/config.yml"

if [[ ! -f "$CONFIG" ]]; then
  echo "Missing $CONFIG"
  echo "Copy cloudflare/tunnel-config.example.yml and edit it first."
  exit 1
fi

echo "Starting Cloudflare tunnel..."
cloudflared tunnel --config "$CONFIG" run
