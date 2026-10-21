-- ============================================================================
-- ACCEPTING AN INVITATION HAPPENS BEFORE THERE IS A TENANT TO SET.
--
-- Migration 071 broke one chicken-and-egg: getMembership is the read that
-- DISCOVERS which company a signed-in caller is in, so it cannot be inside a
-- tenant scope. There are two more, and they are the entire invite flow:
--
--   peekInvite(token)    "which company is this link for, and for whom"
--   acceptInvite(token)  claims the invitation and enrolls the person
--
-- Both are UNAUTHENTICATED BY DESIGN. The person holding the link has no
-- session, no account yet in most cases, and certainly no membership -- so
-- nothing upstream can resolve an actor and no tenant scope is opened. Both
-- read org_invites, which has a policy on it. Under enforcement they return
-- zero rows, so the preview says "that invitation is no longer valid" and
-- accepting fails the same way. Nobody could ever join a company.
--
-- WHAT MAKES RUNNING THESE OUTSIDE THE POLICY SAFE IS THE SAME ARGUMENT AS
-- 071, AND IT IS STRONGER HERE: the key is a 32-byte random token that only
-- the recipient has, and the function cannot be asked anything else. It takes
-- a hash, returns at most one row, and has no wildcard, no LIKE, no OR. A
-- caller who does not have the token learns nothing; a caller who does is the
-- person the invitation was addressed to.
--
-- The claim is one statement, so it is atomic without a transaction of its
-- own: two people racing the same link produce one winner and one
-- "invalid_invite", which is correct and is the behavior the UPDATE ...
-- RETURNING already had.
--
-- THE PARAMETER IS bytea, NOT text, and the first version of this file got
-- that wrong and failed to apply with "operator does not exist: bytea = text".
-- token_hash is 32 raw bytes with a CHECK on its octet_length; hashToken()
-- returns a Buffer. The bare queries this replaces worked because pg infers a
-- parameter's type from the column it is compared against -- a function
-- signature declares the type up front instead, so it has to be the right one.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- LOOK, WITHOUT CLAIMING
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
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT i.id, i.org_id, i.email, i.role, i.group_id, i.expires_at, i.invited_by,
         o.name, o.slug
    FROM public.org_invites i
    JOIN public.organizations o ON o.id = i.org_id AND o.deleted_at IS NULL
   WHERE i.token_hash = p_token_hash
     AND i.accepted_at IS NULL
     AND i.revoked_at IS NULL
     AND i.expires_at > now()
   LIMIT 1;
$$;

COMMENT ON FUNCTION amber_invite_peek(bytea) IS
  'Read one unclaimed invitation by the hash of its token. Runs outside the
   tenant policies because the caller has no session yet; the token is the
   authorization, and nothing else can be asked of this function.';

-- ---------------------------------------------------------------------------
-- CLAIM IT, ONCE
--
-- VOLATILE and a single UPDATE, so two people racing the same link produce
-- exactly one winner. The losing caller gets no row and the route says the
-- invitation is no longer valid, which is true.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION amber_invite_claim(p_token_hash bytea)
RETURNS TABLE (
  id         uuid,
  org_id     uuid,
  email      text,
  role       text,
  group_id   uuid,
  invited_by uuid
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE public.org_invites
     SET accepted_at = now()
   WHERE token_hash = p_token_hash
     AND accepted_at IS NULL
     AND revoked_at IS NULL
     AND expires_at > now()
  RETURNING id, org_id, email, role, group_id, invited_by;
$$;

COMMENT ON FUNCTION amber_invite_claim(bytea) IS
  'Claim one invitation by the hash of its token, atomically. The caller then
   sets amber.org_id from the returned org_id for the enrollment writes that
   follow -- see acceptInvite.';

DO $$
BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION amber_invite_peek(bytea) TO %I', current_user);
  EXECUTE format('GRANT EXECUTE ON FUNCTION amber_invite_claim(bytea) TO %I', current_user);
END $$;

COMMIT;
