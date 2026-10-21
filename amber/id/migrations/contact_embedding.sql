-- PeopleRank fast-retrieval index (INTERIM — see docs/PLAN-peoplerank-pgvector.md).
-- Run once against Cloud SQL. Requires pgvector >= 0.7.0 for halfvec (our
-- Perplexity vectors are 2560-dim, above pgvector's 2000-dim indexed limit for
-- plain `vector`; halfvec supports up to 4000 with HNSW).
--
-- If your instance's pgvector is < 0.7.0, halfvec will error here — upgrade the
-- extension, or fall back to reducing embedding dimensions (see the plan doc).

CREATE EXTENSION IF NOT EXISTS vector;

-- owner_id is the amberId (a UUID string), stored as TEXT so we never fight a
-- type cast; contact_id is the bigint contacts.id.
CREATE TABLE IF NOT EXISTS contact_embedding (
  owner_id     TEXT          NOT NULL,
  contact_id   BIGINT        NOT NULL,
  embedding    halfvec(2560) NOT NULL,
  content_hash TEXT          NOT NULL,
  model        TEXT          NOT NULL,
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, contact_id)
);

-- Owner-scoped approximate-nearest-neighbor over cosine distance.
CREATE INDEX IF NOT EXISTS contact_embedding_hnsw
  ON contact_embedding
  USING hnsw (embedding halfvec_cosine_ops);
