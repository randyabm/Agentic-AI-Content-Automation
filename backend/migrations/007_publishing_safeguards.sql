-- Publishing safeguards (anti-block queue, retries, duplicate detection).
-- See PLAN_publishing_safeguards.md for the design.
--
-- Adds per-post retry / throttle state plus a content fingerprint so the due
-- sweep can throttle by account, retry transient failures with backoff, and
-- warn on duplicate content. The two new enum values are added in their own
-- statements because PG forbids using a freshly-added enum value in the same
-- transaction that added it.

-- 1) New columns on scheduled_posts
ALTER TABLE scheduled_posts
  ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0;

ALTER TABLE scheduled_posts
  ADD COLUMN IF NOT EXISTS max_retries INT NOT NULL DEFAULT 4;

ALTER TABLE scheduled_posts
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NULL;

ALTER TABLE scheduled_posts
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ NULL;

ALTER TABLE scheduled_posts
  ADD COLUMN IF NOT EXISTS error_code VARCHAR(40) NOT NULL DEFAULT '';

ALTER TABLE scheduled_posts
  ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64) NOT NULL DEFAULT '';

ALTER TABLE scheduled_posts
  ADD COLUMN IF NOT EXISTS attempt_history JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 2) Index for the due sweep (status + scheduled_at + next_attempt_at) and
--    the duplicate lookup (account + content_hash).
CREATE INDEX IF NOT EXISTS ix_scheduled_posts_due
  ON scheduled_posts (status, scheduled_at, next_attempt_at);

CREATE INDEX IF NOT EXISTS ix_scheduled_posts_dup
  ON scheduled_posts (social_account_id, content_hash);

-- 3) New publishstatus enum values. Each ADD VALUE in its own statement.
ALTER TYPE publishstatus ADD VALUE IF NOT EXISTS 'retrying';
ALTER TYPE publishstatus ADD VALUE IF NOT EXISTS 'throttled';
