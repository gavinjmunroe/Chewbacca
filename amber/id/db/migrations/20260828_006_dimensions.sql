-- THE SIX DIMENSIONS OF HEALTH, AND EVERY KNOB THAT TUNES THEM.
--
-- EVERY TUNABLE IN THIS FILE IS A ROW, NOT A CONSTANT IN CODE. Changing how the
-- system weighs financial stress is an UPDATE in Cloud SQL Studio, not a deploy.
-- That is the whole reason these are tables.

CREATE TABLE dimensions (
  dimension_id  smallint PRIMARY KEY,
  code          text     NOT NULL UNIQUE,
  label         text     NOT NULL,
  sort_order    smallint NOT NULL,

  -- HOW FAST A SIGNAL IN THIS DIMENSION GOES STALE. Someone's physical
  -- situation changes far faster than their spiritual one. These are opening
  -- guesses and are meant to be argued with.
  half_life_days integer NOT NULL,

  -- How much this dimension counts before any per-user or per-query weighting.
  base_weight   real     NOT NULL DEFAULT 1.0 CHECK (base_weight >= 0)
);

INSERT INTO dimensions (dimension_id, code, label, sort_order, half_life_days, base_weight) VALUES
  (1, 'spiritual',    'Spiritual',    1, 730, 1.0),
  (2, 'emotional',    'Emotional',    2,  90, 1.0),
  (3, 'physical',     'Physical',     3, 120, 1.0),
  (4, 'intellectual', 'Intellectual', 4, 365, 1.0),
  (5, 'social',       'Social',       5, 150, 1.0),
  (6, 'financial',    'Financial',    6, 180, 1.0);

-- GLOBAL SCORING KNOBS. Deliberately a key/value table rather than columns: new
-- knobs appear without a migration, and every one of them is visible in one
-- SELECT when a score looks wrong.
CREATE TABLE scoring_params (
  key        text        PRIMARY KEY,
  value      real        NOT NULL,
  note       text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO scoring_params (key, value, note) VALUES
  ('saturation_k',        0.35, 'score = 1 - exp(-k * sum). Higher = fewer observations to saturate'),
  ('window_residual',     0.15, 'a finished window still counts this much — "she was in SF last spring" is real knowledge'),
  ('stale_expired',       0.30, 'a fact past valid_until but recently so'),
  ('stale_long_gone',     0.10, 'a fact long past valid_until'),
  ('source_told_directly',1.00, 'they said it to you'),
  ('source_voice_note',   0.90, 'you recorded it about them'),
  ('source_imessage',     0.60, 'inferred from a message thread'),
  ('source_enrichment',   0.40, 'pulled from the web'),
  ('source_manual',       1.00, 'you typed it');

-- PER-USER LEARNED WEIGHTS. This is the layer that learns YOUR sense of what
-- matters: "financial shouldn't count this much for me."
--
-- It is parameter fitting, not model training -- a table of numbers you can open
-- and read. Feedback nudges it; nothing is opaque. Real learning off BigQuery
-- later tunes this same table.
CREATE TABLE user_dimension_weights (
  amber_id     uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  dimension_id smallint    NOT NULL REFERENCES dimensions (dimension_id),
  weight       real        NOT NULL DEFAULT 1.0 CHECK (weight >= 0 AND weight <= 5),
  sample_count integer     NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (amber_id, dimension_id)
);

-- The three levels multiply:
--   effective_weight = dimensions.base_weight
--                    x user_dimension_weights.weight
--                    x query_weight        (computed per question, not stored)
