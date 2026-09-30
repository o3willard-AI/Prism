#!/usr/bin/env bash
# Kill any stub agent by PORT, not by PID.
#
# The F24 stale-server lesson, now recurring: a leftover stub on :8400 keeps
# answering with the previous run's mode, so a suite silently judges everything
# with stale logic. PID-based kills miss it because the process that bound the
# port is not the one this shell started. Bind by port or don't trust the run.
set -u
PORT="${1:-8400}"
pids=$(ss -ltnpH "sport = :$PORT" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u)
if [ -n "$pids" ]; then
  for p in $pids; do kill -9 "$p" 2>/dev/null || true; done
  sleep 1
fi
if ss -ltn 2>/dev/null | grep -q ":$PORT"; then
  echo "port $PORT STILL BOUND"
  exit 1
fi
echo "port $PORT free"
