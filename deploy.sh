#!/usr/bin/env bash
# Restarts the static server so it's serving whatever is currently on disk.
# No build step — this repo is plain HTML/JS, "deploy" just means "serve fresh".
set -euo pipefail

PORT="${PORT:-8090}"
cd "$(dirname "${BASH_SOURCE[0]}")"

pkill -f "http.server $PORT" 2>/dev/null || true
sleep 1

setsid nohup python3 -m http.server "$PORT" --bind 0.0.0.0 > /tmp/aio-test-dashboard-server.log 2>&1 < /dev/null &
disown
sleep 1

if curl -sS -o /dev/null -w '%{http_code}' "http://localhost:$PORT/index.html" | grep -q 200; then
  echo "Deployed. Reachable on the tailnet at http://100.113.189.96:$PORT/"
else
  echo "Server did not come up — check /tmp/aio-test-dashboard-server.log" >&2
  exit 1
fi
