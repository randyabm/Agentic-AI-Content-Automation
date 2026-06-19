-- Migration 002: Direct social publishing support.
-- Run: docker compose exec db psql -U marketing marketing -f /migrations/002_direct_social.sql

-- OAuth app credentials: add api_secret_encrypted (App Secret / Consumer Secret / Client Secret)
ALTER TABLE provider_credentials
    ADD COLUMN IF NOT EXISTS api_secret_encrypted TEXT DEFAULT '';

-- Per-channel direct OAuth tokens (encrypted). Zernio columns remain untouched.
ALTER TABLE social_accounts
    ADD COLUMN IF NOT EXISTS access_token_encrypted      TEXT    DEFAULT '',
    ADD COLUMN IF NOT EXISTS access_token_secret_encrypted TEXT  DEFAULT '',
    ADD COLUMN IF NOT EXISTS refresh_token_encrypted     TEXT    DEFAULT '',
    ADD COLUMN IF NOT EXISTS platform_account_id         VARCHAR(255) DEFAULT '';

-- Platform-native post ID for direct-mode publishes (Zernio stores its own id in zernio_post_id).
ALTER TABLE scheduled_posts
    ADD COLUMN IF NOT EXISTS external_post_id VARCHAR(255) DEFAULT '';
