#!/bin/sh
# Copy the mounted (read-only, deplyuser-owned) deploy key + known_hosts into a
# root-owned ~/.ssh with strict perms, so git-over-SSH works when deploy.sh runs
# as root inside this container. ssh rejects key/config files it considers
# wrongly-owned, so a straight read-only mount of /root/.ssh does not work.
set -e
if [ -d /ssh-src ]; then
    mkdir -p /root/.ssh
    [ -f /ssh-src/id_ed25519 ] && cp -f /ssh-src/id_ed25519 /root/.ssh/id_ed25519
    [ -f /ssh-src/known_hosts ] && cp -f /ssh-src/known_hosts /root/.ssh/known_hosts
    chmod 700 /root/.ssh
    chmod 600 /root/.ssh/id_ed25519 2>/dev/null || true
    chmod 644 /root/.ssh/known_hosts 2>/dev/null || true
fi
exec python -u server.py
