-- ============================================================================
-- THE DOOR IN AND THE DOOR OUT.
--
-- Everything this workspace knows has been reachable from exactly one place:
-- this website, signed in as a person. That is a fine way to read a feed and a
-- terrible way to onboard a company, because the first question a company with
-- work already in it asks is "how do I get it in here", and the second is "how
-- do I get it back out". A product that answers neither is a product somebody
-- types their history into by hand once and never again.
--
-- Two tables answer both.
--
--   org_api_keys   -- a credential that is the COMPANY's, not a person's.
--   org_connectors -- which of the known products this company has turned on.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- KEYS.
--
-- WHY A COMPANY KEY AND NOT A PERSONAL ONE. user_api_keys already exists and
-- is bound to one amber_id, which is right for "push my contacts into my own
-- address book" and wrong for every integration a company builds: the script
-- that syncs the CRM nightly must not stop working because the person who
-- wrote it left, and it must not be able to read that person's private
-- messages either. A company key is scoped to an org and to a verb, and it
-- outlives whoever minted it.
--
-- ONLY THE HASH IS STORED. The raw key is returned exactly once, at creation,
-- and then it does not exist anywhere we control. Same scheme as
-- user_api_keys, deliberately: one way of doing this, audited once.
--
-- SCOPES ARE A SHORT CLOSED LIST checked in SQL rather than only in the route.
-- `read` sees what the company has made company-wide; `write` can post and
-- create; `admin` can touch membership. The ladder is by blast radius -- a key
-- that can add a member to the company is categorically more dangerous than
-- one that can post a message, however routine adding a member feels.
--
-- WHAT A KEY CAN NEVER DO, enforced by construction rather than by hoping:
-- read anything addressed to a group or a person. A key has no amber_id, so
-- the audience predicate has no viewer to match and restricted work is simply
-- not in its world. An integration that could read every private channel
-- because somebody pasted a token into an automation step is the failure mode
-- this design removes rather than mitigates.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_api_keys (
  org_id       uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  name         text        NOT NULL,
  key_hash     text        NOT NULL UNIQUE,
  -- Display only, so somebody with four keys can tell which is which without
  -- the raw value they no longer have.
  key_prefix   text        NOT NULL,
  last4        text        NOT NULL,
  scopes       text[]      NOT NULL DEFAULT ARRAY['read']::text[],
  created_by   uuid        NULL REFERENCES users (amber_id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NULL,
  -- Revoked rather than deleted: "this key was used until Tuesday and then
  -- somebody killed it" is the sentence an incident review needs, and a
  -- deleted row says nothing at all.
  revoked_at   timestamptz NULL,
  revoked_by   uuid        NULL REFERENCES users (amber_id) ON DELETE SET NULL,

  PRIMARY KEY (org_id, id),

  CONSTRAINT org_api_keys_name_shape CHECK (btrim(name) <> ''),

  CONSTRAINT org_api_keys_scopes_shape
    CHECK (
      array_length(scopes, 1) >= 1
      AND scopes <@ ARRAY['read', 'write', 'admin']::text[]
    )
);

CREATE INDEX IF NOT EXISTS org_api_keys_org_idx ON org_api_keys (org_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- CONNECTORS.
--
-- A row says "this company has turned on Microsoft Copilot" and nothing more
-- interesting than that. The CATALOGUE -- which products exist, what each is
-- called, what it does, which hue its tile is -- is code, not data, because it
-- is the same for every company and a list that ships with the build cannot
-- drift out of sync with the code that knows how to talk to each product.
--
-- WHY THIS IS NOT org_connections. A connection is a URL with a name on it: a
-- bookmark, no token, no API. A connector is the company saying it intends to
-- move data through a product. They look similar on a page and are completely
-- different objects, and collapsing them would mean every bookmark somebody
-- pastes becomes a thing that claims to sync.
--
-- `config` holds NO SECRETS. Tokens belong in the existing oauth account
-- tables, which already handle refresh and revocation; a second place to keep
-- a credential is a second place to leak one. What lands here is the
-- uninteresting half: which workspace, which base URL, which default group.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_connectors (
  org_id       uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  provider     text        NOT NULL,
  -- What this company calls it. Two Salesforce orgs is a real arrangement.
  label        text        NULL,
  status       text        NOT NULL DEFAULT 'added',
  config       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Optional: a connector a single team turned on for itself.
  group_id     uuid        NULL,
  connected_by uuid        NULL REFERENCES users (amber_id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (org_id, id),

  CONSTRAINT org_connectors_group_fk
    FOREIGN KEY (org_id, group_id)
    REFERENCES org_groups (org_id, id) ON DELETE CASCADE,

  CONSTRAINT org_connectors_status_shape
    CHECK (status IN ('added', 'connected', 'error', 'paused')),

  CONSTRAINT org_connectors_provider_shape
    CHECK (btrim(provider) <> '')
);

-- One row per product per scope. Turning on Notion twice for the whole company
-- is a mis-click, not an arrangement; turning it on for two teams is.
CREATE UNIQUE INDEX IF NOT EXISTS org_connectors_unique_org_idx
  ON org_connectors (org_id, provider) WHERE group_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS org_connectors_unique_group_idx
  ON org_connectors (org_id, provider, group_id) WHERE group_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Both join the tenant policy. A table outside it is the one place a
-- cross-company read could come from -- and for a table of API credentials
-- that is not a theoretical concern.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['org_api_keys', 'org_connectors'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS amber_tenant ON %I', t);
    EXECUTE format($f$
      CREATE POLICY amber_tenant ON %I
        USING (amber_current_org() IS NOT NULL AND org_id = amber_current_org())
        WITH CHECK (amber_current_org() IS NOT NULL AND org_id = amber_current_org())
    $f$, t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- WHO WROTE THIS, WHEN THE ANSWER IS "NOTHING WHO".
--
-- A post made through the API has no author: a machine wrote it, and the two
-- available lies are both bad. Attributing it to the admin who minted the key
-- puts words in a person's mouth; inventing a synthetic user puts a row in the
-- roster that cannot sign in and that somebody will eventually try to invite
-- to a meeting.
--
-- So author_id stays NULL and `source` carries the name of the key instead,
-- which is both true and more useful: "posted by Nightly CRM sync" tells a
-- reader what to go and look at when the number is wrong.
-- ---------------------------------------------------------------------------
ALTER TABLE org_posts ADD COLUMN IF NOT EXISTS source text NULL;

-- ---------------------------------------------------------------------------
-- THE SECOND BOOTSTRAP READ, FOR THE SAME REASON AS THE FIRST.
--
-- A machine request arrives carrying a key and nothing else. We cannot set the
-- tenant before we know the org, and we cannot learn the org without reading
-- the key row -- which the tenant policy forbids, because no tenant is set.
-- Identical chicken-and-egg to amber_membership_bootstrap, identical answer,
-- and the same discipline keeping it pointed down:
--
--   - one argument, which is a SHA-256 hash the caller must already possess;
--   - one row out, no listing, no wildcard, no LIKE, no OR;
--   - it returns no secret -- the hash went in, so the caller had it already;
--   - search_path pinned, so org_api_keys cannot be shadowed by a caller's
--     own table and read by the definer instead;
--   - revoked keys are filtered HERE, inside the definer, so a route that
--     forgets to check still cannot authenticate a revoked key.
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
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT k.org_id, k.id, k.name, k.scopes, o.name, o.slug
    FROM public.org_api_keys k
    JOIN public.organizations o ON o.id = k.org_id AND o.deleted_at IS NULL
   WHERE k.key_hash = p_key_hash
     AND k.revoked_at IS NULL
   LIMIT 1;
$$;

COMMENT ON FUNCTION amber_api_key_bootstrap(text) IS
  'The read that discovers which tenant a machine request belongs to. One hash
   in, one key row out, revoked keys already excluded.';

DO $$
BEGIN
  EXECUTE format(
    'GRANT EXECUTE ON FUNCTION amber_api_key_bootstrap(text) TO %I',
    current_user
  );
END $$;
