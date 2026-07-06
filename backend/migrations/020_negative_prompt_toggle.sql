-- Migration 020: add the negative_prompt_enabled setting.
-- DEFAULT_SETTINGS only seeds on first boot, so already-seeded environments need
-- this one-time insert. Defaults to 'true' to preserve current behavior.
-- Idempotent: ON CONFLICT keeps any admin-chosen value already present.

INSERT INTO settings (key, value, description)
VALUES (
    'negative_prompt_enabled',
    'true',
    'Show and use the Negative prompt field in image/video generation. Turn OFF to hide it from the UI and ignore any stored negative prompts during generation (functionality is preserved, not removed).'
)
ON CONFLICT (key) DO NOTHING;
