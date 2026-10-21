-- CONVERSATIONS — the gap the store rewiring exposed.
--
-- I had collapsed app_conversation_messages into `observations`. That was wrong,
-- and writing the store code is what made it obvious.
--
-- A CONVERSATION AND AN OBSERVATION ARE DIFFERENT THINGS:
--   a conversation is a CONTAINER with ordered turns, replayed verbatim in the
--     chat UI, and shared as a unit ("send this voice note to my circle")
--   an observation is a FACT EXTRACTED from one, scored, dimension-tagged, and
--     retrieved independently of where it came from
-- One conversation yields many observations. Flattening them loses the ordering,
-- the roles, and the ability to share a note as one object.
--
-- So conversations get their own tables, and observations gain provenance:
-- source_conversation_id points back at the thread a fact was learned in, which
-- is what lets an answer cite "you said this in Tuesday's voice note."
--
-- Replaces, from the old schema:
--   app_conversation_messages -> conversations + conversation_messages
--   note_audio                -> media_assets (via conversation_id)
--   note_comments             -> conversation_comments
--   note_reactions            -> conversation_reactions
--   note_shares               -> shares, with item_type 'conversation'
--   conversation_messages     -> folded in (it was a near-duplicate keyed on
--                                space_id instead of conversation_id)

CREATE TABLE conversations (
  conversation_id uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  -- 'chat'  an Ask thread
  -- 'note'  a voice note: one recording, a transcript, shareable as a unit
  -- 'space' a group thread
  kind            text        NOT NULL DEFAULT 'chat' CHECK (kind IN ('chat','note','space')),
  title           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CONSTRAINT conversations_owner_conv_uq UNIQUE (owner_id, conversation_id)
);
CREATE INDEX conversations_owner_recent_idx ON conversations (owner_id, updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE conversation_messages (
  id              bigserial   PRIMARY KEY,
  conversation_id uuid        NOT NULL,
  owner_id        uuid        NOT NULL,
  role            text        NOT NULL CHECK (role IN ('user','amber','system')),
  content         text        NOT NULL,
  intent          text,
  metadata        jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CONSTRAINT cm_owner_conv_fk FOREIGN KEY (owner_id, conversation_id)
    REFERENCES conversations (owner_id, conversation_id) ON DELETE CASCADE
);
-- The only read that matters: one thread, in order.
CREATE INDEX conv_msg_thread_idx ON conversation_messages (conversation_id, created_at)
  WHERE deleted_at IS NULL;

-- Comments come from OTHER people, which is why they are not just messages with a
-- different role -- the author is an account, not the owner, and the row must
-- survive the owner editing their own thread.
CREATE TABLE conversation_comments (
  id              bigserial   PRIMARY KEY,
  conversation_id uuid        NOT NULL REFERENCES conversations (conversation_id) ON DELETE CASCADE,
  author_amber_id uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  body            text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE INDEX conv_comment_idx ON conversation_comments (conversation_id, created_at)
  WHERE deleted_at IS NULL;

-- ONE reaction per person per conversation, guaranteed by the primary key rather
-- than by application logic, so a double tap cannot write two rows. Same five
-- kinds as everywhere else in the product.
CREATE TABLE conversation_reactions (
  conversation_id  uuid        NOT NULL REFERENCES conversations (conversation_id) ON DELETE CASCADE,
  reactor_amber_id uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  kind             text        NOT NULL CHECK (kind IN ('emphasis','like','dislike','laugh','question')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, reactor_amber_id)
);

-- PROVENANCE. Where a fact was learned. This is what turns "Maggie is moving to
-- SF" into "you said so in Tuesday's voice note", and it is what the sources
-- line at the bottom of an answer is built from.
ALTER TABLE observations
  ADD COLUMN source_conversation_id uuid REFERENCES conversations (conversation_id) ON DELETE SET NULL;
CREATE INDEX obs_source_conv_idx ON observations (source_conversation_id)
  WHERE source_conversation_id IS NOT NULL;

-- Audio belongs to a conversation, not to a contact: a voice note is a recording
-- of a thread, and the people it mentions are resolved afterwards.
ALTER TABLE media_assets
  ADD COLUMN conversation_id uuid REFERENCES conversations (conversation_id) ON DELETE CASCADE;
CREATE INDEX media_conversation_idx ON media_assets (conversation_id)
  WHERE conversation_id IS NOT NULL;
-- ONE LIVE RECORDING PER NOTE. reserveAudioUpload relies on ON CONFLICT to be
-- idempotent, and ON CONFLICT needs something to conflict WITH: without this a
-- retried reserve silently created a second pending row pointing at the same
-- storage key, and finalize would then update whichever one it found first.
CREATE UNIQUE INDEX media_conv_live_uidx ON media_assets (conversation_id)
  WHERE conversation_id IS NOT NULL AND deleted_at IS NULL;

-- (shares.item_type already accepts 'conversation' -- see 004. Sharing a note is
-- sharing its conversation, as one object.)

-- THE AMBIGUITY WORKFLOW. "You said Maggie -- which Maggie?" These are in-flight
-- questions, not knowledge, so they stay their own table rather than becoming
-- observations. fact_id points at the observation waiting on an answer.
CREATE TABLE pending_fact_context (
  id             bigserial   PRIMARY KEY,
  owner_id       uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  awaiting       text        NOT NULL,
  observation_id uuid        REFERENCES observations (observation_id) ON DELETE CASCADE,
  raw_name       text,
  question_asked text,
  candidates     jsonb,
  reask_count    integer     NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
-- Bounded on purpose: this table grew unbounded in prod because nothing ever
-- swept it. The index supports the sweep.
CREATE INDEX pfc_owner_recent_idx ON pending_fact_context (owner_id, updated_at DESC);

-- NAME MEMORY. "When this owner says 'Maggie', they mean this card." Earns trust
-- over a streak of confirmations; an explicit confirmation jumps straight to the
-- threshold so the same question is never asked twice.
CREATE TABLE contact_name_memory (
  owner_id          uuid        NOT NULL,
  name_key          text        NOT NULL,
  contact_id        uuid        NOT NULL,
  stable_streak     integer     NOT NULL DEFAULT 0,
  last_confirmed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, name_key),
  CONSTRAINT cnm_owner_contact_fk FOREIGN KEY (owner_id, contact_id)
    REFERENCES contacts (owner_id, id) ON DELETE CASCADE
);
