#!/bin/bash
set -e

BRANCH=${1:-competitor-pipeline-speedup}

echo "=== Marketing AI Platform — Deploy ($BRANCH) ==="
echo "$(date)"

git pull origin "$BRANCH"

docker compose -f docker-compose.prod.yml build api worker beat frontend
docker compose -f docker-compose.prod.yml up -d

docker compose -f docker-compose.prod.yml ps
echo "=== Deploy complete ==="
