-- Campaign-level approval workflow (SocialFlow concept UI).
-- Adds approval columns to the campaigns table so the entire campaign
-- can be submitted, reviewed, approved/rejected, or changes requested.

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS approval_status VARCHAR(30) NOT NULL DEFAULT 'draft';

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS assigned_approver_id VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS approval_scope VARCHAR(20) NOT NULL DEFAULT 'full_campaign';

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS approval_due_date DATE;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS approval_message TEXT DEFAULT '';

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(36);

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS review_note TEXT DEFAULT '';
