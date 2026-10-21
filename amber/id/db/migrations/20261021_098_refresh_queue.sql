-- ---------------------------------------------------------------------------
-- WHO THE SYNC WORKER SHOULD VISIT. NOT A TENANT TABLE, ON PURPOSE.
--
-- THE BUG THIS EXISTS TO END. Tenant isolation is enforced, so every read of
-- org_memory_sources needs an org id already in hand. A background worker has
-- the opposite problem from a request: it has no org and is trying to find
-- out which ones have work. Its query returned zero rows, every hour, since
-- the day it was written -- and an empty result is not an error, so nothing
-- said so. The OAuth callback logged "grant mail: ok" from inside a tenant
-- scope and the refresh logged "no live grants" about that same row a
-- millisecond later, outside one.
--
-- WHY NOT A DEFINER FUNCTION. Because the bootstrap policies in 091 admit
-- exactly the one row whose id the caller names -- "raising the flag reads
-- one row rather than a table" -- and a worker needs a list. Widening that to
-- let a function enumerate members would trade a real isolation guarantee for
-- a scheduling convenience, which is the wrong trade and the kind that is
-- never revisited.
--
-- SO THE LIST IS ITS OWN FACT. Two ids and a timestamp: which member of which
-- org has granted something. It carries no source names, no tokens, no
-- relationship data, and nothing here is readable by any API surface -- so it
-- is not tenant data and does not want a tenant policy. It is written where
-- consent is recorded and read by the worker, which then opens that org's
-- tenant and does everything else inside it.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS memory_refresh_queue (
  org_id     uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  amber_id   uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,

  -- When this pair was last known to have a live grant. Not a schedule: the
  -- worker decides its own cadence, and the grant itself is re-checked inside
  -- the tenant before anything is read.
  enrolled_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (org_id, amber_id)
);

-- The worker reads the whole table, which is one row per connected member.
-- An index would be for a query nobody makes.
