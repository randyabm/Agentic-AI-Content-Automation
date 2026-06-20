#!/bin/bash
# Push current branch to GitHub and deploy it to the server immediately.
# Usage:  bash scripts/push-deploy.sh [branch]
# If branch is omitted, uses the current git branch.
#
# Reads SSH credentials from .env in the repo root:
#   SERVER_HOST, SERVER_USER, SERVER_PW, SERVER_HOSTKEY

set -e

# Load .env from repo root
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$REPO_ROOT/.env"

if [ -f "$ENV_FILE" ]; then
  # Export only the SSH vars we need, without polluting the shell
  export $(grep -E '^(SERVER_HOST|SERVER_USER|SERVER_PW|SERVER_HOSTKEY)=' "$ENV_FILE" | xargs)
fi

SERVER_HOST="${SERVER_HOST:-192.168.0.239}"
SERVER_USER="${SERVER_USER:-deplyuser}"
SERVER_PW="${SERVER_PW:?'.env is missing SERVER_PW'}"
SERVER_HOSTKEY="${SERVER_HOSTKEY:?'.env is missing SERVER_HOSTKEY'}"

BRANCH="${1:-$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)}"

echo "==> Pushing branch '$BRANCH' to GitHub..."
git -C "$REPO_ROOT" push -u origin "$BRANCH"

echo "==> Triggering deploy on server..."

# Use plink (Windows/Linux PuTTY) if available, otherwise fall back to sshpass+ssh
if command -v plink &>/dev/null; then
  plink -ssh \
    -pw "$SERVER_PW" \
    -hostkey "$SERVER_HOSTKEY" \
    -batch \
    "${SERVER_USER}@${SERVER_HOST}" \
    "cd ~/app && bash deploy.sh '$BRANCH' >> /tmp/deploy.log 2>&1 && docker compose -f docker-compose.prod.yml restart nginx cloudflared && echo 'Deploy complete'"
elif command -v sshpass &>/dev/null; then
  sshpass -p "$SERVER_PW" ssh \
    -o StrictHostKeyChecking=no \
    "${SERVER_USER}@${SERVER_HOST}" \
    "cd ~/app && bash deploy.sh '$BRANCH' >> /tmp/deploy.log 2>&1 && docker compose -f docker-compose.prod.yml restart nginx cloudflared && echo 'Deploy complete'"
else
  echo ""
  echo "ERROR: Neither 'plink' nor 'sshpass' found."
  echo "Install one of them, or run the deploy manually:"
  echo "  plink -ssh -pw \"$SERVER_PW\" -hostkey \"$SERVER_HOSTKEY\" -batch ${SERVER_USER}@${SERVER_HOST} \"cd ~/app && bash deploy.sh '$BRANCH'\""
  exit 1
fi

echo "==> Done. Check https://marketingaidev.randybeltran.xyz"
