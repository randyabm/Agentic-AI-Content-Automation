-- Migration 013: Bump max_tokens on visual_agent + editorial_agent to 8192.
--
-- After the Stage-1.3 prompt rewrite (text-in-image) the visual agent's
-- JSON output for a 4-element campaign is ~4-6 KB. The previous 4096-token
-- cap was regularly hit mid-array, the response got truncated, and the
-- whole generation failed with 'Could not parse the LLM response as
-- JSON: Expecting , delimiter'. Sonnet supports up to 8192 output
-- tokens, so we cap there. The editorial_agent has the same growth
-- pattern (per-platform copy for multi-platform campaigns).
--
-- Idempotent: the WHERE clause only touches rows that are still at
-- the old default (or below 8192). An admin who explicitly set a
-- higher max_tokens is left alone.

BEGIN;

UPDATE llm_configs
SET max_tokens = 8192
WHERE function IN ('visual_agent', 'editorial_agent')
  AND max_tokens < 8192;

COMMIT;
