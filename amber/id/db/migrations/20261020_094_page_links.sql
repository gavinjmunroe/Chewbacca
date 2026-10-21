-- ---------------------------------------------------------------------------
-- A PIECE OF WORK, ON A LINK, FOR SOMEBODY WHO DOES NOT WORK HERE.
--
-- WHY THIS EXISTS. An artifact built in a circle is a thing that RUNS, and
-- the moment it is any good somebody wants to send it to a customer, a
-- candidate or an investor -- none of whom have an account and none of whom
-- should need one to look at a page.
--
-- A TOKEN IS THE WHOLE PERMISSION, AND THAT IS SAID OUT LOUD RATHER THAN
-- implied. Anybody holding the link can open it, which is what a link is;
-- the honesty is in the product saying so at the moment somebody creates one
-- and in revoking being one press. There is no "anyone at the company with
-- the link" middle state, because that is a promise a URL cannot keep.
--
-- WHAT IS NOT HERE: the content. A link points at a page that already
-- exists, so revoking the link is sufficient and nothing has to be kept in
-- sync. Deleting the page takes its links with it.
--
-- SAFE TO RE-RUN.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS org_page_links (
  org_id     uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  id         uuid        NOT NULL DEFAULT gen_random_uuid(),

  page_id    uuid        NOT NULL,

  -- The secret in the URL. Long enough that guessing is not a strategy, and
  -- stored as it is sent: it is a bearer token for ONE public page and
  -- hashing it would mean no way to list somebody's own links back to them.
  token      text        NOT NULL,

  created_by uuid        NULL REFERENCES users (amber_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Set when somebody turns it off. Kept rather than deleted so a link that
  -- stops working can say it was revoked instead of 404ing like a typo.
  revoked_at timestamptz NULL,

  -- Cheap evidence that a link is being used, which is the thing people
  -- actually want to know before they revoke one.
  views      integer     NOT NULL DEFAULT 0,
  last_seen  timestamptz NULL,

  PRIMARY KEY (org_id, id),

  CONSTRAINT org_page_links_page_fk
    FOREIGN KEY (org_id, page_id) REFERENCES org_pages (org_id, id) ON DELETE CASCADE,

  CONSTRAINT org_page_links_token_shape CHECK (length(token) >= 32)
);

-- The lookup every public hit makes, and the uniqueness that makes a token a
-- token. Global rather than per-org: the request arrives with nothing but the
-- token, so it has to identify the org by itself.
CREATE UNIQUE INDEX IF NOT EXISTS org_page_links_token_idx
  ON org_page_links (token);

CREATE INDEX IF NOT EXISTS org_page_links_page_idx
  ON org_page_links (org_id, page_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- THE TENANT POLICY, AND THE ONE NARROW HOLE A PUBLIC LINK NEEDS.
--
-- Members reach these rows the way they reach every other org row: the
-- tenant is set, and the policy admits that org.
--
-- A PUBLIC HIT HAS NO TENANT AND CANNOT HAVE ONE -- the request arrives with
-- nothing but a token in a URL, which is the entire point. So it uses the
-- same shape as amber_bootstrap: a transaction-local setting naming exactly
-- one row, and a SELECT policy that admits the row matching it and nothing
-- else. Raising the flag reads ONE link and the ONE page it points at; it
-- does not open a table.
--
-- The flag is transaction-local (set_config(..., true)), so it dies with the
-- transaction and cannot leak onto the next request sharing a pooled
-- connection.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION amber_link_token() RETURNS text AS $$
  SELECT NULLIF(current_setting('amber.link_token', true), '');
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION amber_link_token() IS
  'The single share token a public request is asking about. The policies
   below admit the link row carrying it and the one page that link points
   at, and nothing else.';

ALTER TABLE org_page_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS amber_tenant ON org_page_links;
CREATE POLICY amber_tenant ON org_page_links
  USING (amber_current_org() IS NOT NULL AND org_id = amber_current_org())
  WITH CHECK (amber_current_org() IS NOT NULL AND org_id = amber_current_org());

-- Permissive policies combine with OR, so this adds the public hit without
-- touching what a member can do.
DROP POLICY IF EXISTS amber_public_link ON org_page_links;
CREATE POLICY amber_public_link ON org_page_links
  USING (token = amber_link_token() AND revoked_at IS NULL)
  WITH CHECK (token = amber_link_token() AND revoked_at IS NULL);

-- And the page itself. USING rather than a join in the route, because a
-- policy is the only place this is enforced for everybody: a second reader
-- written next year inherits it without knowing it exists.
DROP POLICY IF EXISTS amber_public_link ON org_pages;
CREATE POLICY amber_public_link ON org_pages FOR SELECT
  USING (
    amber_link_token() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM org_page_links l
       WHERE l.org_id = org_pages.org_id
         AND l.page_id = org_pages.id
         AND l.token = amber_link_token()
         AND l.revoked_at IS NULL
    )
  );
