-- ============================================================================
-- WHAT A COMPANY KNOWS, AND WHO IN IT KNOWS IT.
--
-- Migrations 062 through 065 built the spine: an organization, its people, its
-- groups, and a ceiling on how far a share can travel. That is the
-- authorization half of an internal network, and on its own it is a permission
-- system with nothing to permit.
--
-- This is the other half. Three things, and they are deliberately three rather
-- than one general "content" table, because they are read in three different
-- situations and the difference is the product:
--
--   org_pages      the durable half. A runbook, a client brief, a how-we-do-it.
--                  Read by somebody who arrived looking for it, months later,
--                  usually through search. It is edited, not replied to.
--
--   org_posts      the perishable half. An update, a question, an answer.
--                  Read by somebody scrolling, today. It is replied to, not
--                  edited.
--
--   org_page_revisions  the ledger underneath the first one.
--
-- THE REVISION LEDGER IS THE WHOLE POINT, not an audit afterthought. The
-- question this product exists to answer is "who in this company knows about
-- X", and the honest answer is not a self-reported skills field, which is a
-- record of what people believe about themselves two weeks after they were
-- hired. It is: who has written and rewritten the pages about X, and who has
-- answered the questions about X. Both of those are facts the database already
-- has to store to work at all. Expertise is therefore DERIVED here and never
-- declared, which is also why there is no org_expertise table: a derived number
-- stored in a column is a number that is wrong as soon as somebody edits a
-- page, and nobody ever remembers to recompute it.
--
-- `chars_added` and `chars_removed` are on the revision rather than computed at
-- read time because the previous body is what they are computed against, and
-- reconstructing a page's whole history to render one contributor bar is a
-- query that gets slower every time somebody fixes a typo.
--
-- ATTACHMENTS ARE POINTERS, NOT BYTES. storage_key names an object in the same
-- bucket the rest of the service uses, and the row carries what has to be true
-- before the bytes arrive -- who, which page, which organization -- so an
-- upload that never completes is a row with status 'pending' rather than a file
-- nobody can account for.
--
-- EVERY TABLE CARRIES org_id AND EVERY FOREIGN KEY IS COMPOSITE. A page's
-- revisions reference (org_id, id), not id, so a revision cannot be attached to
-- a page in another organization even by a route that has a bug in it. This is
-- the same decision as migration 064's invite-to-group key, for the same
-- reason: the separation between two companies' data should be a row the
-- database refuses, not a WHERE clause somebody has to remember.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- PAGES
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS org_pages (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,

  slug        text        NOT NULL,
  title       text        NOT NULL,
  -- One line, shown in search results and in the index. Written by hand rather
  -- than cut from the body, because the first sentence of a runbook is
  -- "Prerequisites" and that tells a searcher nothing.
  summary     text        NULL,
  body        text        NOT NULL DEFAULT '',

  kind        text        NOT NULL DEFAULT 'page'
                          CHECK (kind IN ('page', 'runbook', 'brief', 'how_to', 'decision')),

  -- WHO THIS IS FOR, and it reuses the share vocabulary rather than inventing a
  -- second one. 'org' is everyone; a group_id narrows it to one team. There is
  -- deliberately no per-person page: a wiki whose pages are private to their
  -- author is a notes app with extra steps.
  group_id    uuid        NULL,

  created_by  uuid        NULL REFERENCES users (amber_id) ON DELETE SET NULL,
  updated_by  uuid        NULL REFERENCES users (amber_id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz NULL,

  UNIQUE (org_id, id),
  UNIQUE (org_id, slug)
);

ALTER TABLE org_pages DROP CONSTRAINT IF EXISTS org_pages_group_fk;
ALTER TABLE org_pages ADD CONSTRAINT org_pages_group_fk
  FOREIGN KEY (org_id, group_id)
  REFERENCES org_groups (org_id, id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS org_pages_by_org
  ON org_pages (org_id, updated_at DESC)
  WHERE archived_at IS NULL;

-- Search. A company wiki is unusable the week it passes forty pages unless the
-- index is over title, summary and body together -- the thing people remember
-- about a page is as often a phrase inside it as its name.
CREATE INDEX IF NOT EXISTS org_pages_fts
  ON org_pages
  USING gin (to_tsvector('english',
    coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(body, '')));

COMMENT ON COLUMN org_pages.group_id IS
  'Narrows the page to one team. NULL means the whole organization.';

-- ---------------------------------------------------------------------------
-- REVISIONS — the contribution ledger
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS org_page_revisions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  page_id       uuid        NOT NULL,

  author_id     uuid        NULL REFERENCES users (amber_id) ON DELETE SET NULL,

  -- The body AS OF this revision, not a diff. Storage is cheap and a chain of
  -- diffs is one corrupt row away from a page that cannot be reconstructed.
  title         text        NOT NULL,
  body          text        NOT NULL,
  -- Optional, and worth asking for: "why" is the part a diff cannot show.
  change_note   text        NULL,

  chars_added   integer     NOT NULL DEFAULT 0,
  chars_removed integer     NOT NULL DEFAULT 0,

  created_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (org_id, id)
);

ALTER TABLE org_page_revisions DROP CONSTRAINT IF EXISTS org_page_revisions_page_fk;
ALTER TABLE org_page_revisions ADD CONSTRAINT org_page_revisions_page_fk
  FOREIGN KEY (org_id, page_id)
  REFERENCES org_pages (org_id, id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS org_page_revisions_by_page
  ON org_page_revisions (org_id, page_id, created_at DESC);

-- The index that answers "what has this person contributed", which is a column
-- on their profile and the reason anybody trusts the expertise ranking.
CREATE INDEX IF NOT EXISTS org_page_revisions_by_author
  ON org_page_revisions (org_id, author_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- ATTACHMENTS — the internal drive half
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS org_page_attachments (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  page_id      uuid        NOT NULL,

  uploaded_by  uuid        NULL REFERENCES users (amber_id) ON DELETE SET NULL,

  filename     text        NOT NULL,
  content_type text        NOT NULL DEFAULT 'application/octet-stream',
  byte_size    bigint      NULL,
  storage_key  text        NOT NULL,

  -- 'pending' until the bytes land. A row written before the upload finishes is
  -- how the service knows an object it later finds in the bucket belongs to
  -- this page and this company rather than being an orphan nobody can place.
  status       text        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'ready', 'failed')),

  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz NULL,

  UNIQUE (org_id, id),
  UNIQUE (storage_key)
);

ALTER TABLE org_page_attachments DROP CONSTRAINT IF EXISTS org_page_attachments_page_fk;
ALTER TABLE org_page_attachments ADD CONSTRAINT org_page_attachments_page_fk
  FOREIGN KEY (org_id, page_id)
  REFERENCES org_pages (org_id, id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS org_page_attachments_by_page
  ON org_page_attachments (org_id, page_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- POSTS — the perishable half
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS org_posts (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,

  author_id  uuid        NULL REFERENCES users (amber_id) ON DELETE SET NULL,
  group_id   uuid        NULL,

  -- A QUESTION IS A DIFFERENT OBJECT FROM AN UPDATE, and the feed has to be
  -- able to say so: an unanswered question is the one thing in here that is
  -- worth putting in front of somebody who did not come looking for it.
  kind       text        NOT NULL DEFAULT 'update'
                         CHECK (kind IN ('update', 'question', 'answer', 'intro')),

  title      text        NULL,
  body       text        NOT NULL,

  -- Answers hang off their question. One level only: a thread four deep is a
  -- conversation that should have been a page.
  parent_id  uuid        NULL,

  -- Set on the answer the asker accepted. It is what turns a feed into an
  -- index of who actually resolved things.
  accepted_at timestamptz NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at  timestamptz NULL,
  deleted_at timestamptz NULL,

  UNIQUE (org_id, id)
);

ALTER TABLE org_posts DROP CONSTRAINT IF EXISTS org_posts_group_fk;
ALTER TABLE org_posts ADD CONSTRAINT org_posts_group_fk
  FOREIGN KEY (org_id, group_id)
  REFERENCES org_groups (org_id, id) ON DELETE SET NULL;

ALTER TABLE org_posts DROP CONSTRAINT IF EXISTS org_posts_parent_fk;
ALTER TABLE org_posts ADD CONSTRAINT org_posts_parent_fk
  FOREIGN KEY (org_id, parent_id)
  REFERENCES org_posts (org_id, id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS org_posts_feed
  ON org_posts (org_id, created_at DESC)
  WHERE deleted_at IS NULL AND parent_id IS NULL;

CREATE INDEX IF NOT EXISTS org_posts_answers
  ON org_posts (org_id, parent_id, created_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS org_posts_by_author
  ON org_posts (org_id, author_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- WHO SOMEBODY IS AT WORK
--
-- Three fields, and the restraint is the design. A directory with twenty
-- optional fields is a directory where nineteen are empty, and an empty field
-- rendered on a profile reads as an absence rather than a choice. Title and
-- team answer "should I be asking this person"; the one line answers "what do
-- they actually do", which an org chart never says.
--
-- There is no skills array here on purpose. See the header: what somebody knows
-- is derived from what they have written and answered, and a self-reported list
-- would quietly outrank it on the people page the moment it existed.
-- ---------------------------------------------------------------------------

ALTER TABLE org_members
  ADD COLUMN IF NOT EXISTS title    text NULL,
  ADD COLUMN IF NOT EXISTS location text NULL,
  ADD COLUMN IF NOT EXISTS bio      text NULL;

COMMENT ON COLUMN org_members.title IS
  'Job title as the person writes it, not a level from an HR system.';
COMMENT ON COLUMN org_members.bio IS
  'One line: what they work on. Rendered beside their name everywhere.';

COMMIT;
