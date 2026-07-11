-- Migration 022 (PR-B): re-scope the posts.approval_status enum from the legacy
-- value set {draft, pending_review, approved, rejected} to the PRD value set
-- {not_required, pending, approved, rejected}. content_status (added in 021)
-- already carries the authoring stage, so approval_status now only encodes the
-- publish gate.
--
-- Recreate-enum dance (same pattern as migrations 008/009): PG cannot ALTER an
-- enum's members in place while a column depends on it, so we create a new type,
-- retype the column with an explicit value mapping, drop the old type, rename.
--
-- Value mapping (legacy -> new):
--   draft          -> pending   (was "not submitted / not publishable"; stays
--                                un-publishable. content_status=draft keeps it
--                                out of the review queue.)
--   pending_review -> pending
--   approved       -> approved
--   rejected       -> rejected
-- No existing rows map to not_required (no brand has opted out yet — that value
-- is produced going forward by the per-brand approval_required=false path).

CREATE TYPE approvalstatus_new AS ENUM ('not_required', 'pending', 'approved', 'rejected');

ALTER TABLE posts ALTER COLUMN approval_status DROP DEFAULT;

ALTER TABLE posts
    ALTER COLUMN approval_status TYPE approvalstatus_new
    USING (CASE approval_status::text
            WHEN 'draft'          THEN 'pending'
            WHEN 'pending_review' THEN 'pending'
            WHEN 'approved'       THEN 'approved'
            WHEN 'rejected'       THEN 'rejected'
            ELSE 'pending'
        END)::approvalstatus_new;

DROP TYPE approvalstatus;
ALTER TYPE approvalstatus_new RENAME TO approvalstatus;

ALTER TABLE posts ALTER COLUMN approval_status SET DEFAULT 'pending';
ALTER TABLE posts ALTER COLUMN approval_status SET NOT NULL;
