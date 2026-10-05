// @ts-nocheck
// people schema: the DDL for every table and the seed rows for dimensions,
// scoring params and the quick-fact template. Data only.

"use strict";

// ---------------------------------------------------------------- schema
//
// SUBJECT IS ONE OF THREE THINGS, enforced by CHECK: a person, a circle, or
// you. Amber uses composite foreign keys to make a row whose owner disagrees
// with its parent's owner unwritable. Single-user, there is no owner to
// disagree, so that machinery is dropped rather than carried as decoration.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS people (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  handle        TEXT UNIQUE,
  phone         TEXT,
  email         TEXT,
  company       TEXT,
  role          TEXT,
  location      TEXT,
  how_we_met    TEXT,
  birthday      TEXT,
  avatar        TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at    TEXT
);
CREATE INDEX IF NOT EXISTS people_name_idx ON people (name) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS circles (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  description      TEXT,
  color            TEXT,
  classified_kind  TEXT CHECK (classified_kind IN ('interest','experience','affiliation','other')),
  classified_fact  TEXT,
  classified_at    TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at       TEXT
);

-- MEMBERS ARE PEOPLE, NOT ACCOUNTS. Amber's rule and it matters more here: a
-- circle is a way of organising your own address book, so membership never
-- requires the other person to have heard of this tool.
CREATE TABLE IF NOT EXISTS circle_members (
  circle_id TEXT NOT NULL REFERENCES circles (id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people  (id) ON DELETE CASCADE,
  added_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (circle_id, person_id)
);
CREATE INDEX IF NOT EXISTS cm_person_idx ON circle_members (person_id);

-- OBSERVATIONS: everything you know, in one table.
--
-- Facts, notes, experiences, memories and transcript chunks have identical
-- shapes, identical indexes and identical lifecycles, which makes them one
-- entity with a label. Seven tables would mean seven search indexes each too
-- small to be good and seven places to forget valid_until.
CREATE TABLE IF NOT EXISTS observations (
  id           TEXT PRIMARY KEY,
  person_id    TEXT REFERENCES people  (id) ON DELETE CASCADE,
  circle_id    TEXT REFERENCES circles (id) ON DELETE CASCADE,

  kind         TEXT NOT NULL DEFAULT 'fact'
               CHECK (kind IN ('fact','note','experience','memory','transcript')),

  -- MODALITY IS A COLUMN, NOT A TAG, because getting it wrong produces a wrong
  -- answer rather than a vague one. "Thinking about moving to SF" must never
  -- surface as "moved to SF". Anything whose error is merely imprecision is a
  -- tag instead.
  modality     TEXT NOT NULL DEFAULT 'actual'
               CHECK (modality IN ('actual','planned','hypothetical','desired','available','declined')),

  -- HOW YOU CAME TO KNOW IT. Weighs the observation; see scoring_params.
  source       TEXT NOT NULL DEFAULT 'told_directly'
               CHECK (source IN ('told_directly','observed','inferred','third_party','imported')),

  body         TEXT NOT NULL,
  observed_at  TEXT NOT NULL DEFAULT (datetime('now')),

  -- A FACT HAS A SHAPE OVER TIME, NOT JUST AN EXPIRY.
  --   permanent  "grew up in Manila"     full weight forever
  --   window     "in SF for 3 months"    full weight inside, residual outside
  --   decaying   "training for a race"   half-life of its dimension
  temporal     TEXT NOT NULL DEFAULT 'decaying'
               CHECK (temporal IN ('permanent','window','decaying')),
  valid_from   TEXT,
  valid_until  TEXT,

  -- Provenance for circle-derived facts. Deleting the circle takes them with
  -- it; changing its membership reconciles them.
  source_circle_id TEXT REFERENCES circles (id) ON DELETE CASCADE,

  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at   TEXT,

  -- A fact is about a person or about a circle, never both.
  CHECK (person_id IS NULL OR circle_id IS NULL)
);
CREATE INDEX IF NOT EXISTS obs_person_idx  ON observations (person_id, observed_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS obs_circle_idx  ON observations (circle_id, observed_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS obs_self_idx    ON observations (observed_at DESC)
  WHERE deleted_at IS NULL AND person_id IS NULL AND circle_id IS NULL;
CREATE INDEX IF NOT EXISTS obs_src_circle_idx ON observations (source_circle_id)
  WHERE source_circle_id IS NOT NULL AND deleted_at IS NULL;

CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
  body, content='observations', content_rowid='rowid'
);

-- THE SIX DIMENSIONS, AND EVERY KNOB THAT TUNES THEM.
--
-- Every tunable is a row, not a constant in code. Changing how this weighs
-- financial stress is an UPDATE, not an edit and a reinstall.
CREATE TABLE IF NOT EXISTS dimensions (
  id             INTEGER PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE,
  label          TEXT NOT NULL,
  sort_order     INTEGER NOT NULL,
  -- How fast a signal in this dimension goes stale. Someone's physical
  -- situation changes far faster than their spiritual one. Opening guesses,
  -- meant to be argued with.
  half_life_days INTEGER NOT NULL,
  base_weight    REAL NOT NULL DEFAULT 1.0
);

CREATE TABLE IF NOT EXISTS scoring_params (
  key        TEXT PRIMARY KEY,
  value      REAL NOT NULL,
  note       TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS observation_dimensions (
  observation_id TEXT NOT NULL REFERENCES observations (id) ON DELETE CASCADE,
  dimension_id   INTEGER NOT NULL REFERENCES dimensions (id) ON DELETE CASCADE,
  weight         REAL NOT NULL DEFAULT 1.0,
  PRIMARY KEY (observation_id, dimension_id)
);
CREATE INDEX IF NOT EXISTS od_dim_idx ON observation_dimensions (dimension_id);

CREATE TABLE IF NOT EXISTS interactions (
  id         TEXT PRIMARY KEY,
  person_id  TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  channel    TEXT,
  note       TEXT,
  happened_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS int_person_idx ON interactions (person_id, happened_at DESC);

-- DERIVED. Truncating these must always be safe: they hold no truth of their
-- own, a job rebuilds them. They exist so a read is an index scan instead of a
-- computation. Refreshed by "people score", not by a trigger, because a trigger
-- fires invisibly whether you meant it to or not.
CREATE TABLE IF NOT EXISTS person_scores (
  person_id           TEXT PRIMARY KEY REFERENCES people (id) ON DELETE CASCADE,
  base_score          REAL NOT NULL DEFAULT 0,
  warmth              REAL NOT NULL DEFAULT 0,
  last_interaction_at TEXT,
  observation_count   INTEGER NOT NULL DEFAULT 0,
  completeness        REAL NOT NULL DEFAULT 0,
  computed_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ps_shortlist_idx ON person_scores (base_score DESC);

CREATE TABLE IF NOT EXISTS person_dimension_state (
  person_id    TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  dimension_id INTEGER NOT NULL REFERENCES dimensions (id) ON DELETE CASCADE,
  score        REAL NOT NULL DEFAULT 0,
  evidence     INTEGER NOT NULL DEFAULT 0,
  computed_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (person_id, dimension_id)
);

CREATE TABLE IF NOT EXISTS dimension_weights (
  dimension_id INTEGER PRIMARY KEY REFERENCES dimensions (id) ON DELETE CASCADE,
  weight       REAL NOT NULL DEFAULT 1.0
);

-- VISIBILITY. Single-user there is nobody to hide from, so this does not gate
-- reads. It survives because it is what "people export --scope" reads: one row
-- means this item may leave the machine for this audience. Absence of a row
-- means no. That default is the whole point and is the one most systems get
-- backwards.
CREATE TABLE IF NOT EXISTS visibility (
  id         TEXT PRIMARY KEY,
  item_type  TEXT NOT NULL CHECK (item_type IN ('observation','person','circle')),
  item_id    TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('everyone','circle','person')),
  scope_ref  TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  CHECK ((scope_type = 'everyone' AND scope_ref IS NULL)
      OR (scope_type <> 'everyone' AND scope_ref IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS vis_unique_live ON visibility
  (item_type, item_id, scope_type, COALESCE(scope_ref, ''))
  WHERE deleted_at IS NULL;
`;

const SEED_DIMENSIONS = [
  [1, "spiritual", "Spiritual", 1, 730, 1.0],
  [2, "emotional", "Emotional", 2, 90, 1.0],
  [3, "physical", "Physical", 3, 120, 1.0],
  [4, "intellectual", "Intellectual", 4, 365, 1.0],
  [5, "social", "Social", 5, 150, 1.0],
  [6, "financial", "Financial", 6, 180, 1.0],
];

const SEED_PARAMS = [
  ["saturation_k", 0.35, "score = 1 - exp(-k * sum). Higher = fewer observations to saturate"],
  ["window_residual", 0.15, "a finished window still counts this much: \"she was in SF last spring\" is real knowledge"],
  ["stale_expired", 0.3, "a fact past valid_until but recently so"],
  ["stale_long_gone", 0.1, "a fact long past valid_until"],
  ["stale_long_gone_days", 365, "past valid_until by more than this is long gone"],
  ["source_told_directly", 1.0, "they said it to you"],
  ["source_observed", 0.85, "you saw it yourself"],
  ["source_inferred", 0.5, "you worked it out"],
  ["source_third_party", 0.4, "someone else told you"],
  ["source_imported", 0.6, "came from a sync, nobody vouched for it"],
  ["modality_actual", 1.0, "it happened"],
  ["modality_planned", 0.6, "it is going to"],
  ["modality_hypothetical", 0.25, "it might"],
  ["modality_desired", 0.5, "they want it to"],
  ["modality_available", 0.7, "they are open to it"],
  ["modality_declined", 0.4, "they said no, which is knowledge too"],
  ["warmth_half_life_days", 60, "how fast warmth fades with no contact"],
  ["completeness_target", 12, "observations at which a person counts as fully known"],
];

// Messages. Added because the honest answer to "when did I last talk to her"
// was living in an app this tool could not see, so warmth and reconnect were
// scored off whatever the user remembered to type in by hand.
//
// NOTHING HERE LEAVES THE MACHINE. This is a local copy of a local database,
// and no command in this file sends a message body anywhere.
const SCHEMA_V3 = `
CREATE TABLE IF NOT EXISTS messages (
  -- chat.db's own ROWID. Stable, monotonic, and therefore the sync watermark:
  -- re-running an ingest is a no-op rather than a duplicate.
  msg_id     INTEGER PRIMARY KEY,
  person_id  TEXT REFERENCES people (id) ON DELETE SET NULL,
  who        TEXT NOT NULL,
  handle     TEXT,
  from_me    INTEGER NOT NULL,
  body       TEXT NOT NULL,
  sent_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS msg_time_idx   ON messages (sent_at DESC);
CREATE INDEX IF NOT EXISTS msg_person_idx ON messages (person_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS msg_who_idx    ON messages (who, sent_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  body, content='messages', content_rowid='msg_id'
);

CREATE TABLE IF NOT EXISTS sync_state (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

// Added after v1 shipped. Kept in its own block so the original schema stays
// readable as the thing it was, rather than growing a second archaeology layer.
const SCHEMA_V2 = `
-- A BIRTHDAY IS ONE CASE OF A RECURRING DATE, not a special field. Anniversaries,
-- the day someone died, a sobriety date, the day you met. Year is optional
-- because "her mother died in March" is worth keeping without the year.
CREATE TABLE IF NOT EXISTS important_dates (
  id         TEXT PRIMARY KEY,
  person_id  TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  month      INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  day        INTEGER NOT NULL CHECK (day BETWEEN 1 AND 31),
  year       INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS dates_person_idx ON important_dates (person_id);

-- WHAT YOU PROMISED. Observations hold what is true and interactions hold what
-- happened; neither has anywhere for "I said I would send him the book". That
-- is the category that actually costs friendships.
CREATE TABLE IF NOT EXISTS tasks (
  id         TEXT PRIMARY KEY,
  person_id  TEXT REFERENCES people (id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  due_at     TEXT,
  done_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS tasks_open_idx ON tasks (due_at) WHERE done_at IS NULL;

-- Small, unglamorous, and the most commonly forgotten fact about a friendship.
CREATE TABLE IF NOT EXISTS loans (
  id         TEXT PRIMARY KEY,
  person_id  TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  direction  TEXT NOT NULL CHECK (direction IN ('lent','borrowed')),
  what       TEXT NOT NULL,
  amount     REAL,
  lent_at    TEXT NOT NULL DEFAULT (datetime('now')),
  settled_at TEXT
);
CREATE INDEX IF NOT EXISTS loans_open_idx ON loans (person_id) WHERE settled_at IS NULL;

-- WHO IS WHAT TO WHOM. Circles give set membership; this gives direction, which
-- is what turns "who do I know at Acme" into "her brother works there".
-- Both directions are stored, so a lookup is never a UNION.
CREATE TABLE IF NOT EXISTS relationships (
  from_id    TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  to_id      TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (from_id, to_id, kind)
);
CREATE INDEX IF NOT EXISTS rel_to_idx ON relationships (to_id);

-- The questions you decided once are worth knowing about everybody. This is
-- what turns the completeness score from a number into a worklist: the template
-- names what you have not asked yet.
CREATE TABLE IF NOT EXISTS quick_fact_template (
  key        TEXT PRIMARY KEY,
  prompt     TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 100
);
-- One person, many handles. Contacts gives you a mobile and an iCloud address;
-- a group chat can carry either. Storing a single phone and a single email meant
-- ~4,000 messages sat unattributed because someone texted from their other address.
CREATE TABLE IF NOT EXISTS identities (
  person_id TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  kind      TEXT NOT NULL CHECK (kind IN ('phone', 'email')),
  value     TEXT NOT NULL,
  PRIMARY KEY (kind, value)
);
CREATE INDEX IF NOT EXISTS identities_person_idx ON identities (person_id);

CREATE TABLE IF NOT EXISTS quick_facts (
  person_id  TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (person_id, key)
);
`;

// Relationship graphs over time. Everything above answers "where does this
// relationship stand today". None of it could answer "is this getting better
// or worse", which is the question you actually act on.
//
// Two ways to get there, and this keeps both. Scores are RECOMPUTED for a past
// date from the observations that existed by then, so a trajectory appears the
// day you install this rather than a year later. Snapshots freeze a computed
// point so the curve survives you correcting or deleting an old observation.
// Recomputation is the default because it is the honest one; snapshots exist
// because a graph that silently rewrites its own past is worse than no graph.
const SCHEMA_V4 = `
CREATE TABLE IF NOT EXISTS score_history (
  person_id    TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  as_of        TEXT NOT NULL,
  base_score   REAL NOT NULL,
  warmth       REAL NOT NULL,
  -- JSON {dimension_code: score}. One blob rather than a row per dimension
  -- because it is read whole, every time, and never joined against.
  dims         TEXT NOT NULL DEFAULT '{}',
  observation_count INTEGER NOT NULL DEFAULT 0,
  -- 'computed' was derived after the fact, 'snapshot' was frozen at the time.
  kind         TEXT NOT NULL DEFAULT 'computed'
               CHECK (kind IN ('computed','snapshot')),
  PRIMARY KEY (person_id, as_of, kind)
);
CREATE INDEX IF NOT EXISTS sh_person_idx ON score_history (person_id, as_of);
`;

// Events. A relationship is made of things that happened on days, and until
// now none of that was recorded: the store knew a message was sent on a date
// but not that the two of you got In-N-Out that night.
//
// The messages are already local, so this is an extraction problem, and the
// hard part is not finding "in n out" but telling a plan from a memory.
// "6pm in n out?" and "grabbing in n out now with Nina" are the same words
// about opposite facts. That distinction is what `observations.modality`
// already exists for, so events land there rather than in a table of their own.
//
// State is per person-day, not per event, so a rescan never re-asks a model
// about a day it has already read, and never writes the same dinner twice.
const SCHEMA_V5 = `
CREATE TABLE IF NOT EXISTS event_scan_state (
  person_id  TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
  found      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (person_id, day)
);
CREATE INDEX IF NOT EXISTS ess_day_idx ON event_scan_state (day);
`;

const SEED_TEMPLATE = [
  ["how_we_met", "How did you meet?", 10],
  ["works_on", "What are they working on?", 20],
  ["cares_about", "What do they care about most?", 30],
  ["family", "Who is at home? Partner, kids, parents?", 40],
  ["food", "Anything you should know before eating together?", 50],
  ["ask_about", "What should you always ask about?", 60],
];

module.exports = {
  SCHEMA, SEED_DIMENSIONS, SEED_PARAMS, SCHEMA_V3, SCHEMA_V2, SCHEMA_V4, SCHEMA_V5, SEED_TEMPLATE,
};
