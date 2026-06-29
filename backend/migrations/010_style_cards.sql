-- Migration 010: Style cards table.
--
-- Curated library of design "families" the Visual Creative Agent can choose
-- from. Each card describes a self-contained visual direction (composition,
-- palette, mood, anti-patterns) so generation isn't forced to invent a
-- direction from scratch on every call. Global cards are visible to every
-- org; brand-scoped cards (brand_id NOT NULL) override the global one of
-- the same family for that brand.
--
-- Seeded with 6 families by scripts/migrations/seed.py:
--   bold_typographic, lifestyle_ugc, editorial_collage, 3d_product_hero,
--   imperfect_hand_drawn, surreal_seasonal_scene.

BEGIN;

CREATE TABLE style_cards (
    id                      VARCHAR(64)  PRIMARY KEY,
    name                    VARCHAR(128) NOT NULL,
    family                  VARCHAR(64)  NOT NULL,
    description             TEXT         NOT NULL,
    best_for                TEXT[]       NOT NULL DEFAULT '{}',
    not_for                 TEXT[]       NOT NULL DEFAULT '{}',
    visual_cues             TEXT[]       NOT NULL DEFAULT '{}',
    negative_constraints    TEXT[]       NOT NULL DEFAULT '{}',
    is_global               BOOLEAN      NOT NULL DEFAULT TRUE,
    brand_id                UUID         NULL,
    is_active               BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_style_cards_family ON style_cards(family) WHERE is_active;
CREATE INDEX idx_style_cards_brand   ON style_cards(brand_id) WHERE brand_id IS NOT NULL;

COMMIT;
