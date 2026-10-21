-- WHAT THE OWNER ASKS ABOUT, KEPT.
--
-- Amber already scores every people question across the six dimensions: it is
-- how retrieval decides which observations to pull, and it happens on the read
-- path for free (see src/lib/dimension-classifier.js -- a deterministic
-- heuristic, not a model call). Until now that distribution was computed, used
-- to order one answer, and thrown away.
--
-- It is evidence. Somebody who asks after their sister three times a week is
-- telling you something about the social dimension of their life even if they
-- never state a fact about it, and the whole point of the self coverage score is
-- to know which dimensions Amber actually has a read on.
--
-- IT IS DELIBERATELY WEAKER EVIDENCE THAN A STATED FACT, and the read side is
-- where that is applied rather than here -- see src/db/self-dimensions.js. A
-- question is curiosity; an observation is a statement. Storing them in separate
-- tables rather than writing questions in as observations is what keeps that
-- distinction available instead of baking one weighting in forever.
--
-- ONE ROW PER DIMENSION PER QUESTION, not one row per question with six columns.
-- The classifier returns a sparse-ish distribution and a dimension can be added
-- to the ontology only by migration anyway, but a long table joins to
-- `dimensions` the same way observation_dimensions does, so every read that
-- already knows how to weight a dimension keeps working unchanged.

CREATE TABLE IF NOT EXISTS query_dimensions (
  query_dimension_id bigserial    PRIMARY KEY,
  owner_id           uuid         NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  dimension_id       smallint     NOT NULL REFERENCES dimensions (dimension_id),
  -- The classifier's weight for this dimension on this question, 0..1.
  score              real         NOT NULL CHECK (score BETWEEN 0 AND 1),
  asked_at           timestamptz  NOT NULL DEFAULT now()
);

-- THE ONLY READ THIS TABLE HAS: one owner's rows, newest first, so the decay
-- can be applied. Keyed owner-then-time because every query is owner-scoped and
-- an unscoped read of this table would be a cross-owner leak.
CREATE INDEX IF NOT EXISTS query_dimensions_owner_idx
  ON query_dimensions (owner_id, asked_at DESC);

-- WHY THERE IS NO UNIQUE CONSTRAINT. Asking the same thing twice is two pieces
-- of evidence, not one. Deduplicating would discard exactly the repetition that
-- makes a question worth counting.
