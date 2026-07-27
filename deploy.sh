#!/bin/bash
# One-command deploy for EatTailor: MacBook (this repo) to the Mac mini.
# The app RUNS from /Users/eric/eattailor-app on the mini (launchd com.eric.eattailor),
# NOT from this dev directory. This script syncs changed source files, restarts the
# service, and verifies the public URL responds.
#
# Usage: ./deploy.sh
# Optional: ./deploy.sh --commit   (also commits on the mini repo with a message)
set -euo pipefail
cd "$(dirname "$0")"

FILES="app.js app.html index.html auth.html server.js chat-core.js cron.js strava-helper.js strava-integration.js firestore-helpers.js settings.js onboarding.js firebase-config.js style.css service-worker.js manifest.json package.json"

echo ">> Syntax check (server-side files)"
node --check server.js
node --check chat-core.js
node --check app.js

echo ">> Syncing source files to mini"
for f in $FILES; do
  [ -f "$f" ] && scp -q -o BatchMode=yes "$f" mini:~/eattailor-app/"$f"
done

echo ">> Verifying checksums"
FAIL=0
for f in $FILES; do
  [ -f "$f" ] || continue
  LOCAL=$(shasum "$f" | awk '{print $1}')
  REMOTE=$(ssh -o BatchMode=yes mini "shasum ~/eattailor-app/$f" 2>/dev/null | awk '{print $1}')
  if [ "$LOCAL" != "$REMOTE" ]; then echo "!! MISMATCH: $f"; FAIL=1; fi
done
[ "$FAIL" = "1" ] && { echo "Checksum mismatch, aborting before restart."; exit 1; }

if [ "${1:-}" = "--commit" ]; then
  echo ">> Committing on mini"
  ssh -o BatchMode=yes mini "cd ~/eattailor-app && git add -A && git -c user.name='Eric Fleshman' -c user.email='eric.fleshman@gmail.com' commit -q -m 'deploy: sync from MacBook $(date +%Y-%m-%d)' || true"
fi

echo ">> Restarting service"
ssh -o BatchMode=yes mini 'launchctl kickstart -k gui/$(id -u)/com.eric.eattailor'

echo ">> Verifying public URL"
sleep 4
CODE=$(curl -s -o /dev/null -w "%{http_code}" -m 20 https://erics-mac-mini.tail6938d5.ts.net)
echo ">> https://erics-mac-mini.tail6938d5.ts.net -> HTTP $CODE"
[ "$CODE" = "200" ] && echo ">> DEPLOY OK" || { echo ">> DEPLOY CHECK FAILED (HTTP $CODE). Check: ssh mini 'tail -30 ~/eattailor-app/server.log'"; exit 1; }
