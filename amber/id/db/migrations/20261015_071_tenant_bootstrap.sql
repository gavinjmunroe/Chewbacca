-- ============================================================================
-- THE CHICKEN AND THE EGG, NAMED AND BROKEN.
--
-- Migration 070 put a policy on every org table that compares the row's
-- org_id to the tenant the transaction is acting for. That is correct for
-- every query in this service except exactly one, and the exception is fatal:
--
--     getMembership(amberId)  ->  SELECT ... FROM org_members
--                                  JOIN organizations ...
--                                 WHERE amber_id = $1
--
-- There is no org_id in it, because it is the query that DISCOVERS the
-- org_id. Everything downstream -- resolveActor, requireOrgMember, the tenant
-- scope itself -- is waiting on its answer. Under FORCE it returns zero rows,
-- so no actor resolves, so no tenant is ever set, so every org request in the
-- product fails with "not a member" and the console is empty for everybody at
-- once.
--
-- This is the normal shape of this problem and it has a normal answer: the
-- bootstrap read runs as the definer, outside the policy, and is written so
-- narrowly that running outside the policy grants nothing. It takes one
-- amber_id and returns that person's one live membership. It cannot be asked
-- about anybody else, it cannot list a roster, and it exposes nothing the
-- caller's own session is not already about to be told.
--
-- SECURITY DEFINER IS A LOADED GUN AND THIS IS HOW IT IS KEPT POINTED DOWN:
--   - one argument, one row, no wildcards, no LIKE, no OR
--   - search_path pinned, so a caller cannot shadow org_members with their own
--     table and have the definer read that instead
--   - EXECUTE granted to the role the service uses and nobody else
--   - it is the only definer function in the schema, so "what runs outside
--     the policies" has an answer that fits in one line
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION amber_membership_bootstrap(p_amber_id uuid)
RETURNS TABLE (
  org_id     uuid,
  amber_id   uuid,
  role       text,
  status     text,
  joined_at  timestamptz,
  title      text,
  location   text,
  bio        text,
  org_name   text,
  org_slug   text,
  org_status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
-- Pinned so a caller cannot put their own org_members earlier in the path and
-- have a definer function read it. Without this line the function is a way to
-- run a chosen query as the table owner.
SET search_path = pg_catalog, public
AS $$
  SELECT m.org_id, m.amber_id, m.role, m.status, m.joined_at,
         m.title, m.location, m.bio,
         o.name, o.slug, o.status
    FROM public.org_members m
    JOIN public.organizations o ON o.id = m.org_id AND o.deleted_at IS NULL
   WHERE m.amber_id = p_amber_id
     AND m.deleted_at IS NULL
   LIMIT 1;
$$;

COMMENT ON FUNCTION amber_membership_bootstrap(uuid) IS
  'The one read that runs outside the tenant policies, because it is the read
   that discovers which tenant to set. One person, one membership, no listing.';

-- The service connects as the owner today; this is explicit anyway, so that
-- moving to a narrower role later does not silently remove the bootstrap and
-- take the console down.
DO $$
BEGIN
  EXECUTE format(
    'GRANT EXECUTE ON FUNCTION amber_membership_bootstrap(uuid) TO %I',
    current_user
  );
END $$;

COMMIT;
