#!/usr/bin/env bash
# Deploy the latest `main` to fw2, the box that serves the dashboard on :8090.
# Run it from any machine that can SSH to fw2 without a password (e.g. Tariq's PC).
#
#   scripts/deploy-fw2.sh             # pull origin/main on fw2 and restart the backend
#   scripts/deploy-fw2.sh --dry-run   # check the connection and show what would be deployed
#
# "Latest" means what is on origin/main — fw2 does `git pull --ff-only` itself, so anything
# not committed AND pushed is not deployed. This script refuses to run with local changes
# so you don't think they went out. Overrides: FW2_USER, FW2_HOST, FW2_DIR, FW2_PORT.
set -euo pipefail

FW2_USER="${FW2_USER:-hwpc02}"
FW2_HOST="${FW2_HOST:-100.113.189.96}"
FW2_DIR="${FW2_DIR:-/home/hwpc02/aio-test-dashboard}"
FW2_PORT="${FW2_PORT:-8090}"
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1

cd "$(dirname "${BASH_SOURCE[0]}")/.."
# a real run stops on a local problem; a dry run just reports it
problem() { echo "$1" >&2; [ "$DRY" = 1 ] || exit 1; }
ssh_fw2() { ssh -o BatchMode=yes -o ConnectTimeout=8 -o LogLevel=ERROR "$FW2_USER@$FW2_HOST" "$@"; }

echo "== Local checks"
if git fetch -q origin 2>/dev/null; then
  if [ -n "$(git status --porcelain)" ]; then
    problem "Uncommitted changes here — commit and push first, or they will not be deployed."
  fi
  ahead="$(git rev-list --count origin/main..HEAD)"
  if [ "$ahead" -gt 0 ]; then
    problem "$ahead local commit(s) not pushed — run 'git push' first, or they will not be deployed."
  fi
else
  echo "(could not reach origin from here — skipping local checks; fw2 pulls from origin itself)"
fi
git log -1 --format='Will deploy origin/main: %h %s' origin/main 2>/dev/null || true

echo "== fw2 ($FW2_USER@$FW2_HOST)"
if ! ssh_fw2 true 2>/dev/null; then
  echo "Cannot SSH to $FW2_USER@$FW2_HOST without a password. Set it up once with:" >&2
  echo "  ssh-copy-id $FW2_USER@$FW2_HOST" >&2; exit 1
fi
echo "Currently running: $(ssh_fw2 "cd '$FW2_DIR' && git log -1 --format='%h %s'")"
dirty="$(ssh_fw2 "cd '$FW2_DIR' && git status --porcelain | wc -l")"
[ "$dirty" -gt 0 ] && echo "Note: fw2 has $dirty uncommitted file(s) in $FW2_DIR — a pull can fail if they clash with incoming changes."

if [ "$DRY" = 1 ]; then echo "Dry run — nothing pulled or restarted."; exit 0; fi

echo "== Deploying"
ssh_fw2 "cd '$FW2_DIR' && git pull --ff-only origin main && ./deploy.sh"

echo "== Verify"
want="$(git rev-parse --short origin/main 2>/dev/null || true)"
got="$(ssh_fw2 "cd '$FW2_DIR' && git rev-parse --short HEAD")"
echo "fw2 is on $got${want:+ (origin/main is $want)}"
[ -z "$want" ] || [ "$want" = "$got" ] || { echo "fw2 is NOT on origin/main." >&2; exit 1; }
curl -fsS -m 8 "http://$FW2_HOST:$FW2_PORT/api/status" >/dev/null && echo "App answering at http://$FW2_HOST:$FW2_PORT/" \
  || { echo "App did not answer on :$FW2_PORT — check /tmp/aio-test-dashboard-server.log on fw2." >&2; exit 1; }
