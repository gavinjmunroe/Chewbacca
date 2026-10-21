-- THE CLASSIFICATION QUEUE.
--
-- Six dimensions were a schema and not a behaviour: observation_dimensions only
-- ever got rows if a caller supplied them, and no caller did. Now the lexicon
-- runs inside the same transaction as every insert, so a fact is classified
-- before it is visible -- and the ones it is unsure about have to be findable
-- afterwards, or "we'll have a model look at it later" is a sentence with no
-- mechanism behind it.
--
-- WHY A COLUMN AND NOT A DERIVED PREDICATE. "Rows whose best confidence is under
-- 0.5" is the same set today and a different set the moment a threshold moves,
-- and it cannot express the difference between "the lexicon was confident" and
-- "a human said so". A worker needs a queue it can drain and a state it can
-- write back; that is a column.
--
--   pending    the lexicon was unsure. Its best guess IS already written -- no
--              observation is ever unclassified -- but a model should look.
--              THIS IS THE QUEUE.
--   lexicon    the lexicon was confident. Final unless a human disagrees.
--   llm        a model settled it.
--   human      somebody corrected it. Nothing automated touches it again, which
--              is the same promise observation_dimensions.assigned_by makes at
--              the row level.
--   none       classified, and the honest answer is that it belongs to no
--              dimension. "Her flight lands at 4" is not spiritual. Distinct
--              from pending so the worker does not re-ask forever.
ALTER TABLE observations
  ADD COLUMN dimension_status text NOT NULL DEFAULT 'pending'
    CHECK (dimension_status IN ('pending','lexicon','llm','human','none'));

-- THE QUEUE, and it is a partial index because the queue is the small part. Once
-- the backlog drains this index holds a handful of rows regardless of how many
-- hundreds of millions of observations exist, so the worker's "what is next"
-- costs the same on day one and year five.
CREATE INDEX obs_dimension_pending_idx ON observations (created_at)
  WHERE dimension_status = 'pending' AND deleted_at IS NULL;

-- How many attempts the worker has spent on a row. A fact the model refuses to
-- parse three times running is a fact that gets left alone rather than retried
-- until the end of time -- an unbounded retry against a paid API is a bill, not
-- a feature.
ALTER TABLE observations
  ADD COLUMN dimension_attempts smallint NOT NULL DEFAULT 0;

-- NO OTHER INDEX IS ADDED HERE. Dimension-filtered retrieval -- "the emotional
-- facts about this contact, newest first" -- is served by obs_contact_time_idx
-- (owner_id, contact_id, observed_at DESC) from migration 007 joined to
-- obsdim_dimension_idx from the same file. I drafted a third index covering the
-- same three columns before checking, which would have been a duplicate of one
-- that already exists: same cost on every write, no gain on any read.

