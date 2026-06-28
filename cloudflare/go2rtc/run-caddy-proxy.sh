#!/bin/bash
# Path proxy between cloudflared (/stream, /frame) and go2rtc (/api/...).
# Usage: ./run-caddy-proxy.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CADDYFILE="${SCRIPT_DIR}/Caddyfile"

if ! command -v caddy >/dev/null 2>&1; then
  echo "caddy not found. Install: brew install caddy"
  exit 1
fi

echo "Starting Caddy proxy on http://127.0.0.1:8080 ..."
exec caddy run --config "$CADDYFILE"
