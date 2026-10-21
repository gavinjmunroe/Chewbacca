-- Add optional free-text description to circles.
-- Idempotent — safe to run multiple times.
ALTER TABLE circles ADD COLUMN IF NOT EXISTS description text;
