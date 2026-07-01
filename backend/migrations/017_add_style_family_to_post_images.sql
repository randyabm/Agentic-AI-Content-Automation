-- Migration 017: Add style_family column to post_images.
-- Stores the Visual Agent's style pick per image slot, including remix pairs
-- (e.g. "dark_mode_luxury+glassmorphism_layered") for display in the UI and
-- repetition-penalty tracking. VARCHAR(140) fits the longest possible remix id.

ALTER TABLE post_images
  ADD COLUMN IF NOT EXISTS style_family VARCHAR(140);
