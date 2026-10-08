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

# The server is ES-module Node (>= 20). A non-interactive shell (e.g. `ssh host ./deploy.sh`)
# does not load nvm and can find an ancient /usr/bin/node first, so pick explicitly — and do
# it BEFORE stopping the running server, so a bad Node aborts the deploy instead of taking
# the app down.
node_major() { "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
NODE=""
for cand in "$(command -v node || true)" $(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tac); do
  if [ -n "$cand" ] && [ "$(node_major "$cand")" -ge 20 ]; then NODE="$cand"; break; fi
done
if [ -z "$NODE" ]; then
  echo "Need Node >= 20 (found: $(command -v node || echo none)). Nothing was stopped." >&2; exit 1
fi

# the old python static server, if one is still around, and any previous backend
pkill -f "[h]ttp.server $PORT" 2>/dev/null || true
pkill -f "[n]ode server/server.mjs" 2>/dev/null || true
sleep 1

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
