#!/usr/bin/env bash
# Start the full Prism stack in the background:
#   healthcheck backend :8081
#   Prism backend       :8082
#   Caddy (front door)  :8080
set -euo pipefail
cd "$(dirname "$0")/.."

PY=${PYTHON:-python3}

if [ ! -x ./caddy ]; then
  echo "No ./caddy binary found — run scripts/fetch-caddy.sh first." >&2
  exit 1
fi

mkdir -p logs

echo "Starting healthcheck backend (:8081)..."
nohup "$PY" healthcheck/api-server.py >> logs/healthcheck.log 2>&1 &
echo $! > logs/healthcheck.pid

echo "Starting Prism backend (:8082)..."
nohup "$PY" prism/api-server.py >> logs/prism.log 2>&1 &
echo $! > logs/prism.pid

echo "Starting Caddy (:8080)..."
nohup ./caddy run --config Caddyfile >> logs/caddy.log 2>&1 &
echo $! > logs/caddy.pid

# Wait for readiness (bounded)
sleep 1
for i in $(seq 1 15); do
  if curl -sf http://127.0.0.1:8082/status >/dev/null 2>&1 \
     && curl -sf http://127.0.0.1:8080/prism/ >/dev/null 2>&1; then
    echo
    echo "Stack is up:"
    echo "  Prism        http://localhost:8080/prism/"
    echo "  Healthcheck  http://localhost:8080/healthcheck/"
    echo "  Logs         ./logs/"
    exit 0
  fi
  sleep 1
done

echo "Stack did not become ready in time — check ./logs/" >&2
exit 1
