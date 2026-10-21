-- Add LLM-derived classification columns to circles.
-- Idempotent — safe to run multiple times.
ALTER TABLE circles ADD COLUMN IF NOT EXISTS classified_kind text;
ALTER TABLE circles ADD COLUMN IF NOT EXISTS classified_fact text;
ALTER TABLE circles ADD COLUMN IF NOT EXISTS classified_at  timestamptz;
