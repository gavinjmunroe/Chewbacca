-- OBSERVATIONS — everything you know, in one table.
--
-- Facts, notes, experiences, memories and transcript chunks were seven tables in
-- the first draft. They had identical shapes, identical indexes, identical
-- authorization and identical lifecycles, which makes them one entity with a
-- label. Seven tables would have meant seven text indexes, seven vector graphs
-- each too small to be good, a seven-branch UNION on every search, and seven
-- places to forget valid_until.
--
-- THREE POSSIBLE SUBJECTS, enforced by CHECK:
--   contact_id set  -> about one of your people
--   circle_id set   -> belongs to a circle
--   both null       -> about you
--
-- The composite FKs use MATCH SIMPLE (the default), which skips enforcement when
-- any column is NULL. That is exactly right here: a circle observation has a
-- null contact_id and must not be checked against contacts.

CREATE TABLE observations (
  observation_id uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       uuid        NOT NULL,
  contact_id     uuid,
  circle_id      uuid,

  kind           text        NOT NULL DEFAULT 'fact'
                             CHECK (kind IN ('fact','note','experience','memory','transcript')),

  -- MODALITY IS A FIELD, NOT A TAG, because getting it wrong produces a WRONG
  -- ANSWER rather than a vague one. A hypothetical must never surface as a
  -- fact. Anything whose error is merely imprecision is a tag instead.
  modality       text        NOT NULL DEFAULT 'actual'
                             CHECK (modality IN ('actual','planned','hypothetical',
                                                 'desired','available','declined')),

  body           text        NOT NULL,
  observed_at    timestamptz NOT NULL DEFAULT now(),

  -- A FACT HAS A SHAPE OVER TIME, NOT JUST AN EXPIRY DATE.
  --   permanent          "moved to SF"            1.0 forever
  --   window             "in SF for 3 months"     1.0 inside, residual outside
  --   decay              "just bought a car"      fades on a half-life
  --   window_then_decay  "loan for 3 months"      1.0 inside, then fades
  -- The classifier extracts the shape and the dates from the language at
  -- ingest: "for the next three months" becomes a window ending in 90 days.
  temporal_shape text        NOT NULL DEFAULT 'permanent'
                             CHECK (temporal_shape IN ('permanent','window','decay','window_then_decay')),
  valid_from     timestamptz,
  valid_until    timestamptz,
  decay_half_life_days integer CHECK (decay_half_life_days IS NULL OR decay_half_life_days > 0),

  source         text        NOT NULL DEFAULT 'manual',
  confidence     real        NOT NULL DEFAULT 1.0 CHECK (confidence BETWEEN 0 AND 1),

  embedding      vector(1536),
  tsv            tsvector    GENERATED ALWAYS AS (to_tsvector('english', coalesce(body, ''))) STORED,

  created_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,

  CONSTRAINT obs_subject_chk CHECK (contact_id IS NULL OR circle_id IS NULL),
  CONSTRAINT obs_window_chk  CHECK (
    temporal_shape NOT IN ('window','window_then_decay') OR valid_until IS NOT NULL),
  CONSTRAINT obs_decay_chk   CHECK (
    temporal_shape NOT IN ('decay','window_then_decay') OR decay_half_life_days IS NOT NULL),
  CONSTRAINT obs_range_chk   CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from <= valid_until),

  CONSTRAINT obs_owner_contact_fk FOREIGN KEY (owner_id, contact_id)
    REFERENCES contacts (owner_id, id) ON DELETE CASCADE,
  CONSTRAINT obs_owner_circle_fk  FOREIGN KEY (owner_id, circle_id)
    REFERENCES circles  (owner_id, id)  ON DELETE CASCADE
);

CREATE INDEX obs_contact_time_idx ON observations (owner_id, contact_id, observed_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX obs_circle_time_idx  ON observations (owner_id, circle_id, observed_at DESC)
  WHERE circle_id IS NOT NULL AND deleted_at IS NULL;

-- Shelf life rides the composite index and the comparison happens at query time.
-- A partial index on "valid_until > now()" is ILLEGAL: partial predicates must be
-- IMMUTABLE, and an index built with one afternoon's idea of "now" would quietly
-- disagree with the table forever, returning wrong answers with no error.
CREATE INDEX obs_validity_idx ON observations (owner_id, contact_id, valid_until)
  WHERE deleted_at IS NULL;

CREATE INDEX obs_tsv_idx ON observations USING GIN (tsv);
CREATE INDEX obs_embedding_idx ON observations
  USING hnsw (embedding vector_cosine_ops);

-- WHICH DIMENSIONS THIS OBSERVATION IS EVIDENCE FOR. Many-to-many on purpose:
-- "training for a marathon since the divorce" is physical AND emotional, and a
-- single column would force a lossy choice at ingest that can never be recovered.
--
-- confidence — how sure the classifier is it is that dimension at all
-- weight     — how strongly it bears on it, given that it is one
--   "his rent went up"        high confidence, low weight
--   "he's declaring bankruptcy" high both
--
-- assigned_by='human' pins confidence to 1.0 and locks the row. A human REMOVAL
-- is a suppressed row, never a delete -- delete it and the next reprocess adds
-- it straight back.
CREATE TABLE observation_dimensions (
  observation_id uuid        NOT NULL REFERENCES observations (observation_id) ON DELETE CASCADE,
  dimension_id   smallint    NOT NULL REFERENCES dimensions (dimension_id),
  confidence     real        NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  weight         real        NOT NULL DEFAULT 0.5 CHECK (weight BETWEEN 0 AND 1),
  assigned_by    text        NOT NULL DEFAULT 'model' CHECK (assigned_by IN ('model','human')),
  suppressed     boolean     NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (observation_id, dimension_id)
);
CREATE INDEX obsdim_dimension_idx ON observation_dimensions (dimension_id, observation_id)
  WHERE suppressed = false;

-- THE OPEN-ENDED SEMANTIC LAYER. Stressor, aspiration, milestone, grievance,
-- preference — this vocabulary grows forever and must never need a migration.
-- Owner-scoped so one person's taxonomy is not imposed on anyone else.
CREATE TABLE tags (
  tag_id     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  label      text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, label)
);

CREATE TABLE observation_tags (
  observation_id uuid NOT NULL REFERENCES observations (observation_id) ON DELETE CASCADE,
  tag_id         uuid NOT NULL REFERENCES tags (tag_id) ON DELETE CASCADE,
  PRIMARY KEY (observation_id, tag_id)
);
CREATE INDEX obstag_tag_idx ON observation_tags (tag_id, observation_id);
