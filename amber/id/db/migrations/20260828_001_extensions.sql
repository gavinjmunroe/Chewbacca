-- Extensions. Nothing in this schema works without these three.
--
--   vector    pgvector — semantic search over observations (HNSW)
--   pg_trgm   fuzzy text — "Micheal" finds Michael, "SF" finds San Francisco
--   btree_gist  lets a GiST index mix a range column with scalar columns, so
--               availability lookups can be owner-scoped inside one index
--
-- PostGIS is deliberately absent. places.geog arrives in its own migration the
-- day a radius query actually exists; until then location is a name and an
-- alias list, which is all the raw data supports.

CREATE EXTENSION IF NOT EXISTS vector;

-- FAIL HERE, NOT SIX FILES LATER. contact_embedding is halfvec, which pgvector
-- only has from 0.7.0. On an older build migration 017 dies with "type halfvec
-- does not exist" after sixteen files have already applied, which is a confusing
-- place to learn that the extension is too old.
DO $$
DECLARE v text;
BEGIN
  SELECT extversion INTO v FROM pg_extension WHERE extname = 'vector';
  IF string_to_array(v, '.')::int[] < ARRAY[0,7,0] THEN
    RAISE EXCEPTION 'pgvector % is too old; halfvec needs >= 0.7.0', v;
  END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;
