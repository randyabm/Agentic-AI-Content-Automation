-- Migration 025: per-brand approval routing template (Phase 3 workflow
-- templates). Defaults applied when a campaign is submitted without an explicit
-- approver / deadline.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS default_approver_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS default_approval_deadline_days INTEGER;
