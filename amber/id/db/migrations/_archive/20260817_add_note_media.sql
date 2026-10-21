-- Voice-note media: the audio clip, tapback reactions, comments.
--
-- Additive. Nothing here alters an existing table.
--
-- TYPES ARE TRANSCRIBED FROM note_shares ON PURPOSE: owner_id/reactor/author are
-- uuid and conversation_id is text, so every join with note_shares,
-- app_conversation_messages and users lines up. A text/uuid mismatch is what
-- produced "operator does not exist: uuid = text" on contact_favorites and hid a
-- broken read behind a swallowed catch.

CREATE TABLE IF NOT EXISTS note_audio (
  owner_id        uuid        NOT NULL,
  conversation_id text        NOT NULL,
  storage_key     text        NOT NULL,
  content_type    text        NOT NULL DEFAULT 'audio/m4a',
  duration_ms     integer     NOT NULL DEFAULT 0,
  byte_size       integer     NOT NULL DEFAULT 0,
  -- The SENDER's waveform, 0..100 per sample, captured on device while recording
  -- so every listener sees the same peaks and valleys.
  peaks           smallint[]  NOT NULL DEFAULT '{}',
  -- 'pending' the moment a storage key is minted; 'ready' only after the server
  -- has verified the object really exists in the bucket at an allowed size.
  status          text        NOT NULL DEFAULT 'pending',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  PRIMARY KEY (owner_id, conversation_id),
  CONSTRAINT note_audio_status_chk CHECK (status IN ('pending','ready'))
);

CREATE TABLE IF NOT EXISTS note_reactions (
  note_owner_id    uuid        NOT NULL,
  conversation_id  text        NOT NULL,
  reactor_amber_id uuid        NOT NULL,
  -- Semantic keys, not emoji glyphs: the glyph is the client's choice and can be
  -- restyled without a migration, and a key is queryable later.
  kind             text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- ONE reaction per person per note, guaranteed by the key rather than by
  -- application logic, so a double-tap race cannot write two rows.
  PRIMARY KEY (note_owner_id, conversation_id, reactor_amber_id),
  -- Widened to five kinds. An existing database keeps whatever constraint it
  -- already has, because this is CREATE TABLE IF NOT EXISTS -- which is exactly why
  -- 20260818_reactions_add_like.sql exists and has to be run separately.
  CONSTRAINT note_reactions_kind_chk
    CHECK (kind IN ('emphasis','like','dislike','laugh','question'))
);

CREATE TABLE IF NOT EXISTS note_comments (
  id               bigserial   PRIMARY KEY,
  note_owner_id    uuid        NOT NULL,
  conversation_id  text        NOT NULL,
  author_amber_id  uuid        NOT NULL,
  body             text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);

CREATE INDEX IF NOT EXISTS note_reactions_note_idx
  ON note_reactions (note_owner_id, conversation_id);
CREATE INDEX IF NOT EXISTS note_comments_note_idx
  ON note_comments (note_owner_id, conversation_id, created_at);
CREATE INDEX IF NOT EXISTS note_audio_ready_idx
  ON note_audio (owner_id, conversation_id) WHERE deleted_at IS NULL;
