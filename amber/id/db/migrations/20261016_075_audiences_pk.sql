-- ============================================================================
-- org_audiences NEEDS A PRIMARY KEY, AND THE REASON IS NOT TIDINESS.
--
-- Migration 074 gave the table a UNIQUE INDEX and no PRIMARY KEY, which is the
-- same thing right up until something tries to delete a row:
--
--   55000  cannot delete from table "org_audiences" because it does not have
--          a replica identity and publishes deletes
--
-- This database is in a publication that replicates deletes, and Postgres
-- refuses a DELETE or UPDATE on a published table that cannot identify the old
-- row downstream. A unique index is not enough on its own -- the planner needs
-- it nominated, either as the primary key or via REPLICA IDENTITY USING INDEX.
--
-- So every re-share failed: setAudience deletes the old rows before writing
-- the new ones, and the whole transaction aborted on that DELETE. From the
-- browser it looked like "Something went wrong on our end" on the Save button
-- of a dialog where nothing was obviously wrong.
--
-- The primary key is the right fix rather than REPLICA IDENTITY FULL, which
-- would make the downstream match on every column of every row.
-- ============================================================================

-- Drop the plain unique index first; the PRIMARY KEY creates an equivalent one
-- and two indexes on the same tuple is a write cost for nothing.
DROP INDEX IF EXISTS org_audiences_unique;

ALTER TABLE org_audiences
  DROP CONSTRAINT IF EXISTS org_audiences_pkey;

ALTER TABLE org_audiences
  ADD CONSTRAINT org_audiences_pkey PRIMARY KEY (org_id, item_type, item_id, kind, ref);
