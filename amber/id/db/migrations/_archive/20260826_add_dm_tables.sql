-- Direct messages: six tables. Previously created only by the lazy
-- ensureDmTables() in dm-store.js, which every one of that module's public
-- functions awaited on every call.
--
-- THE PAIR ORDERING IS THE LOAD-BEARING INVARIANT. A DM thread between two
-- people must be ONE row, not two half-conversations, whichever side opens it
-- first. That is enforced here, by the database, not by application logic:
--
--   dm_threads_order_chk  CHECK (a_amber_id < b_amber_id)
--   dm_threads_pair_uq    UNIQUE (a_amber_id, b_amber_id)
--
-- The store sorts the two uuids before every insert, so the CHECK can only fail
-- if a future caller forgets. The UNIQUE then makes a simultaneous
-- both-sides-tap-at-once race resolve to one winner and one ON CONFLICT, rather
-- than to two threads that each hold half the messages.

CREATE TABLE IF NOT EXISTS dm_threads (
  id              bigserial   PRIMARY KEY,
  a_amber_id      uuid        NOT NULL,
  b_amber_id      uuid        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz,
  CONSTRAINT dm_threads_pair_uq  UNIQUE (a_amber_id, b_amber_id),
  CONSTRAINT dm_threads_order_chk CHECK (a_amber_id < b_amber_id)
);

-- One row per message, text or voice. Voice rows are written in two steps: the
-- row appears with audio_status='pending' when a storage key is minted, and flips
-- to 'ready' only after the server has HEADed the object in the bucket and
-- confirmed its real size. A client cannot declare its own upload complete.
CREATE TABLE IF NOT EXISTS dm_messages (
  id              bigserial   PRIMARY KEY,
  thread_id       bigint      NOT NULL,
  sender_amber_id uuid        NOT NULL,
  kind            text        NOT NULL DEFAULT 'text',
  body            text,
  storage_key     text,
  content_type    text,
  duration_ms     integer     NOT NULL DEFAULT 0,
  byte_size       integer     NOT NULL DEFAULT 0,
  -- The SENDER's waveform, 0..100 per sample, captured on device while recording
  -- so every listener sees identical peaks. Matches note_audio.peaks.
  peaks           smallint[]  NOT NULL DEFAULT '{}',
  audio_status    text        NOT NULL DEFAULT 'none',
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CONSTRAINT dm_messages_kind_chk  CHECK (kind IN ('text','voice')),
  CONSTRAINT dm_messages_audio_chk CHECK (audio_status IN ('none','pending','ready'))
);

-- The only read pattern that matters: one thread, newest first, paged.
CREATE INDEX IF NOT EXISTS dm_messages_thread_idx ON dm_messages (thread_id, id DESC);

-- ONE reaction per person per message, guaranteed by the PRIMARY KEY rather than
-- by application logic, so a double tap cannot write two rows. Kind vocabulary is
-- kept identical to note_reactions on purpose.
CREATE TABLE IF NOT EXISTS dm_reactions (
  message_id       bigint      NOT NULL,
  reactor_amber_id uuid        NOT NULL,
  kind             text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, reactor_amber_id),
  CONSTRAINT dm_reactions_kind_chk
    CHECK (kind IN ('emphasis','like','dislike','laugh','question'))
);

-- Read receipts as a high-water mark, not a row per message.
CREATE TABLE IF NOT EXISTS dm_reads (
  thread_id            bigint      NOT NULL,
  amber_id             uuid        NOT NULL,
  last_read_message_id bigint      NOT NULL DEFAULT 0,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, amber_id)
);

-- PER-PERSON DELETE, also a high-water mark. "Delete this conversation" must
-- clear the thread for the person who asked WITHOUT destroying the other side's
-- copy, so no row is ever removed: this records the id below which this viewer
-- no longer sees anything.
CREATE TABLE IF NOT EXISTS dm_clears (
  thread_id         bigint      NOT NULL,
  amber_id          uuid        NOT NULL,
  cleared_before_id bigint      NOT NULL DEFAULT 0,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, amber_id)
);

-- Directional. A block is checked in BOTH directions before any send, so either
-- party blocking is sufficient to stop the thread.
CREATE TABLE IF NOT EXISTS dm_blocks (
  blocker_amber_id uuid        NOT NULL,
  blocked_amber_id uuid        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_amber_id, blocked_amber_id)
);
