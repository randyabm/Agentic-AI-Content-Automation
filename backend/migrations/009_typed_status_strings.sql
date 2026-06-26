-- Migration 009: Type the two remaining stringly-typed status fields.
--
--   - article_sources.last_sync_status: was a String(50) with values
--     '' | 'running' | 'ok' | 'error'. The empty string was the
--     "idle" pseudo-state, with no validation. Now a proper enum;
--     '' rows are backfilled to 'idle'.
--   - OnboardingJob.steps[*].status: still lives in a JSONB array, but
--     the Python writer now uses the OnboardingStepStatus enum, so a
--     typo is caught at the call site. No DDL change is needed for the
--     JSON data.

BEGIN;

DO $$ BEGIN
    CREATE TYPE articlesourcesyncstatus AS ENUM ('idle', 'running', 'ok', 'error');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Backfill '' → 'idle' before changing the column type.
UPDATE article_sources SET last_sync_status = 'idle' WHERE last_sync_status = '';

-- Convert the column. Postgres refuses a direct cast String→enum when the
-- string is not in the enum's value set, so we go through text + a CHECK.
ALTER TABLE article_sources
    ALTER COLUMN last_sync_status DROP DEFAULT,
    ALTER COLUMN last_sync_status TYPE articlesourcesyncstatus
        USING last_sync_status::articlesourcesyncstatus,
    ALTER COLUMN last_sync_status SET DEFAULT 'idle',
    ALTER COLUMN last_sync_status SET NOT NULL;

COMMIT;
