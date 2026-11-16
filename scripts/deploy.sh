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
# the host's activate script reads variables it never sets, so strict mode is off while it runs
# shellcheck disable=SC1090
set +u
source "$NODE_VENV"
set -u
log "node $(node -v)"

if [ ! -d .git ]; then
  log "turning $APP_ROOT into a checkout of $REPO"
  git init -q
  git remote add origin "$REPO"
fi
# The host limits how many threads a user may run ("unable to create thread"): one thread, and only the newest commit.
git -c pack.threads=1 -c index.threads=1 fetch -q --depth 1 origin "$BRANCH"
git reset -q --hard FETCH_HEAD
log "at $(git log -1 --format='%h %s')"

# The host caps how many threads a user may run, and node aborts (core dumped) when it cannot start its own: fewer threads for node,
# no core files (they would eat the disk quota), and npm told to open few connections.
ulimit -c 0 || true
# Prisma's migration engine and its helpers are threaded too
export TOKIO_WORKER_THREADS=1 RAYON_NUM_THREADS=1
export UV_THREADPOOL_SIZE=2
export NODE_OPTIONS="--v8-pool-size=1 --max-old-space-size=${NODE_HEAP_MB:-1536}"
log "threads allowed: $(ulimit -u), running now: $(ps -u "$(id -un)" -L 2>/dev/null | wc -l)"
# the packages are installed only when the lock file changed since the last good install
LOCK_HASH="$(sha256sum package-lock.json | cut -d' ' -f1)"
if [ -d node_modules ] && [ "$(cat node_modules/.deploy-lock-hash 2>/dev/null)" = "$LOCK_HASH" ]; then
  log "packages unchanged"
else
  npm install --include=dev --no-audit --no-fund --maxsockets=2 --prefer-offline
  echo "$LOCK_HASH" > node_modules/.deploy-lock-hash
fi
find . -maxdepth 1 -name 'core.*' -delete 2>/dev/null || true
set -a; . ./.env; set +a
npx prisma migrate deploy
NEXT_BUILD_CPUS="${NEXT_BUILD_CPUS:-1}" npm run build:cpanel

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
  [ "$code" = "200" ] || { log "the site did not answer 200 on /api/health: if the Node.js app was stopped for the deploy, press Start App in cPanel (Setup Node.js App)"; exit 3; }
fi
log "done"
