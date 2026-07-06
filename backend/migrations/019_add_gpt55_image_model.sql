-- Migration 019: add the GPT-5.5 image model (OpenAI Responses API path).
-- The seed only creates image_models rows on a fresh DB, so already-seeded
-- environments need this one-time insert. Provider "openai_responses" resolves
-- the central OpenAI credential at runtime, so no per-row key is stored.
-- Idempotent: the WHERE NOT EXISTS guard skips the row if it already exists.

INSERT INTO image_models (id, display_name, provider, model_name, api_key_encrypted, is_default, is_active)
SELECT gen_random_uuid(), 'GPT-5.5 (OpenAI Responses)', 'openai_responses', 'gpt-5.5', '', false, true
WHERE NOT EXISTS (
    SELECT 1 FROM image_models
    WHERE provider = 'openai_responses' AND model_name = 'gpt-5.5'
);
