-- Migration 015: Drop PostImage.text_overlay column.
--
-- Phase 2 of the visual-style-pipeline ("layout engine safety net" + a
-- "Rebuild text" button) added a JSONB column to persist the structured
-- marketing copy (headline / subtext / cta / emphasis_word / chips) so a
-- Pillow overlay could re-render the copy on top of the AI's base image.
-- The feature shipped on feature/visual-style-pipeline (commits 394f7ed +
-- 7e5df2d) but the user did not want it; those commits were reset off
-- the branch. With no reader, no writer, and no UI surface, the column
-- is now dead data. Drop it.
--
-- Safe to run on rows that still have a non-default value — the test
-- data we set on the i4T Global image during the Phase-2 smoke test
-- goes away with the column.

BEGIN;

ALTER TABLE post_images
    DROP COLUMN IF EXISTS text_overlay;

COMMIT;
