-- ============================================================================
-- THE NOTE TABLES, BACK IN THE SET THAT BUILDS A DATABASE.
--
-- note_shares, note_audio, note_reactions and note_comments are live. They are
-- read on nearly every signed-in request: src/db/note-shares-store.js backs
-- GET /v1/me/feed and GET /v1/me/circles/:id/feed, and src/routes/circles.js
-- calls getUnseenCircleShareCounts on every circles list.
--
-- They are also not in this directory. They were created by
--   _archive/20260817_add_note_shares.sql
--   _archive/20260817_add_note_media.sql
-- and _archive is reported by the runner but never applied, because twelve
-- files in there ALTER tables no migration ever created. So production has
-- these four tables, recorded in its own ledger from before the rebuild, and a
-- database built from the 58 active migrations does not have them at all.
--
-- WHAT THAT COSTS. Every fresh database -- a staging environment, CI, a second
-- region, a new tenant -- comes up missing tables the application reads
-- immediately, and fails in a way that looks like a code bug. Nobody hits it
-- today only because nobody has built one. The enterprise org work puts its
-- feed directly on note_shares, which makes a throwaway database that matches
-- production a prerequisite rather than a nicety.
--
-- WHAT THIS FILE DOES. Nothing, on production: every statement is IF NOT
-- EXISTS and every table is already there, so this applies as a no-op and
-- leaves a ledger row saying so. On an empty database it creates the four
-- tables, which is the entire point.
--
-- THE DEFINITIONS ARE COPIED, NOT IMPROVED. Byte-equivalent in effect to the
-- two archived files plus 20260818_reactions_add_like.sql, which widened
-- note_reactions.kind to five values and had to be a separate file precisely
-- because CREATE TABLE IF NOT EXISTS skips an existing table's constraints.
-- note_shares.scope_type is left at three values to match production: 058 added
-- 'cohort' to shares.scope_type and network_visibility.scope_type and did NOT
-- add it here. Widening it is a real change with a real blast radius and
-- belongs in its own migration, not smuggled into a restore.
--
-- TYPES ARE TRANSCRIBED ON PURPOSE. owner_id / reactor / author are uuid and
-- conversation_id is text, so joins against app_conversation_messages, users
-- and note_shares line up. A text/uuid mismatch is what produced
-- "operator does not exist: uuid = text" on contact_favorites and hid a broken
-- read behind a swallowed catch.
--
-- No foreign keys, matching the originals.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS note_shares (
  owner_id        uuid        NOT NULL,
  conversation_id text        NOT NULL,
  scope_type      text        NOT NULL,
  scope_ref       bigint,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, conversation_id),
  CONSTRAINT note_shares_scope_type_chk
    CHECK (scope_type IN ('network','circle','contact'))
);

CREATE INDEX IF NOT EXISTS note_shares_scope_idx ON note_shares (scope_type, scope_ref);
CREATE INDEX IF NOT EXISTS note_shares_owner_idx ON note_shares (owner_id);

CREATE TABLE IF NOT EXISTS note_audio (
  owner_id        uuid        NOT NULL,
  conversation_id text        NOT NULL,
  storage_key     text        NOT NULL,
  content_type    text        NOT NULL DEFAULT 'audio/m4a',
  duration_ms     integer     NOT NULL DEFAULT 0,
  byte_size       integer     NOT NULL DEFAULT 0,
  -- The SENDER's waveform, 0..100 per sample, captured on device while
  -- recording so every listener sees the same peaks and valleys.
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
  -- Semantic keys, not emoji glyphs: the glyph is the client's choice and can
  -- be restyled without a migration, and a key is queryable later.
  kind             text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- ONE reaction per person per note, guaranteed by the key rather than by
  -- application logic, so a double-tap race cannot write two rows.
  PRIMARY KEY (note_owner_id, conversation_id, reactor_amber_id),
  -- Five kinds, as 20260818_reactions_add_like.sql left production.
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

COMMIT;
