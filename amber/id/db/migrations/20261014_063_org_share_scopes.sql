-- ============================================================================
-- THE CEILING STOPS BEING A TABLE NOBODY READS.
--
-- Migration 062 built the spine: companies, members, groups, and a policy
-- saying how far each kind of thing may travel. Nothing read it. This is the
-- migration where a share made inside a company is marked as the company's,
-- addressed to an audience inside it, and refused -- at read time, on every
-- read, forever -- if it sits above what the admin allows.
--
-- THREE THINGS LAND HERE AND THEY ARE ONE IDEA.
--
-- 1. `shares.org_id`. EVERY share made by a member of a company carries it, not
--    just the ones addressed to the company. A member sharing a note with one
--    outside contact is still doing it inside the company instance, with the
--    company's data, and the row has to say so -- otherwise "what has this
--    organization shared, and with whom" is a question nobody can answer, and
--    the warehouse has no column to separate a company's rows from a consumer's.
--
-- 2. `shares.classification`. What KIND of thing this is: public, internal,
--    customer_safe, private. The axis the ceiling is set along. An org member's
--    share with none stated is written as `internal` -- the company's own
--    business, which is both the commonest case and a safe middle of the ladder.
--
-- 3. `org_scope_rank()`. One ordering of audiences by blast radius, usable from
--    SQL, so the authorization predicate can compare an audience to a cap
--    without the comparison living in JavaScript where a read path could
--    forget to call it.
--
-- WHY READ TIME AND NOT ONLY WRITE TIME. Both, actually -- but read time is the
-- one that matters. A ceiling enforced only on write is a ceiling that applied
-- on the day somebody clicked share: an admin who tightens the policy on Monday
-- has changed nothing about the eight hundred things shared last week. Checking
-- on read means tightening the policy takes effect on the next page load, and
-- loosening it brings things back. That is what a person means when they say
-- "our policy is X".
--
-- The cost is a join per share row on the feed, against a table with four rows
-- per company. That is the right trade.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- HOW FAR EACH AUDIENCE REACHES, as one number.
--
-- The order is by BLAST RADIUS and not by headcount, which is the same point
-- lib/org-scopes.js makes and the reason `contact` outranks `org`: one named
-- person outside the company is further away than four hundred people inside
-- it. A ceiling that counted heads would let an org-capped thing go to a
-- customer, which is exactly backwards.
--
--   0  self            nobody but the author
--   1  group           one named group inside the company
--   2  org             everybody in the company
--   3  contact         one named person, who may be outside
--   3  customer        one named customer, outside, by link   (phase 6)
--   4  circle          a curated list, mostly outside
--   4  cohort          a derived audience, mostly outside
--   4  customer_group  a named set of customers               (phase 6)
--   4  network         everyone this person is connected to
--
-- ANYTHING UNKNOWN RANKS 99 AND IS THEREFORE NEVER PERMITTED. A scope type
-- added later and forgotten here fails closed: shares addressed to it resolve
-- for nobody, which somebody notices immediately, rather than resolving for
-- everybody, which nobody notices at all.
--
-- IMMUTABLE because it is a pure function of its argument, which lets Postgres
-- use it inside the predicate without re-planning per row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION org_scope_rank(scope text) RETURNS integer
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE scope
           WHEN 'self'           THEN 0
           WHEN 'group'          THEN 1
           WHEN 'org'            THEN 2
           WHEN 'contact'        THEN 3
           WHEN 'customer'       THEN 3
           WHEN 'circle'         THEN 4
           WHEN 'cohort'         THEN 4
           WHEN 'customer_group' THEN 4
           WHEN 'network'        THEN 4
           ELSE 99
         END;
$$;

COMMENT ON FUNCTION org_scope_rank(text) IS
  'Blast radius of a share audience, 0 = narrowest. Unknown scopes rank 99 so
   they are never under any ceiling. Mirrors lib/org-scopes.js.';

-- ---------------------------------------------------------------------------
-- TWO COLUMNS ON `shares`.
--
-- Both nullable, and that is what makes this migration a no-op for every
-- existing row and every consumer account: a share with no org_id is a personal
-- share and the ceiling clause does not apply to it at all.
--
-- org_id does NOT cascade from organizations the way a child row would. It is
-- ON DELETE CASCADE deliberately: a company being deleted takes its shares with
-- it, because a share stamped with a company that no longer exists would fall
-- out of the ceiling check and silently widen.
-- ---------------------------------------------------------------------------
ALTER TABLE shares
  ADD COLUMN IF NOT EXISTS org_id         uuid NULL REFERENCES organizations (id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS classification text NULL;

ALTER TABLE shares DROP CONSTRAINT IF EXISTS shares_classification_check;
ALTER TABLE shares ADD CONSTRAINT shares_classification_check
  CHECK (classification IS NULL
         OR classification IN ('public', 'internal', 'customer_safe', 'private'));

-- The two new audiences.
ALTER TABLE shares DROP CONSTRAINT IF EXISTS shares_scope_type_check;
ALTER TABLE shares ADD CONSTRAINT shares_scope_type_check
  CHECK (scope_type IN ('network', 'circle', 'contact', 'cohort', 'org', 'group'));

ALTER TABLE network_visibility DROP CONSTRAINT IF EXISTS network_visibility_scope_type_check;
ALTER TABLE network_visibility ADD CONSTRAINT network_visibility_scope_type_check
  CHECK (scope_type IN ('network', 'circle', 'contact', 'cohort', 'org', 'group'));

-- AN ORG AUDIENCE WITHOUT A COMPANY IS UNRESOLVABLE, so it is refused rather
-- than stored. The viewer-reach legs for 'org' and 'group' both key on
-- s.org_id; a row with a NULL one would match nobody and look, to the person
-- who made it, exactly like a share that worked.
--
-- Classification is required with them for the same reason in reverse: the
-- ceiling clause looks up a policy row BY classification, and a NULL one would
-- find no row and refuse the share forever.
ALTER TABLE shares DROP CONSTRAINT IF EXISTS shares_org_scope_needs_org;
ALTER TABLE shares ADD CONSTRAINT shares_org_scope_needs_org
  CHECK (scope_type NOT IN ('org', 'group')
         OR (org_id IS NOT NULL AND classification IS NOT NULL));

-- "Everything this company has shared" -- the admin question, the audit
-- question, and the one the warehouse will filter on.
CREATE INDEX IF NOT EXISTS shares_org_idx
  ON shares (org_id, created_at DESC) WHERE org_id IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN shares.org_id IS
  'The company this share was made inside. Stamped on EVERY share by a member,
   whatever the audience -- not only the ones addressed to the company.';
COMMENT ON COLUMN shares.classification IS
  'What kind of thing this is. The axis org_policy sets a ceiling along.';

COMMIT;
