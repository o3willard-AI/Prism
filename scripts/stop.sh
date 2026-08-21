#!/usr/bin/env bash
# Stop the Prism stack started by scripts/start.sh.
set -uo pipefail
cd "$(dirname "$0")/.."

for name in caddy prism healthcheck; do
  pidfile="logs/$name.pid"
  if [ -f "$pidfile" ]; then
    pid=$(cat "$pidfile")
    if kill -0 "$pid" 2>/dev/null; then
      echo "Stopping $name (pid $pid)"
      kill "$pid" 2>/dev/null || true
    else
      echo "$name (pid $pid) not running"
    fi
    rm -f "$pidfile"
  fi
done
echo "Done."
