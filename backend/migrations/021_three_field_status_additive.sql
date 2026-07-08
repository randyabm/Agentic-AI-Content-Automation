-- Migration 021 (PR-A, additive): introduce the 3-field approval/publish status
-- model WITHOUT re-typing the existing `approval_status` enum yet. This is the
-- zero-behavior-change half of the refactor:
--   * adds posts.content_status  (new enum contentstatus)
--   * adds posts.rejection_comment (dedicated reject reason)
--   * adds clients.approval_required (per-brand approval gate, FR-01)
-- and backfills the new columns from the CURRENT (legacy) approval_status text.
-- The legacy `approvalstatus` enum is re-scoped separately in migration 022.
-- Idempotent: guarded CREATE TYPE + ADD COLUMN IF NOT EXISTS + backfill only
-- touches rows that still hold defaults.

-- 1. content_status enum + column, backfilled from the legacy approval_status.
DO $$ BEGIN
    CREATE TYPE contentstatus AS ENUM ('draft', 'ready_for_review', 'changes_requested');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE posts ADD COLUMN IF NOT EXISTS content_status contentstatus;

UPDATE posts SET content_status = (CASE approval_status::text
        WHEN 'draft'          THEN 'draft'
        WHEN 'pending_review' THEN 'ready_for_review'
        WHEN 'approved'       THEN 'ready_for_review'
        WHEN 'rejected'       THEN 'changes_requested'
        ELSE 'draft'
    END)::contentstatus
WHERE content_status IS NULL;

ALTER TABLE posts ALTER COLUMN content_status SET DEFAULT 'draft';
ALTER TABLE posts ALTER COLUMN content_status SET NOT NULL;

-- 2. Dedicated rejection comment, backfilled from review_note for rejected posts.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS rejection_comment TEXT NOT NULL DEFAULT '';

UPDATE posts SET rejection_comment = COALESCE(review_note, '')
WHERE approval_status::text = 'rejected' AND rejection_comment = '';

-- 3. Per-brand approval gate (FR-01). Default true preserves current behavior.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS approval_required BOOLEAN NOT NULL DEFAULT true;
