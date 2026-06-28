#!/bin/bash
# Stop go2rtc, Caddy, and cloudflared started by start-all.sh

set -uo pipefail

STATE_DIR="${HOME}/Library/Application Support/lab-camera"

stop_one() {
  local name="$1"
  local file="${STATE_DIR}/${name}.pid"
  if [[ ! -f "$file" ]]; then
    echo "$name: not running (no pid file)"
    return 0
  fi
  local pid
  pid="$(cat "$file")"
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
    echo "Stopped $name (PID $pid)"
  else
    echo "$name: pid file stale (process already gone)"
  fi
  rm -f "$file"
}

echo ""
echo "=== Lab Camera — stopping services ==="
echo ""

stop_one go2rtc
stop_one caddy
stop_one cloudflared

echo ""
echo "Done."
echo ""
read -r -p "Press Enter to close…"
