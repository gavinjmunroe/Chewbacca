-- ---------------------------------------------------------------------------
-- 091 — THE BOOTSTRAP FLAG SHOULD NAME ONE ROW, NOT OPEN A TABLE.
--
-- 090 made the pre-tenant reads survive FORCE by adding a policy that admits
-- a transaction-local flag. It worked, and it was blunter than it needed to
-- be: while the flag is up, org_members, organizations and org_api_keys are
-- ENTIRELY readable and org_invites is entirely writable.
--
-- The migration said plainly that anything able to run arbitrary SQL as the
-- application could raise that flag, and that this moves nothing because such
-- a thing could already set amber.org_id to any company it liked. That was
-- true and it was a smaller argument than it looked: setting amber.org_id
-- gives you ONE company at a time and leaves you guessing at ids, while
-- raising the flag hands over every company's membership and every customer
-- name in one select.
--
-- THE FIX IS TO MAKE THE FLAG CARRY THE ANSWER IT IS ASKING ABOUT. Each
-- bootstrap function already knows the single row it wants -- a person's id, a
-- token hash, a key hash -- because that is the argument it was called with.
-- So it puts that value in the setting, and the policy admits exactly the row
-- that matches it.
--
-- What that changes, concretely: raising the flag no longer reads a table. It
-- reads one row, and only if you already knew its primary identifier. An
-- attacker who can set session variables now has to know a specific person's
-- uuid or a specific unexpired invitation token to learn anything, and learns
-- only that one thing. The difference between "every customer" and "the one
-- you could already name" is the whole point.
--
-- ORGANIZATIONS NEEDS TWO STEPS, which is why the membership function changes
-- shape. It cannot name the org until it has read the membership, so it reads
-- the membership under the person's id, then raises a second setting for the
-- org it found, then reads that one organization. Two narrow reads instead of
-- one broad join.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- The settings, read as text and compared to the row's own identifier.
--
-- NULLIF on the empty string so that "cleared" and "never set" are the same
-- state, and an unset context admits nothing rather than erroring.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION amber_bootstrap_subject() RETURNS text AS $$
  SELECT NULLIF(current_setting('amber.bootstrap', true), '');
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION amber_bootstrap_org() RETURNS uuid AS $$
  SELECT NULLIF(current_setting('amber.bootstrap_org', true), '')::uuid;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION amber_bootstrap_subject() IS
  'The single identifier a bootstrap function is asking about: a person uuid,
   a token hash or a key hash. The policies below admit the row that matches
   it and nothing else, so raising the flag reads one row rather than a
   table.';

-- ---------------------------------------------------------------------------
-- One policy per table, each naming the column that identifies the row.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS amber_bootstrap ON org_members;
CREATE POLICY amber_bootstrap ON org_members FOR SELECT
  USING (amber_id::text = amber_bootstrap_subject());

DROP POLICY IF EXISTS amber_bootstrap ON organizations;
CREATE POLICY amber_bootstrap ON organizations FOR SELECT
  USING (id = amber_bootstrap_org());

-- encode(...,'hex') rather than comparing bytea to text: the setting is a
-- string, and a cast of arbitrary text to bytea is a way to make this error
-- rather than deny.
DROP POLICY IF EXISTS amber_bootstrap ON org_invites;
CREATE POLICY amber_bootstrap ON org_invites
  USING (encode(token_hash, 'hex') = amber_bootstrap_subject())
  WITH CHECK (encode(token_hash, 'hex') = amber_bootstrap_subject());

DROP POLICY IF EXISTS amber_bootstrap ON org_api_keys;
CREATE POLICY amber_bootstrap ON org_api_keys FOR SELECT
  USING (key_hash = amber_bootstrap_subject());

-- ---------------------------------------------------------------------------
-- Membership: the person, then the organization they turned out to be in.
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
DECLARE m record;
BEGIN
  PERFORM set_config('amber.bootstrap', p_amber_id::text, true);

  SELECT * INTO m
    FROM public.org_members mm
   WHERE mm.amber_id = p_amber_id AND mm.deleted_at IS NULL
   LIMIT 1;

  IF m IS NULL THEN
    PERFORM set_config('amber.bootstrap', '', true);
    RETURN;
  END IF;

  -- Now, and only now, do we know which organization to ask for.
  PERFORM set_config('amber.bootstrap_org', m.org_id::text, true);

  RETURN QUERY
    SELECT m.org_id, m.amber_id, m.role, m.status, m.joined_at,
           m.title, m.location, m.bio,
           o.name, o.slug, o.status
      FROM public.organizations o
     WHERE o.id = m.org_id AND o.deleted_at IS NULL;

  PERFORM set_config('amber.bootstrap', '', true);
  PERFORM set_config('amber.bootstrap_org', '', true);
END $$;

-- ---------------------------------------------------------------------------
-- Invitations: the token hash is the subject, and it is also the secret.
-- ---------------------------------------------------------------------------

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
DECLARE v record;
BEGIN
  PERFORM set_config('amber.bootstrap', encode(p_token_hash, 'hex'), true);

  SELECT * INTO v
    FROM public.org_invites i
   WHERE i.token_hash = p_token_hash
     AND i.accepted_at IS NULL
     AND i.revoked_at IS NULL
     AND i.expires_at > now()
   LIMIT 1;

  IF v IS NULL THEN
    PERFORM set_config('amber.bootstrap', '', true);
    RETURN;
  END IF;

  PERFORM set_config('amber.bootstrap_org', v.org_id::text, true);

  RETURN QUERY
    SELECT v.id, v.org_id, v.email, v.role, v.group_id, v.expires_at, v.invited_by,
           o.name, o.slug
      FROM public.organizations o
     WHERE o.id = v.org_id AND o.deleted_at IS NULL;

  PERFORM set_config('amber.bootstrap', '', true);
  PERFORM set_config('amber.bootstrap_org', '', true);
END $$;

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
  PERFORM set_config('amber.bootstrap', encode(p_token_hash, 'hex'), true);

  -- Still one UPDATE, so two people racing the same link produce exactly one
  -- winner and the loser is told the invitation is no longer valid.
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

-- ---------------------------------------------------------------------------
-- API keys: the hash is the subject. A key that does not exist reads nothing
-- rather than reading the key table.
-- ---------------------------------------------------------------------------

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
DECLARE k record;
BEGIN
  PERFORM set_config('amber.bootstrap', p_key_hash, true);

  SELECT * INTO k
    FROM public.org_api_keys kk
   WHERE kk.key_hash = p_key_hash AND kk.revoked_at IS NULL
   LIMIT 1;

  IF k IS NULL THEN
    PERFORM set_config('amber.bootstrap', '', true);
    RETURN;
  END IF;

  PERFORM set_config('amber.bootstrap_org', k.org_id::text, true);

  RETURN QUERY
    SELECT k.org_id, k.id, k.name, k.scopes, o.name, o.slug
      FROM public.organizations o
     WHERE o.id = k.org_id AND o.deleted_at IS NULL;

  PERFORM set_config('amber.bootstrap', '', true);
  PERFORM set_config('amber.bootstrap_org', '', true);
END $$;

COMMIT;
