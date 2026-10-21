-- ============================================================================
-- THE BOUNDARY BECOMES THE DATABASE'S JOB.
--
-- Every org table carries org_id and every query in this service puts it in a
-- WHERE clause. That is a convention, and a convention is a thing a codebase
-- has so far. One forgotten clause in one handler, once, serves one company's
-- wiki to another -- and nothing anywhere would notice, because the query
-- succeeds, the rows are real, and the only wrong thing about the answer is
-- whose it is.
--
-- The composite foreign keys installed in 064, 067 and 069 already make it
-- impossible to WRITE a row across the boundary. This is the other half:
-- making it impossible to READ one.
--
-- HOW IT WORKS. Every org table gets row-level security and one policy, which
-- compares its org_id to `amber.org_id` -- a setting the application puts on
-- the transaction before it runs anything. A query that forgets its WHERE
-- clause now returns ZERO ROWS instead of somebody else's. A service that
-- forgets to set the tenant at all returns zero rows everywhere, loudly, in
-- development, rather than quietly over-serving in production.
--
-- FORCE ROW LEVEL SECURITY IS THE LOAD-BEARING WORD. A table's owner bypasses
-- its own policies by default, and this service connects as the owner, so
-- ENABLE alone would have been decoration -- a security control that is on in
-- the catalog and off in reality. FORCE applies the policy to the owner too.
--
-- WHY NOT A SCHEMA OR A DATABASE PER COMPANY. Both were considered and both
-- are worse here. A schema per tenant multiplies every migration by the number
-- of customers and turns connection pooling into a routing problem; a database
-- per tenant does that and adds an ops burden per signup. Neither is more
-- secure than a policy the database enforces on every row -- they are harder
-- to get wrong by hand, and this is not being done by hand. What they do buy
-- is physical separation for one enormous customer, which is a decision to
-- make for that customer, on that day, and not for everybody in advance.
--
-- WHAT THIS DOES NOT DO: the personal product. A personal account is not in
-- org_members, holds no org_id anywhere, and none of these tables is reachable
-- from a personal session -- the separation there is the account itself, which
-- is stronger than a policy because there is no shared row to police. The two
-- halves of the product share this database and share no row in it.
--
-- ── ENFORCEMENT IS A SEPARATE, DELIBERATE STEP ─────────────────────────────
--
-- The policies are created and RLS is enabled here. FORCE is NOT applied,
-- because the moment it is, any query path that has not been taught to set the
-- tenant returns nothing -- and that is a decision to make with the service
-- running in front of you, not inside a migration. Run
--
--     SELECT amber_tenant_enforce();
--
-- when scripts/verify-tenancy.mjs passes against the deployment. It is one
-- statement, it is reversible with amber_tenant_relax(), and the gap between
-- the two is the only window in which this is decoration.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- THE TENANT THE CURRENT TRANSACTION IS ACTING FOR
--
-- A function rather than inline current_setting() in nine policies, because
-- nine copies of a security predicate is eight chances to write it slightly
-- differently. `true` as the second argument means "null if unset" rather
-- than an error, which is what lets an unset context deny everything instead
-- of failing the connection.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION amber_current_org() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('amber.org_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION amber_current_org() IS
  'The organization this transaction is acting for, set by the application as
   a transaction-local setting. NULL when unset, which denies every row.';

-- ---------------------------------------------------------------------------
-- ONE POLICY PER ORG TABLE
--
-- USING governs what can be read and updated; WITH CHECK governs what can be
-- written. Both, on every table: a policy with only USING lets a caller write
-- a row it would not then be allowed to read, which is a hole shaped exactly
-- like the one this exists to close.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
  -- organizations is keyed on `id` rather than `org_id`; it is handled below.
  tables text[] := ARRAY[
    'org_members',
    'org_groups',
    'org_group_members',
    'org_group_links',
    'org_invites',
    'org_policy',
    'org_pages',
    'org_page_revisions',
    'org_page_attachments',
    'org_posts'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass(t) IS NULL THEN CONTINUE; END IF;

    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS amber_tenant ON %I', t);
    EXECUTE format($f$
      CREATE POLICY amber_tenant ON %I
        USING (amber_current_org() IS NOT NULL AND org_id = amber_current_org())
        WITH CHECK (amber_current_org() IS NOT NULL AND org_id = amber_current_org())
    $f$, t);
  END LOOP;
END $$;

-- The company row itself. Same rule, different column name.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS amber_tenant ON organizations;
CREATE POLICY amber_tenant ON organizations
  USING (amber_current_org() IS NOT NULL AND id = amber_current_org())
  WITH CHECK (amber_current_org() IS NOT NULL AND id = amber_current_org());

-- ---------------------------------------------------------------------------
-- THE SWITCH
--
-- Two functions rather than a flag column, so flipping enforcement is one
-- statement somebody runs on purpose and can read the source of.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION amber_tenant_enforce() RETURNS text AS $$
DECLARE t text; n int := 0;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c
      JOIN pg_policy p ON p.polrelid = c.oid AND p.polname = 'amber_tenant'
  LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    n := n + 1;
  END LOOP;
  RETURN format('tenant isolation enforced on %s tables', n);
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION amber_tenant_relax() RETURNS text AS $$
DECLARE t text; n int := 0;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c
      JOIN pg_policy p ON p.polrelid = c.oid AND p.polname = 'amber_tenant'
  LOOP
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY', t);
    n := n + 1;
  END LOOP;
  RETURN format('tenant isolation relaxed on %s tables (owner bypasses policies again)', n);
END $$ LANGUAGE plpgsql;

COMMENT ON FUNCTION amber_tenant_enforce() IS
  'Apply FORCE ROW LEVEL SECURITY everywhere the amber_tenant policy exists.
   Until this runs, the policies are present and the table owner bypasses them.';

-- ---------------------------------------------------------------------------
-- WHAT HOLDS WHEN THE ROWS ARE IN THE BILLIONS
--
-- A policy is correctness, not throughput. The index below is what keeps a
-- tenant-scoped read proportional to that tenant's data rather than to the
-- whole table: every org query begins with org_id, so every org table's hot
-- path should begin with it too.
--
-- Partitioning by org_id is the next step beyond this and is deliberately NOT
-- done here. It rewrites each table, cannot be undone in a migration, and buys
-- nothing until one tenant is large enough for the planner's pruning to beat
-- these indexes -- at which point the right move is to partition that table,
-- measured, rather than all of them, speculatively.
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS org_pages_tenant            ON org_pages (org_id);
CREATE INDEX IF NOT EXISTS org_page_revisions_tenant   ON org_page_revisions (org_id);
CREATE INDEX IF NOT EXISTS org_page_attachments_tenant ON org_page_attachments (org_id);
CREATE INDEX IF NOT EXISTS org_posts_tenant            ON org_posts (org_id);
CREATE INDEX IF NOT EXISTS org_members_tenant          ON org_members (org_id);
CREATE INDEX IF NOT EXISTS org_groups_tenant           ON org_groups (org_id);

COMMIT;
