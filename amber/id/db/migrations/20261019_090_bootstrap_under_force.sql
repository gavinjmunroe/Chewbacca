-- ---------------------------------------------------------------------------
-- 090 — MAKE THE BOOTSTRAP READS SURVIVE FORCE ROW LEVEL SECURITY.
--
-- WHAT BROKE, AND WHY IT WAS NOT OBVIOUS.
--
-- Migration 070 created the policies and left enforcement to a function you
-- run on purpose. Running it finally -- correctly, because thirty tables had
-- policies the owner was bypassing -- broke sign-in.
--
-- FORCE ROW LEVEL SECURITY applies policies to the table's OWNER. A
-- SECURITY DEFINER function executes as the FUNCTION's owner. Here those are
-- the same role. So the moment FORCE went on, amber_membership_bootstrap
-- became subject to the very policy it exists to precede: it reads
-- org_members to discover which tenant to set, the tenant is not set yet,
-- amber_current_org() is NULL, and the policy correctly denies every row.
--
-- The symptom is not an error. The function returns zero rows, so everybody
-- who signs in looks like they belong to no workspace. A security control
-- doing exactly what it was asked, producing an outage that reads like data
-- loss.
--
-- THE FIX: A SECOND, NARROWER POLICY, AND A FLAG ONLY THESE FUNCTIONS SET.
--
-- Postgres combines permissive policies with OR. So the four tables the
-- bootstrap path touches get one extra policy that admits a transaction-local
-- setting, and the bootstrap functions set that setting for the length of
-- their own call and clear it before returning.
--
-- WHY THIS IS NARROW ENOUGH TO BE HONEST ABOUT. The flag is set only inside
-- SECURITY DEFINER functions whose search_path is pinned, each of which runs
-- one fixed statement against one table and returns a single row. It is
-- transaction-local, so a function that raises takes the flag down with the
-- transaction rather than leaving a door open on a pooled connection. And the
-- policies it satisfies are SELECT-only except on org_invites, where claiming
-- an invitation is a write by definition.
--
-- WHAT IT DOES NOT DEFEND AGAINST, said plainly: anything that can already
-- run arbitrary SQL as the application can set this flag, exactly as it can
-- already set amber.org_id to any company it likes. This moves nothing. The
-- tenant boundary has always rested on the application being the only thing
-- holding the connection; that was true before FORCE and is true after.
--
-- THE ALTERNATIVE WE DID NOT TAKE. A role with BYPASSRLS owning these
-- functions would be cleaner in principle. Granting BYPASSRLS needs
-- superuser, which managed Postgres does not hand out, so it is a fix that
-- works on a laptop and not in production -- which is the worst kind.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- The flag, and the one policy that reads it.
--
-- Named amber_bootstrap rather than folded into amber_tenant so that the two
-- can be read, audited and dropped independently -- and so a future reader
-- sees immediately that this table has an exception rather than having to
-- parse a longer predicate to discover one.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION amber_bootstrapping() RETURNS boolean AS $$
  SELECT COALESCE(current_setting('amber.bootstrap', true), '') = 'on';
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION amber_bootstrapping() IS
  'True only inside a bootstrap function, which sets a transaction-local flag
   for the length of its own call. This is how the reads that must PRECEDE a
   tenant survive FORCE ROW LEVEL SECURITY.';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['org_members', 'organizations', 'org_api_keys'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS amber_bootstrap ON %I', t);
    EXECUTE format(
      'CREATE POLICY amber_bootstrap ON %I FOR SELECT USING (amber_bootstrapping())', t);
  END LOOP;
END $$;

-- Claiming an invitation is a write, so this one needs ALL rather than
-- SELECT. It is still only reachable from amber_invite_claim, which runs one
-- UPDATE against one row by token.
DROP POLICY IF EXISTS amber_bootstrap ON org_invites;
CREATE POLICY amber_bootstrap ON org_invites
  USING (amber_bootstrapping())
  WITH CHECK (amber_bootstrapping());

-- ---------------------------------------------------------------------------
-- The membership read, rewritten in plpgsql so it can hold the flag.
--
-- Same signature, same single row, same pinned search_path. The only change
-- is that it now raises the flag, reads, and lowers it -- which is what makes
-- the one read that discovers a tenant work when every table requires one.
-- ---------------------------------------------------------------------------

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
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Transaction-local. A raise from the query below takes it down with the
  -- transaction rather than leaving it set on a pooled connection.
  PERFORM set_config('amber.bootstrap', 'on', true);

  RETURN QUERY
    SELECT m.org_id, m.amber_id, m.role, m.status, m.joined_at,
           m.title, m.location, m.bio,
           o.name, o.slug, o.status
      FROM public.org_members m
      JOIN public.organizations o ON o.id = m.org_id AND o.deleted_at IS NULL
     WHERE m.amber_id = p_amber_id
       AND m.deleted_at IS NULL
     LIMIT 1;

  PERFORM set_config('amber.bootstrap', '', true);
END $$;

COMMENT ON FUNCTION amber_membership_bootstrap(uuid) IS
  'The one read that runs outside the tenant policies, because it is the read
   that discovers which tenant to set. One person, one membership, no listing.
   Holds amber.bootstrap for the length of its own call so that it survives
   FORCE ROW LEVEL SECURITY, which otherwise applies to this function because
   the function owner and the table owner are the same role.';

COMMIT;

-- ---------------------------------------------------------------------------
-- THE OTHER THREE, FOR THE SAME REASON.
--
-- Each of these is also a read that must PRECEDE a tenant, and each would
-- also have returned nothing the moment FORCE went on. Fixing only the one
-- that sign-in happens to hit first would leave three outages waiting for
-- whoever next accepted an invitation or called the API with a key -- failing
-- the same way, silently, days later, with nothing in the logs to connect
-- them back to this change.
-- ---------------------------------------------------------------------------

BEGIN;

/* Read one unclaimed invitation by the hash of its token. The token is the
   authorization; nothing else can be asked of this function. */
CREATE OR REPLACE FUNCTION amber_invite_peek(p_token_hash bytea)
RETURNS TABLE (
  id          uuid,
  org_id      uuid,
  email       text,
  role        text,
  group_id    uuid,
  expires_at  timestamptz,
  invited_by  uuid,
  org_name    text,
  org_slug    text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM set_config('amber.bootstrap', 'on', true);

  RETURN QUERY
    SELECT i.id, i.org_id, i.email, i.role, i.group_id, i.expires_at, i.invited_by,
           o.name, o.slug
      FROM public.org_invites i
      JOIN public.organizations o ON o.id = i.org_id AND o.deleted_at IS NULL
     WHERE i.token_hash = p_token_hash
       AND i.accepted_at IS NULL
       AND i.revoked_at IS NULL
       AND i.expires_at > now()
     LIMIT 1;

  PERFORM set_config('amber.bootstrap', '', true);
END $$;

/* Claim one invitation, atomically. Still a single UPDATE, so two people
   racing the same link produce exactly one winner. */
CREATE OR REPLACE FUNCTION amber_invite_claim(p_token_hash bytea)
RETURNS TABLE (
  id         uuid,
  org_id     uuid,
  email      text,
  role       text,
  group_id   uuid,
  invited_by uuid
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM set_config('amber.bootstrap', 'on', true);

  RETURN QUERY
    UPDATE public.org_invites
       SET accepted_at = now()
     WHERE token_hash = p_token_hash
       AND accepted_at IS NULL
       AND revoked_at IS NULL
       AND expires_at > now()
    RETURNING org_invites.id, org_invites.org_id, org_invites.email,
              org_invites.role, org_invites.group_id, org_invites.invited_by;

  PERFORM set_config('amber.bootstrap', '', true);
END $$;

/* The read that discovers which tenant a machine request belongs to. */
CREATE OR REPLACE FUNCTION amber_api_key_bootstrap(p_key_hash text)
RETURNS TABLE (
  org_id   uuid,
  key_id   uuid,
  key_name text,
  scopes   text[],
  org_name text,
  org_slug text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM set_config('amber.bootstrap', 'on', true);

  RETURN QUERY
    SELECT k.org_id, k.id, k.name, k.scopes, o.name, o.slug
      FROM public.org_api_keys k
      JOIN public.organizations o ON o.id = k.org_id AND o.deleted_at IS NULL
     WHERE k.key_hash = p_key_hash
       AND k.revoked_at IS NULL
     LIMIT 1;

  PERFORM set_config('amber.bootstrap', '', true);
END $$;

COMMIT;
