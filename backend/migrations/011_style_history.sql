-- Migration 011: Style history table.
--
-- One row per (org, client, style_family) generated. Used by the
-- repetition-penalty block in the Visual Agent prompt to avoid
-- regenerating the same family repeatedly for the same client, and by
-- the style_alternatives endpoint to propose 3 families different from
-- the ones the user has just seen.
--
-- The image_prompt_hash is for future image-similarity detection (Stage
-- 3.3) — perceptual hashes of the generated image — so two visually
-- similar outputs with the same family still count as a repeat.

BEGIN;

CREATE TABLE style_history (
    id                  UUID         PRIMARY KEY,
    org_id              UUID         NOT NULL,
    client_id           UUID         NULL,
    style_family        VARCHAR(64)  NOT NULL,
    style_card_id       VARCHAR(64)  NULL,
    image_id            UUID         NULL,
    image_prompt_hash   VARCHAR(64)  NULL,
    source              VARCHAR(32)  NOT NULL DEFAULT 'generation',  -- 'generation' | 'style_alternatives' | 'manual_override'
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- The hot path: "give me the last N style_families for this client".
CREATE INDEX idx_style_history_client_recent
    ON style_history(org_id, client_id, created_at DESC);

-- For brand-wide queries (client_id IS NULL) — same shape so the index
-- also serves the brand-wide penalty block.
CREATE INDEX idx_style_history_brand_recent
    ON style_history(org_id, created_at DESC)
    WHERE client_id IS NULL;

-- For future similarity detection: lookup by image_prompt_hash.
CREATE INDEX idx_style_history_prompt_hash
    ON style_history(image_prompt_hash)
    WHERE image_prompt_hash IS NOT NULL;

COMMIT;
