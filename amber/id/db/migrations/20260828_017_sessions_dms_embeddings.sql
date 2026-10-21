-- THREE THINGS THE REBUILD WOULD HAVE DROPPED ON THE FLOOR.
--
-- Found by scripts/schema-drift-audit.mjs, which diffs the tables the migrations
-- build against the tables src/ actually queries. Reading the code was not enough
-- -- I had ported the stores I knew about and would have run teardown believing
-- the set was complete.
--
--   device_sessions    EXISTS IN PRODUCTION AND IS AUTHENTICATION. Refresh-token
--                      rotation and session revocation. Dropping it and not
--                      rebuilding it logs everyone out permanently and makes
--                      logging back in impossible.
--   contact_embedding  EXISTS IN PRODUCTION. Vector search over contacts.
--   dm_*               DOES NOT EXIST IN PRODUCTION, and that is the finding.
--                      The DM feature was built on CREATE TABLE IF NOT EXISTS at
--                      request time; removing the 19 lazy creates in 31d258e took
--                      its schema with it. The routes are still registered in
--                      index.js, so direct messages are broken right now, on the
--                      live app, and have been since that commit. This is the
--                      table set they need, declared properly.

-- ── AUTHENTICATION ───────────────────────────────────────────────────────────
--
-- subject_id is TEXT and stays text: it holds whatever the token's `sub` is --
-- a person_id, a DID, an amber_id -- and is deliberately not an FK to users.
-- A session must be revocable for a subject that no longer resolves to a row,
-- which is exactly the case a foreign key would forbid.
CREATE TABLE device_sessions (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id        text        NOT NULL,
  phone             text,
  -- One family per login. Rotating a refresh token issues a new row in the same
  -- family; presenting a rotated-away token revokes the WHOLE family, which is
  -- how a stolen token is detected rather than merely expired.
  family_id         uuid        NOT NULL,
  refresh_hash      text        NOT NULL,
  prev_refresh_hash text,
  rotated_at        timestamptz,
  device_id         text,
  device_name       text,
  device_os         text,
  app_version       text,
  last_ip           text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_used_at      timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  revoked_at        timestamptz,
  revoked_reason    text
);
-- A live refresh token is unique; a revoked one may repeat. Partial, so rotation
-- history does not collide with the constraint that matters.
CREATE UNIQUE INDEX device_sessions_refresh_live_uidx ON device_sessions (refresh_hash)
  WHERE revoked_at IS NULL;
CREATE INDEX device_sessions_family_idx       ON device_sessions (family_id);
CREATE INDEX device_sessions_prev_refresh_idx ON device_sessions (prev_refresh_hash)
  WHERE prev_refresh_hash IS NOT NULL;
CREATE INDEX device_sessions_subject_live_idx ON device_sessions (subject_id, revoked_at, last_used_at DESC);

-- ── CONTACT VECTORS ──────────────────────────────────────────────────────────
--
-- owner_id was text and contact_id bigint; both become uuid like everything else,
-- and the composite FK means an embedding for a contact of a different owner is
-- not merely wrong but unwritable.
--
-- halfvec, not vector: half precision costs nothing in recall at this dimension
-- and halves both the table and the index. content_hash is what stops the
-- embedder paying to re-embed a contact whose text did not change.
CREATE TABLE contact_embedding (
  owner_id     uuid        NOT NULL,
  contact_id   uuid        NOT NULL,
  -- 1536, because that is text-embedding-3-small and the column has to say so:
  -- an unconstrained halfvec cannot carry an HNSW index at all ("column does not
  -- have dimensions"), and the schema dump I read this shape out of had silently
  -- dropped the typmod. Changing embedding model means a migration, which is
  -- correct -- vectors from two models are not comparable and must not be mixed
  -- in one index.
  embedding    halfvec(1536) NOT NULL,
  content_hash text        NOT NULL,
  model        text        NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, contact_id),
  CONSTRAINT contact_embedding_owner_contact_fk FOREIGN KEY (owner_id, contact_id)
    REFERENCES contacts (owner_id, id) ON DELETE CASCADE
);
CREATE INDEX contact_embedding_hnsw ON contact_embedding
  USING hnsw (embedding halfvec_cosine_ops);

-- ── DIRECT MESSAGES ──────────────────────────────────────────────────────────
--
-- Ported from the lazy DDL rather than redesigned: the store's queries are
-- written against these shapes and this migration is about making the feature
-- exist again, not about rethinking it. Two things do change, both because a
-- real migration can express what a CREATE TABLE IF NOT EXISTS at request time
-- could not:
--   every amber_id gets a foreign key, so a thread with a deleted account in it
--   cannot survive as a dangling row
--   thread_id and message_id get foreign keys, so a message cannot outlive its
--   thread and a reaction cannot outlive its message

CREATE TABLE dm_threads (
  id              bigserial   PRIMARY KEY,
  a_amber_id      uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  b_amber_id      uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz,
  CONSTRAINT dm_threads_pair_uq UNIQUE (a_amber_id, b_amber_id),
  -- CANONICAL ORDERING, the same trick connections uses: the smaller uuid is
  -- always 'a', so two people opening a thread at the same instant lose to the
  -- unique constraint rather than to a race in application code.
  CONSTRAINT dm_threads_order_chk CHECK (a_amber_id < b_amber_id)
);

CREATE TABLE dm_messages (
  id              bigserial   PRIMARY KEY,
  thread_id       bigint      NOT NULL REFERENCES dm_threads (id) ON DELETE CASCADE,
  sender_amber_id uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  kind            text        NOT NULL DEFAULT 'text' CHECK (kind IN ('text','voice')),
  body            text,
  storage_key     text,
  content_type    text,
  duration_ms     integer     NOT NULL DEFAULT 0,
  byte_size       integer     NOT NULL DEFAULT 0,
  peaks           smallint[]  NOT NULL DEFAULT '{}',
  audio_status    text        NOT NULL DEFAULT 'none'
                              CHECK (audio_status IN ('none','pending','ready')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
-- The only read pattern that matters: one thread, newest first, paged.
CREATE INDEX dm_messages_thread_idx ON dm_messages (thread_id, id DESC);

CREATE TABLE dm_reactions (
  message_id       bigint      NOT NULL REFERENCES dm_messages (id) ON DELETE CASCADE,
  reactor_amber_id uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  kind             text        NOT NULL
                               CHECK (kind IN ('emphasis','like','dislike','laugh','question')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- One reaction per person per message, by primary key rather than by
  -- application logic: a double tap cannot produce two rows.
  PRIMARY KEY (message_id, reactor_amber_id)
);

CREATE TABLE dm_reads (
  thread_id            bigint      NOT NULL REFERENCES dm_threads (id) ON DELETE CASCADE,
  amber_id             uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  last_read_message_id bigint      NOT NULL DEFAULT 0,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, amber_id)
);

-- "Clear this conversation" hides history for ONE side. It is a per-viewer
-- watermark rather than a delete, because the other person's copy is theirs.
CREATE TABLE dm_clears (
  thread_id         bigint      NOT NULL REFERENCES dm_threads (id) ON DELETE CASCADE,
  amber_id          uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  cleared_before_id bigint      NOT NULL DEFAULT 0,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, amber_id)
);

CREATE TABLE dm_blocks (
  blocker_amber_id uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  blocked_amber_id uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_amber_id, blocked_amber_id)
);
