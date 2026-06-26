-- Migration 008: Drop dead enum values + drop the dead `posts.status` column.
--
-- All values in scope have been confirmed dead by audit (2026-06-26):
--   - publishstatus.draft       : never written (default only, immediately moved to scheduled/publishing)
--   - publishstatus.partial     : only set by the Zernio dispatcher; in dev (mock mode) the value
--                                 is unreachable; Zernio is not in production use
--   - poststatus                : the entire `posts.status` column is dead — posts are created
--                                 with `ready` and never transition; the per-image `post_images.status`
--                                 is what actually tracks visual-slot state
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

-- 3. Drop the unused enum values.
ALTER TYPE publishstatus   DROP VALUE IF EXISTS 'draft';
ALTER TYPE publishstatus   DROP VALUE IF EXISTS 'partial';
ALTER TYPE analysisstatus  DROP VALUE IF EXISTS 'comparing';
ALTER TYPE orgstatus       DROP VALUE IF EXISTS 'suspended';

COMMIT;
