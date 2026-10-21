-- Amber Q&A: per-question follow-up prompts + a "waterfall" hint that tells
-- Amber which direction to gently steer a thread once the user has reflected.
-- Idempotent — ADD COLUMN IF NOT EXISTS.

ALTER TABLE questions ADD COLUMN IF NOT EXISTS followups jsonb;   -- array of follow-up prompt strings
ALTER TABLE questions ADD COLUMN IF NOT EXISTS waterfall text;    -- e.g. 'to_contacts' | 'to_personality' | null
