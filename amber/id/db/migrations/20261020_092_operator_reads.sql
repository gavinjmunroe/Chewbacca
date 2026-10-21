-- ---------------------------------------------------------------------------
-- 092 — LET AN OPERATOR SCRIPT SEE THE WHOLE ESTATE, ON PURPOSE AND ONLY TO
-- READ.
--
-- WHAT WENT WRONG, AND IT WAS WORSE THAN A BUG.
--
-- The admin scripts -- preflight, diagnose-calendar, join-orphans, org-domain
-- -- read `organizations` and `org_members` with no tenant set, because they
-- are asking questions ABOUT every tenant: how many workspaces are there,
-- which domain does each claim, who is in none of them.
--
-- Tenant isolation, once it was actually enforced, correctly answered
-- "nothing". There is no tenant, so no row is visible. Every one of those
-- scripts then reported its blindness as a finding:
--
--     Workspaces
--       none
--
-- while a live workspace sat in the table. The same run refused to create one
-- with `slug_taken`, because the INSERT hits a unique index that sees every
-- row -- the database was telling the truth twice and the two answers looked
-- like a contradiction.
--
-- A DIAGNOSTIC THAT REPORTS FICTION IS WORSE THAN NO DIAGNOSTIC. It is
-- confident, it is specific, and it sends somebody to fix a thing that was
-- never broken. Hours went into "there is no workspace" when the real
-- sentence was "this script cannot see one".
--
-- THE FIX, AND WHAT IT IS NOT.
--
-- A second permissive policy on the tables an operator script reports on,
-- admitting a transaction-local flag. SELECT ONLY -- there is no operator
-- path to a write here, and an operator script that needs to write does it
-- inside a tenant scope like everything else.
--
-- WHAT IT DOES NOT DEFEND AGAINST, said plainly, the same way 090 said it:
-- anything that can run arbitrary SQL as the application can raise this flag.
-- That moves nothing. Whoever runs these scripts holds the database
-- credentials already -- `railway run` is a shell on the production database
-- -- so this grants a reporting script what its operator could get with psql
-- in one line. The tenant boundary has always rested on the application being
-- the only thing holding the connection, and it still does.
--
-- WHY NOT REUSE amber_bootstrap. 091 deliberately narrowed that flag from
-- "open a table" to "name one row", so that raising it reveals one membership
-- rather than every customer. Widening it again for reporting would undo the
-- one property that migration exists to provide. These are different
-- questions and they get different doors.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE OR REPLACE FUNCTION amber_operator() RETURNS boolean AS $$
  SELECT COALESCE(current_setting('amber.operator', true), '') = 'on';
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION amber_operator() IS
  'True only inside an operator reporting script that set a transaction-local
   flag. Grants SELECT across tenants on the estate tables so that a
   diagnostic can report what is actually there rather than reporting its own
   blindness as a finding. Never grants a write.';

-- ---------------------------------------------------------------------------
-- The tables an operator script reports on, and no others.
--
-- DELIBERATELY NOT org_interactions, org_people OR org_knowledge. A support
-- script has no business reading what a customer's people said to each other,
-- and the questions these scripts ask -- which workspaces exist, who is in
-- one, which calendar is connected -- are answered without a single row of
-- anybody's content.
-- ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['organizations', 'org_members'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS amber_operator ON %I', t);
    EXECUTE format(
      'CREATE POLICY amber_operator ON %I FOR SELECT USING (amber_operator())', t);
  END LOOP;
END $$;

COMMIT;
