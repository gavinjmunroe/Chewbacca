-- Per-user learned spelling dictionary for voice transcription.
-- Every time you confirm or correct a name to a preferred spelling, we store it
-- here and feed it (recency-first) into Groq's biasing prompt, so the transcript
-- starts using YOUR spelling next time. Wispr-Flow-style custom vocabulary.
-- Run once against Cloud SQL (same way as contact_embedding).

CREATE TABLE IF NOT EXISTS voice_vocabulary (
  owner_id   TEXT        NOT NULL,
  term       TEXT        NOT NULL,          -- the preferred spelling, as displayed
  term_key   TEXT        NOT NULL,          -- lower(trim(term)) for dedup
  contact_id BIGINT,                        -- the specific contact this spelling is for (owner-scoped)
  hits       INT         NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, term_key)
);

-- If the table already exists without the column (created before this change):
ALTER TABLE voice_vocabulary ADD COLUMN IF NOT EXISTS contact_id BIGINT;

-- Fast "most recently reinforced first" read for building the bias prompt.
CREATE INDEX IF NOT EXISTS voice_vocabulary_recent
  ON voice_vocabulary (owner_id, updated_at DESC);
