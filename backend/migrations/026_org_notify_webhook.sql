-- Migration 026: optional Slack/Teams incoming-webhook URL per org (Phase 3).
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS notify_webhook_url VARCHAR(500) NOT NULL DEFAULT '';
