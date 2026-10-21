#!/usr/bin/env bash
# Deploy the latest `main` to the lab laptop (test-team@10.32.2.135), the box that serves the
# dashboard on :8090 (and the old T7-Dashboard on :8091). Before 21 Oct 2026 that was fw2.
# Run it from any machine that can SSH to it without a password (e.g. Tariq's PC).
#
#   scripts/deploy-lab.sh             # pull origin/main on the laptop and restart the backend
#   scripts/deploy-lab.sh --dry-run   # check the connection and show what would be deployed
#
# "Latest" means what is on origin/main — the laptop does `git pull --ff-only` itself, so anything
# not committed AND pushed is not deployed. This script refuses to run with local changes
# so you don't think they went out. Overrides: LAB_USER, LAB_HOST, LAB_DIR, LAB_PORT.
set -euo pipefail

LAB_USER="${LAB_USER:-test-team}"
LAB_HOST="${LAB_HOST:-10.32.2.135}"
LAB_DIR="${LAB_DIR:-/home/test-team/aio-test-dashboard}"
LAB_PORT="${LAB_PORT:-8090}"
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1

cd "$(dirname "${BASH_SOURCE[0]}")/.."
# a real run stops on a local problem; a dry run just reports it
problem() { echo "$1" >&2; [ "$DRY" = 1 ] || exit 1; }
ssh_lab() { ssh -o BatchMode=yes -o ConnectTimeout=8 -o LogLevel=ERROR "$LAB_USER@$LAB_HOST" "$@"; }

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
  echo "(could not reach origin from here — skipping local checks; the laptop pulls from origin itself)"
fi
git log -1 --format='Will deploy origin/main: %h %s' origin/main 2>/dev/null || true

echo "== lab laptop ($LAB_USER@$LAB_HOST)"
if ! ssh_lab true 2>/dev/null; then
  echo "Cannot SSH to $LAB_USER@$LAB_HOST without a password. Set it up once with:" >&2
  echo "  ssh-copy-id $LAB_USER@$LAB_HOST" >&2; exit 1
fi
echo "Currently running: $(ssh_lab "cd '$LAB_DIR' && git log -1 --format='%h %s'")"
dirty="$(ssh_lab "cd '$LAB_DIR' && git status --porcelain | wc -l")"
[ "$dirty" -gt 0 ] && echo "Note: the laptop has $dirty uncommitted file(s) in $LAB_DIR — a pull can fail if they clash with incoming changes."

if [ "$DRY" = 1 ]; then echo "Dry run — nothing pulled or restarted."; exit 0; fi

echo "== Deploying"
ssh_lab "cd '$LAB_DIR' && git pull --ff-only origin main && ./deploy.sh"

echo "== Verify"
want="$(git rev-parse --short origin/main 2>/dev/null || true)"
got="$(ssh_lab "cd '$LAB_DIR' && git rev-parse --short HEAD")"
echo "The laptop is on $got${want:+ (origin/main is $want)}"
[ -z "$want" ] || [ "$want" = "$got" ] || { echo "The laptop is NOT on origin/main." >&2; exit 1; }
curl -fsS -m 8 "http://$LAB_HOST:$LAB_PORT/api/status" >/dev/null && echo "App answering at http://$LAB_HOST:$LAB_PORT/" \
  || { echo "App did not answer on :$LAB_PORT — check journalctl --user -u aio-test-dashboard on the laptop." >&2; exit 1; }
