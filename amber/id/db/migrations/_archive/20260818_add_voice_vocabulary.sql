-- The learned voice dictionary (Wispr-Flow-style self-training).
--
-- THIS MIGRATION IS A SAFETY NET AND A RECORD, NOT A CHANGE. The table already exists in
-- production, created outside this repo -- nothing in src/, db/ or scripts/ contains a
-- CREATE for it. Running this against prod was a verified no-op.
--
-- Its job is to make a FRESH environment match production. That matters because the
-- shape below was derived from what prod actually reports, not from what looked correct:
--
--   * owner_id is text, NOT uuid. Every other owner-scoped table here uses uuid, so uuid
--     is what I first wrote -- and it would have given a new environment a different
--     column type from prod, which is the "operator does not exist: uuid = text" class of
--     bug that only ever appears in the environment you did not test. src/lib/voice-vocab.js
--     passes the owner id with no cast, which works against either type, so text is kept
--     purely to match prod rather than because text is better.
--   * There is no created_at. Prod has six columns; adding a seventh here would diverge
--     again, for a column nothing reads.
--
-- If you ever intend to normalise owner_id to uuid, that is a separate, deliberate
-- migration with a backfill -- not a silent difference between environments.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS voice_vocabulary (
  owner_id   text        NOT NULL,
  -- The spelling as the user wants it written. Display form, case preserved.
  term       text        NOT NULL,
  -- lower(term). The dedupe key, so "Ajay" reinforces "ajay" rather than making a
  -- second row that competes with it for prompt space.
  term_key   text        NOT NULL,
  -- The contact this spelling belongs to, when known. Ties a pronunciation to a
  -- PERSON rather than leaving a flat word list, and lets the row be cleaned up if
  -- that contact is ever deleted.
  contact_id bigint,
  -- How many times the user has reinforced it. Higher = more confident.
  hits       integer     NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, term_key)
);

-- The read path is "most-recently-reinforced first, for one owner" -- getVoiceVocab
-- orders by updated_at DESC and takes ~20. Without an index that is a seq scan on every
-- transcription, which is the one place latency is most visible.
--
-- CREATED BY DEFINITION, NOT BY NAME. Production already had an index on exactly these
-- columns under a different name (voice_vocabulary_recent, created outside this repo), and
-- `CREATE INDEX IF NOT EXISTS <my_name>` does not notice that -- IF NOT EXISTS only checks
-- the NAME. So this migration duly built a second, byte-identical index:
--
--   voice_vocabulary_recent            btree (owner_id, updated_at DESC)
--   voice_vocabulary_owner_recent_idx  btree (owner_id, updated_at DESC)
--
-- Two indexes on the same columns cost an extra write on every INSERT and buy nothing on
-- reads. Checking for an equivalent DEFINITION instead makes this correct in both
-- directions: a fresh database gets exactly one index, and a database that already has an
-- equivalent one under any name is left alone.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'voice_vocabulary'
       AND indexdef LIKE '%(owner_id, updated_at DESC)%'
  ) THEN
    CREATE INDEX voice_vocabulary_owner_recent_idx
      ON voice_vocabulary (owner_id, updated_at DESC);
  END IF;
END $$;
