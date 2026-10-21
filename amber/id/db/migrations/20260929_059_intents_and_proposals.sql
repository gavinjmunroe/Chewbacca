-- ============================================================================
-- INTENTS AND PROPOSALS: the two objects the whole product is for.
--
-- "Sarah told her Amber she's thinking of starting a run club. Alex says she
--  needs to exercise more. Alex's agent identifies that opportunity."
--
-- Everything Amber had before this was single-player. A person's notes, facts,
-- scores and cadence all live under one owner_id and nothing crosses between
-- two accounts except a message somebody deliberately sent. That is the right
-- default and it is also why no agent could ever do the one thing the product
-- exists to do.
--
-- TWO OBJECTS, AND THE SPLIT BETWEEN THEM IS THE PRIVACY MODEL.
--
--   intents    something a person has put into the world, at an audience they
--              chose. Derived from a note but NOT the note: the note is
--              private and stays private, the intent is the part they shared.
--
--   proposals  a suggestion that two specific people do a specific thing,
--              which does nothing at all until BOTH of them say yes.
--
-- NO AGENT EVER READS ANOTHER PERSON'S STORE. Alex's agent does not query
-- Sarah's observations. It queries intents, and an intent is only visible to
-- the audience its owner pointed it at. That property is the entire reason
-- this is two tables instead of a cross-account search, and every index below
-- is shaped to keep the audience check in the same query as the match rather
-- than after it.
--
-- SARAH DOES NOT HAVE TO ASK FOR ANYTHING. "If she shares it to her public
-- network and just states 'starting a run club' and Alex is in her network
-- then it should be able to find that info." So an intent is not a request. It
-- is a statement with an audience, and the matcher's job is to notice that two
-- statements fit, not to wait for somebody to phrase one as a favour.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- WHAT SOMEBODY PUT INTO THE WORLD.
--
-- THE EMBEDDING IS WHY THIS IS MATCHABLE AT ALL. "I need to exercise more" and
-- "starting a run club" share no words. Keyword matching cannot connect them
-- and never will, so the match has to be semantic -- and a semantic match that
-- calls a model at scan time costs money on every scan forever. One embedding
-- computed once, when the intent is written, turns every later scan into a
-- vector query the database answers on its own. pgvector is already installed
-- (migration 001) and observations already carry vector(1536), so this is the
-- same shape the rest of the system uses.
--
-- SCOPE IS THE SAME VOCABULARY AS `shares`, deliberately. "Intent should map to
-- wherever the user shares." A person choosing an audience for a thought should
-- not be learning a second set of words for it, and the resolver in
-- src/privacy/audience.js already answers all four.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS intents (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,

  -- The shared statement, in the owner's words. NOT the private note.
  body          text        NOT NULL,

  -- The note it came from, when it came from one. Nullable because an intent
  -- can be stated directly, and ON DELETE SET NULL because deleting the note
  -- must not silently retract something already shared -- retracting is its own
  -- act, and it is `deleted_at` below.
  observation_id uuid       NULL,

  -- Coarse shape, for cheap SQL narrowing before the vector work:
  --   offer    "I am starting a run club"     (something on offer)
  --   seeking  "I need to exercise more"      (something wanted)
  --   doing    "I am in Chicago next week"    (a fact others can act on)
  kind          text        NOT NULL DEFAULT 'doing'
                            CHECK (kind IN ('offer', 'seeking', 'doing')),

  -- One of the six dimensions, or '*'. The cheapest possible first filter.
  dimension     text        NULL,

  embedding     vector(1536) NULL,

  -- WHO MAY SEE IT. Same four scopes as `shares`.
  scope_type    text        NOT NULL
                            CHECK (scope_type IN ('network', 'circle', 'contact', 'cohort')),
  scope_ref     uuid        NULL,

  -- HOW FAR INTO THE NETWORK, for scope_type = 'network' only.
  --   1  people I am connected to
  --   2  and their connections
  --   3  and theirs
  -- Capped at 3 because that is the furthest anybody asked for and because the
  -- fan-out of a fourth hop is the whole graph.
  max_degree    smallint    NOT NULL DEFAULT 1 CHECK (max_degree BETWEEN 1 AND 3),

  -- AN INTENT IS NOT FOREVER. "Thinking of starting a run club" is true for a
  -- while and then it is either done or abandoned, and a matcher that keeps
  -- surfacing a year-old thought is how somebody learns to ignore the feed.
  expires_at    timestamptz NOT NULL DEFAULT (now() + interval '60 days'),

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz NULL,

  CONSTRAINT intents_scope_ref_chk CHECK (
    (scope_type = 'network' AND scope_ref IS NULL) OR
    (scope_type <> 'network' AND scope_ref IS NOT NULL)),

  CONSTRAINT intents_observation_fk
    FOREIGN KEY (observation_id) REFERENCES observations (observation_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS intents_owner_live_idx
  ON intents (owner_id, created_at DESC) WHERE deleted_at IS NULL;

-- The matcher's own access path: live, unexpired, by shape. Every scan starts
-- here and the vector work happens only on what survives it.
CREATE INDEX IF NOT EXISTS intents_live_idx
  ON intents (kind, dimension, expires_at) WHERE deleted_at IS NULL;

-- HNSW so similarity search stays sublinear as this grows. halfvec would be
-- cheaper but observations already use vector(1536); one shape, one index type.
CREATE INDEX IF NOT EXISTS intents_embedding_idx
  ON intents USING hnsw (embedding vector_cosine_ops);

-- ---------------------------------------------------------------------------
-- A SUGGESTION THAT TWO PEOPLE DO SOMETHING, WHICH DOES NOTHING UNTIL BOTH AGREE.
--
-- BOTH SIDES APPROVE SEPARATELY AND NEITHER CAN COMMIT THE OTHER. Alex says yes
-- to reaching out; Sarah says yes to being reached. Two timestamps rather than
-- one status field, because "who agreed, and when" is the question that gets
-- asked when something goes wrong, and a single enum cannot answer it.
--
-- THE STATUS IS DERIVED, NOT SET. A column somebody writes by hand drifts from
-- the timestamps that are the actual truth; this way "both approved" cannot be
-- true while one of the timestamps is null.
--
-- IT EXPIRES. A proposal nobody answered is not pending forever -- an invitation
-- to a run club three months ago is noise, and leaving it open means the feed
-- fills with things that have quietly stopped being real.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS proposals (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- A is the side the proposal was surfaced TO -- whose query or scan produced
  -- it. B is the counterparty. The distinction matters because A is asked
  -- first and B is only told once A has said yes; B must never learn that
  -- somebody was considered as a match for them and declined.
  a_amber_id     uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  b_amber_id     uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,

  a_intent_id    uuid        NULL REFERENCES intents (id) ON DELETE SET NULL,
  b_intent_id    uuid        NULL REFERENCES intents (id) ON DELETE SET NULL,

  -- What the matcher thought, and why. `reason` is shown to the person, so it
  -- has to be a sentence somebody would say, not a score.
  score          real        NOT NULL DEFAULT 0,
  headline       text        NULL,
  reason         text        NULL,

  -- How the two sides were within reach of each other, for auditing a proposal
  -- that should not have been made: the scope and degree that permitted it.
  via_scope_type text        NULL,
  via_degree     smallint    NULL,

  a_approved_at  timestamptz NULL,
  b_approved_at  timestamptz NULL,
  a_declined_at  timestamptz NULL,
  b_declined_at  timestamptz NULL,

  -- THE SUCCESS METRIC. "Real life meetings formed through the app." Set when
  -- something actually happened, which is the only number that matters and the
  -- one nothing in the schema could record before now.
  met_at         timestamptz NULL,

  expires_at     timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz NULL,

  -- Two people, not one person twice.
  CONSTRAINT proposals_two_people_chk CHECK (a_amber_id <> b_amber_id),
  -- A side cannot both approve and decline.
  CONSTRAINT proposals_a_once_chk CHECK (NOT (a_approved_at IS NOT NULL AND a_declined_at IS NOT NULL)),
  CONSTRAINT proposals_b_once_chk CHECK (NOT (b_approved_at IS NOT NULL AND b_declined_at IS NOT NULL)),
  -- B is never asked before A has agreed, so B cannot have answered first.
  CONSTRAINT proposals_order_chk CHECK (
    (b_approved_at IS NULL AND b_declined_at IS NULL) OR a_approved_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS proposals_a_idx
  ON proposals (a_amber_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS proposals_b_idx
  ON proposals (b_amber_id, created_at DESC) WHERE deleted_at IS NULL;

-- DO NOT PROPOSE THE SAME PAIR OF INTENTS TWICE. Without this every scan
-- re-surfaces yesterday's suggestion and the feed becomes a loop. Partial so a
-- retracted proposal can be made again if circumstances change.
CREATE UNIQUE INDEX IF NOT EXISTS proposals_unique_live
  ON proposals (a_amber_id, b_amber_id, COALESCE(a_intent_id, '00000000-0000-0000-0000-000000000000'::uuid),
                COALESCE(b_intent_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE deleted_at IS NULL;

COMMIT;
