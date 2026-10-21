-- SEMANTIC SEARCH OVER FACTS, and the queue that fills it.
--
-- observations.embedding and its HNSW index have existed since 007 and nothing
-- has ever written a vector into either. Retrieval is lexical and dimensional
-- today, which means "who is having a hard time?" cannot find "Maggie has been
-- crying most evenings" -- no shared word, and the emotional tag alone cannot
-- distinguish it from forty other emotional facts.
--
-- ── halfvec, MATCHING contact_embedding ─────────────────────────────────────
--
-- The column was vector(1536); contact_embedding has always been halfvec(1536).
-- Two precisions for the same model in one schema is the sort of inconsistency
-- that eventually becomes a bug where somebody compares across them.
--
-- halfvec is the right one, and observations is the table where it matters:
-- contact_embedding holds one row per contact, observations will hold dozens per
-- contact. Half precision costs nothing measurable in recall at 1536 dimensions
-- -- the quantisation error is far below the distance between any two distinct
-- facts -- and it halves both the table and the HNSW index. An index that fits
-- in memory is the difference between a millisecond and a disk read.
--
-- Free to change now, because the column has never held a value.
DROP INDEX IF EXISTS obs_embedding_idx;
ALTER TABLE observations
  ALTER COLUMN embedding TYPE halfvec(1536) USING embedding::halfvec(1536);
CREATE INDEX obs_embedding_idx ON observations
  USING hnsw (embedding halfvec_cosine_ops);

-- ── THE QUEUE ────────────────────────────────────────────────────────────────
--
-- Same shape as the dimension queue and for the same reason: embedding is an
-- HTTP call to OpenAI, and nothing that talks to a third party belongs on the
-- path where somebody is waiting for a voice note to save.
--
-- The queue is "embedding IS NULL", so it needs no status column -- the absence
-- of a vector IS the pending state, and there is no way for the two to disagree.
-- What it does need is an attempt counter, or a fact whose text the API keeps
-- refusing is retried until the end of time, which against a paid endpoint is a
-- bill rather than a bug.
ALTER TABLE observations
  ADD COLUMN embedding_attempts smallint NOT NULL DEFAULT 0;

CREATE INDEX obs_embedding_pending_idx ON observations (created_at)
  WHERE embedding IS NULL AND deleted_at IS NULL AND embedding_attempts < 3;

-- ── THE BLEND ────────────────────────────────────────────────────────────────
--
-- How much of topical relevance comes from the vector versus from the dimension
-- tags. 0.5 is a starting guess and explicitly meant to be argued with, which is
-- why it is a row here rather than a constant in retrieval.js.
--
--   1.0  pure semantic search. The dimensions stop mattering.
--   0.0  pure dimension matching. Back to where retrieval was before this.
--
-- Both signals answer "is this fact about what was asked". Everything else in
-- the score -- recency, who told you, salience -- multiplies whatever they
-- agree on, and is unaffected by this dial.
INSERT INTO scoring_params (key, value, note) VALUES
  ('semantic_alpha', 0.5,
   'topical relevance = alpha * cosine similarity + (1-alpha) * dimension match');
