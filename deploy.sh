#!/bin/bash
# Wrapped in a brace group so bash reads the WHOLE script before executing it.
# deploy.sh may change between branches, and without this the checkout below
# could swap the file mid-run and corrupt execution.
{
set -e

BRANCH=${1:-master}

# Run from the repo root regardless of the caller's cwd. The GitHub webhook invokes
# this from inside its own container (cwd=/webhook) with the repo mounted alongside
# the script, so without this git would run in the wrong directory.
cd "$(dirname "$0")"

# Inside the webhook container git runs as root over a repo owned by deplyuser;
# without this git refuses with "detected dubious ownership". Harmless on the host.
git config --global --add safe.directory "$(pwd)" 2>/dev/null || true

echo "=== Marketing AI Platform — Deploy ($BRANCH) ==="
echo "$(date)"

# Deploy whatever branch was pushed: fetch it and force the working tree onto
# it (discarding any local drift), so pushing ANY branch deploys that branch's
# exact code regardless of what was previously checked out on the server.
git fetch origin "$BRANCH" --prune
git checkout -f -B "$BRANCH" "origin/$BRANCH"
git reset --hard "origin/$BRANCH"

docker compose -f docker-compose.prod.yml build api worker beat frontend
docker compose -f docker-compose.prod.yml up -d

# Nginx caches container IPs — must restart after every build so it picks up new IPs
docker compose -f docker-compose.prod.yml restart nginx cloudflared

docker compose -f docker-compose.prod.yml ps
echo "=== Deploy complete ($BRANCH) ==="
exit 0
}
