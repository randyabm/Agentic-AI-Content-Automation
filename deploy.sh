#!/bin/bash
set -e

echo "=== Marketing AI Platform — Deploy ==="
echo "$(date)"

git pull origin master

docker compose -f docker-compose.prod.yml build --no-cache api worker beat frontend
docker compose -f docker-compose.prod.yml up -d

docker compose -f docker-compose.prod.yml ps
echo "=== Deploy complete ==="
