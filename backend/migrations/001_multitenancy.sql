-- Phase 0 — Multi-tenancy + roles migration (SOCIAL_PUBLISHING_PLAN.md).
--
-- There is no Alembic in this project: `Base.metadata.create_all` at API startup
-- creates the new `organizations` table automatically, but it will NOT add
-- columns to the existing users/clients/posts tables. Run this script once
-- against the running DB to add those columns and their enum types:
--
--   docker compose exec -T db psql -U marketing marketing < backend/migrations/001_multitenancy.sql
--
-- Idempotent: safe to run more than once. The data backfill (default org,
-- assigning existing rows, mapping roles, creating the platform admin) is done
-- idempotently in app/services/seed.py on the next API boot.

BEGIN;

-- 1. Enum types for the new columns on EXISTING tables. (The `orgstatus` type and
--    `organizations` table are created by create_all, so they're not here.)
DO $$ BEGIN
    CREATE TYPE orgrole AS ENUM ('org_admin', 'analyst', 'creative', 'reviewer', 'viewer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE approvalstatus AS ENUM ('draft', 'pending_review', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. users — org membership + platform-admin flag (legacy `role` retained).
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id VARCHAR(36) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS org_role orgrole;
CREATE INDEX IF NOT EXISTS ix_users_org_id ON users (org_id);

-- 3. clients — tenant root + Zernio profile.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS org_id VARCHAR(36) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS zernio_profile_id VARCHAR(64) NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS ix_clients_org_id ON clients (org_id);

-- 4. posts — approval/review gate.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS approval_status approvalstatus NOT NULL DEFAULT 'draft';
ALTER TABLE posts ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(36);
ALTER TABLE posts ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS review_note TEXT NOT NULL DEFAULT '';

COMMIT;
