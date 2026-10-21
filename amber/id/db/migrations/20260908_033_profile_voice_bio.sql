-- THE VOICE BIO. One clip per person, on their profile, audible to the people
-- they are connected to.
--
-- Its own table rather than a row in media_assets, and that is the whole
-- decision worth writing down. media_assets is keyed to a conversation (a
-- partial unique index on conversation_id is what makes its reserve idempotent)
-- and its authorization runs through `shares` + VIEWER_REACH_SQL -- per-note,
-- per-circle, per-contact reach for a thing that was SHARED. A voice bio is
-- none of that:
--
--   * it belongs to a PERSON, not a conversation, so it has no conversation_id
--     to be unique on, and giving it a synthetic one would be a lie that the
--     note-media reserve path would then honour;
--   * its audience is not a share, it is "am I connected to you" -- one row in
--     `connections`, no share row to create and none to forget to revoke;
--   * there is exactly ONE per owner, forever, which is a primary key rather
--     than a rule enforced in application code.
--
-- Putting it in media_assets would have meant teaching that table's reserve,
-- its unique index and canViewNote() three special cases for a row that is not
-- a note. What it DOES share -- the three-leg upload, the server-minted storage
-- key, the signed short-lived URL -- is code in lib/gcs-signing.js, and this
-- table reuses that without pretending to be a note.
--
-- status mirrors media_assets ('pending' -> 'ready') because the upload has the
-- same three legs: the server mints the key, the client PUTs to Cloud Storage,
-- the server HEADs the object and records the REAL size. A client never
-- declares its own upload complete.
--
-- peaks is the OWNER'S waveform, stored so every listener sees the same shape
-- rather than each device drawing its own from a stream it has not finished
-- downloading.

CREATE TABLE IF NOT EXISTS profile_voice_bios (
  owner_id     uuid        PRIMARY KEY REFERENCES users (amber_id) ON DELETE CASCADE,
  storage_key  text        NOT NULL,
  content_type text        NOT NULL DEFAULT 'audio/m4a',
  duration_ms  integer     NOT NULL DEFAULT 0,
  byte_size    integer     NOT NULL DEFAULT 0,
  peaks        smallint[]  NOT NULL DEFAULT '{}',
  status       text        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','ready','failed')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
