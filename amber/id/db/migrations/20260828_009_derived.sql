-- DERIVED. Computed on write, read on query, and fully rebuildable.
--
-- TRUNCATING EITHER OF THESE MUST ALWAYS BE SAFE. They hold no truth of their
-- own -- a job reconstructs them from observations, observation_dimensions and
-- contact_interaction_stats. They exist so a read is an index scan instead of a
-- computation.
--
-- REFRESHED BY A JOB, NOT A TRIGGER. A trigger fires invisibly whether you meant
-- it to or not; a job is something you can watch run, pause and reason about.

CREATE TABLE contact_scores (
  owner_id            uuid        NOT NULL,
  contact_id          uuid        NOT NULL,
  base_score          real        NOT NULL DEFAULT 0,
  warmth              real        NOT NULL DEFAULT 0,
  last_interaction_at timestamptz,
  observation_count   integer     NOT NULL DEFAULT 0,
  completeness        real        NOT NULL DEFAULT 0,
  computed_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, contact_id),
  CONSTRAINT cs_owner_contact_fk FOREIGN KEY (owner_id, contact_id)
    REFERENCES contacts (owner_id, id) ON DELETE CASCADE
);
-- THE SHORTLIST INDEX. This is what turns "rank my 50,000 contacts" into an
-- index scan that stops after 200 rows.
CREATE INDEX cs_shortlist_idx ON contact_scores (owner_id, base_score DESC);

-- SIX ROWS PER CONTACT. Powers the radar chart and "who do I know that's
-- struggling financially" as a single index scan over a precomputed number.
--
--   contribution = confidence x weight
--                x temporal_multiplier(shape, dates, half_life)
--                x source_trust(source)
--   score        = 1 - exp(-k * sum(contribution))     saturating, never > 1
--
-- last_signal_at is what stops a two-year-old physical signal reading like
-- Tuesday's.
CREATE TABLE contact_dimension_state (
  owner_id          uuid        NOT NULL,
  contact_id        uuid        NOT NULL,
  dimension_id      smallint    NOT NULL REFERENCES dimensions (dimension_id),
  score             real        NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 1),
  raw_sum           real        NOT NULL DEFAULT 0,
  last_signal_at    timestamptz,
  observation_count integer     NOT NULL DEFAULT 0,
  computed_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, contact_id, dimension_id),
  CONSTRAINT cds_owner_contact_fk FOREIGN KEY (owner_id, contact_id)
    REFERENCES contacts (owner_id, id) ON DELETE CASCADE
);
-- "Who am I closest to on Financial" — one index scan, no scan of observations.
CREATE INDEX cds_dimension_idx ON contact_dimension_state (owner_id, dimension_id, score DESC);
