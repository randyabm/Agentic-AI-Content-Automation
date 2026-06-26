-- Migration 008: Drop dead enum values + drop the dead `posts.status` column.
--
-- Postgres < 17 doesn't support `ALTER TYPE ... DROP VALUE` (added in 17),
-- so we use the standard recreate-enum dance: new enum → swap column → drop old.
--
-- All values in scope have been confirmed dead by audit (2026-06-26):
--   - publishstatus.draft       : never written (default only, immediately moved to scheduled/publishing)
--   - publishstatus.partial     : only set by the Zernio dispatcher; in dev (mock mode) the value
--                                 is unreachable; Zernio is not in production use
--   - poststatus                : the entire `posts.status` column is dead — posts are created
--                                 with `ready` and never transition; the per-image `post_images.status`
--                                 is the real visual-slot state
--   - analysisstatus.comparing  : in the enum + watchdog + UI filter, never written
--   - orgstatus.suspended       : in the enum, never written
--
-- Before DDL we UPDATE any rows that happen to have the values (verified zero in the live DB,
-- but the UPDATE is included so the migration is safe to re-run against any environment).

BEGIN;

-- 1. Preserve any rows currently in the to-be-dropped states.
UPDATE scheduled_posts SET status = 'published' WHERE status = 'partial';
UPDATE competitors    SET analysis_status = 'completed' WHERE analysis_status = 'comparing';
UPDATE organizations  SET status = 'active' WHERE status = 'suspended';

-- 2. Drop the dead `posts.status` column (and the enum type it uses).
ALTER TABLE posts DROP COLUMN status;
DROP TYPE IF EXISTS poststatus;

-- 3. Recreate the publishstatus enum without the dead values.
CREATE TYPE publishstatus_new AS ENUM (
    'scheduled', 'publishing', 'published', 'failed', 'retrying', 'throttled'
);
ALTER TABLE scheduled_posts
    ALTER COLUMN status DROP DEFAULT,
    ALTER COLUMN status TYPE publishstatus_new USING status::text::publishstatus_new;
DROP TYPE publishstatus;
ALTER TYPE publishstatus_new RENAME TO publishstatus;
-- Restore the default that the model declares (PublishStatus.scheduled)
ALTER TABLE scheduled_posts ALTER COLUMN status SET DEFAULT 'scheduled';

-- 4. Recreate the analysisstatus enum without the dead `comparing` value.
CREATE TYPE analysisstatus_new AS ENUM (
    'pending', 'crawling', 'extracting', 'completed', 'failed'
);
ALTER TABLE competitors
    ALTER COLUMN analysis_status TYPE analysisstatus_new
        USING analysis_status::text::analysisstatus_new;
DROP TYPE analysisstatus;
ALTER TYPE analysisstatus_new RENAME TO analysisstatus;

-- 5. Recreate the orgstatus enum without the dead `suspended` value.
CREATE TYPE orgstatus_new AS ENUM ('active');
ALTER TABLE organizations
    ALTER COLUMN status DROP DEFAULT,
    ALTER COLUMN status TYPE orgstatus_new USING status::text::orgstatus_new;
DROP TYPE orgstatus;
ALTER TYPE orgstatus_new RENAME TO orgstatus;
ALTER TABLE organizations ALTER COLUMN status SET DEFAULT 'active';

COMMIT;
