#!/bin/bash
set -e

BRANCH=${1:-master}

echo "=== Marketing AI Platform — Deploy ($BRANCH) ==="
echo "$(date)"

git pull origin "$BRANCH"

docker compose -f docker-compose.prod.yml build api worker beat frontend
docker compose -f docker-compose.prod.yml up -d

# Nginx caches container IPs — must restart after every build so it picks up new IPs
docker compose -f docker-compose.prod.yml restart nginx cloudflared

docker compose -f docker-compose.prod.yml ps
echo "=== Deploy complete ==="
