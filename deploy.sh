#!/usr/bin/env bash
# Restarts the backend so it's serving whatever is currently on disk.
# server/ is dependency-free Node; dist/ is built and committed elsewhere (see CLAUDE.md).
set -euo pipefail

PORT="${PORT:-8090}"
HOST_ADDR="${HOST_ADDR:-100.120.184.6}"   # the lab laptop on our Tailscale tailnet
T7_PORT="${T7_PORT:-8091}"   # the old T7-Dashboard, served by the same process
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

# the old python static server, if one is still around
pkill -f "[h]ttp.server $PORT" 2>/dev/null || true

# Run it as a systemd user service so it comes back after a reboot (linger is on for this
# user, so the user manager starts at boot without a login). The unit is rewritten on every
# deploy with the Node picked above. Over SSH the runtime dir may be unset; point at it.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
UNIT=aio-test-dashboard.service
LOG="journalctl --user -u $UNIT"
if systemctl --user show-environment >/dev/null 2>&1; then
  mkdir -p "$HOME/.config/systemd/user"
  {
    echo "[Unit]"
    echo "Description=AIO Test Dashboard backend (port $PORT)"
    echo "After=network-online.target"
    echo
    echo "[Service]"
    echo "WorkingDirectory=$PWD"
    echo "Environment=PORT=$PORT"
    echo "Environment=T7_PORT=$T7_PORT"
    for v in MDM_API_KEY MDM_BASE CYCLES_GROUP SWEEP_MIN RATE_PER_MIN; do
      [ -n "${!v:-}" ] && echo "Environment=$v=${!v}"
    done
    echo "ExecStart=$NODE server/server.mjs"
    echo "Restart=on-failure"
    echo "RestartSec=5"
    echo
    echo "[Install]"
    echo "WantedBy=default.target"
  } > "$HOME/.config/systemd/user/$UNIT"
  chmod 600 "$HOME/.config/systemd/user/$UNIT"
  systemctl --user daemon-reload
  systemctl --user stop "$UNIT" 2>/dev/null || true
  pkill -f "[n]ode server/server.mjs" 2>/dev/null || true   # one started by an older deploy.sh
  sleep 1
  systemctl --user enable --now "$UNIT" >/dev/null 2>&1
else
  # no systemd user manager: the old way, which does not survive a reboot
  pkill -f "[n]ode server/server.mjs" 2>/dev/null || true
  sleep 1
  LOG=/tmp/aio-test-dashboard-server.log
  PORT="$PORT" T7_PORT="$T7_PORT" setsid nohup "$NODE" server/server.mjs > "$LOG" 2>&1 < /dev/null &
  disown
  LOG="cat $LOG"
fi
sleep 1

if curl -sS -o /dev/null -w '%{http_code}' "http://localhost:$PORT/index.html" | grep -q 200; then
  echo "Deployed. Reachable at http://$HOST_ADDR:$PORT/"
  curl -sS "http://localhost:$PORT/api/status"; echo
  echo "Log: $LOG"
  if curl -sS -o /dev/null -w '%{http_code}' "http://localhost:$T7_PORT/" | grep -q 200; then
    echo "Old T7-Dashboard on http://$HOST_ADDR:$T7_PORT/"
  else
    echo "Warning: the old T7-Dashboard is not answering on :$T7_PORT" >&2
  fi
else
  echo "Server did not come up — check: $LOG" >&2
  exit 1
fi
