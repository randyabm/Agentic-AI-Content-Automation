-- Configurable per-role capability matrix (RBAC). Sparse: a missing (org, role,
-- capability) row falls back to the application's default matrix, so existing orgs
-- need no backfill. create_all also creates this table on startup; this migration
-- makes the schema explicit and order-safe.
CREATE TABLE IF NOT EXISTS role_permissions (
    id          VARCHAR(36)  PRIMARY KEY,
    org_id      VARCHAR(36)  NOT NULL,
    role        VARCHAR(50)  NOT NULL,
    capability  VARCHAR(50)  NOT NULL,
    allowed     BOOLEAN      NOT NULL DEFAULT FALSE,
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_role_permissions_org_id ON role_permissions (org_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_role_permission
    ON role_permissions (org_id, role, capability);
