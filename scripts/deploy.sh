#!/usr/bin/env bash
# Deploys the main branch on the cPanel server (P14). Run by the GitHub Actions deploy workflow over SSH, or by hand in cPanel's Terminal:
#   bash ~/pos-system/scripts/deploy.sh
# It brings the checkout to origin/main (a folder that is not yet a git checkout becomes one; untracked files such as .env and storage/
# stay), installs, migrates, builds and restarts. It never seeds and never deletes data. Settings come from the .env file in the
# application root (the build needs APP_URL; the cPanel app panel's variables are not seen by an SSH session).
set -euo pipefail

APP_ROOT="${APP_ROOT:-$HOME/pos-system}"
NODE_VENV="${NODE_VENV:-$HOME/nodevenv/pos-system/22/bin/activate}"
REPO="${REPO:-https://github.com/pitchforgebd/pos-system.git}"
BRANCH="${BRANCH:-main}"

log() { printf '[deploy %s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

cd "$APP_ROOT"
if [ ! -f .env ]; then
  log "no .env in $APP_ROOT: create it first (see docs/CPANEL.md section 2)"; exit 2
fi
# shellcheck disable=SC1090
source "$NODE_VENV"
log "node $(node -v), npm $(npm -v)"

if [ ! -d .git ]; then
  log "turning $APP_ROOT into a checkout of $REPO"
  git init -q
  git remote add origin "$REPO"
fi
git fetch -q origin "$BRANCH"
git reset -q --hard "origin/$BRANCH"
log "at $(git log -1 --format='%h %s')"

npm install --include=dev --no-audit --no-fund
set -a; . ./.env; set +a
npx prisma migrate deploy
NEXT_BUILD_CPUS="${NEXT_BUILD_CPUS:-1}" NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=2048}" npm run build:cpanel

# restart the Node.js application (Passenger watches tmp/restart.txt; CloudLinux has its own command)
mkdir -p tmp && touch tmp/restart.txt
if command -v cloudlinux-selector >/dev/null 2>&1; then
  cloudlinux-selector restart --json --interpreter nodejs --app-root "$(basename "$APP_ROOT")" >/dev/null 2>&1 || true
fi
log "restarted"

if [ -n "${APP_URL:-}" ]; then
  sleep 5
  code=$(curl -s -o /dev/null -w '%{http_code}' "$APP_URL/api/health" || true)
  log "health: HTTP $code"
  [ "$code" = "200" ] || { log "the site did not answer 200 on /api/health"; exit 3; }
fi
log "done"
