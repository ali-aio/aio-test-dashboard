#!/usr/bin/env bash
# Restarts the backend so it's serving whatever is currently on disk.
# No build step — this repo is plain HTML/JS; server/ is dependency-free Node.
set -euo pipefail

PORT="${PORT:-8090}"
cd "$(dirname "${BASH_SOURCE[0]}")"

if [ ! -f server/config.json ] && [ -z "${MDM_API_KEY:-}" ]; then
  echo "No server/config.json (copy server/config.example.json and paste the QA key)." >&2
  echo "Starting anyway — pages work, but the cycle sweep stays off until a key is set." >&2
fi

# the old python static server, if one is still around, and any previous backend
pkill -f "[h]ttp.server $PORT" 2>/dev/null || true
pkill -f "[n]ode server/server.mjs" 2>/dev/null || true
sleep 1

NODE="$(command -v node || ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | tail -1)"
PORT="$PORT" setsid nohup "$NODE" server/server.mjs > /tmp/aio-test-dashboard-server.log 2>&1 < /dev/null &
disown
sleep 1

if curl -sS -o /dev/null -w '%{http_code}' "http://localhost:$PORT/index.html" | grep -q 200; then
  echo "Deployed. Reachable on the tailnet at http://100.113.189.96:$PORT/"
  curl -sS "http://localhost:$PORT/api/status"; echo
  echo "Log: /tmp/aio-test-dashboard-server.log"
else
  echo "Server did not come up — check /tmp/aio-test-dashboard-server.log" >&2
  exit 1
fi
