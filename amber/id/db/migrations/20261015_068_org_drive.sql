-- ============================================================================
-- A DRIVE, NOT AN ATTACHMENT LIST.
--
-- Migration 067 gave a page the ability to carry files. That is the right
-- shape for a runbook with a diagram next to it and the wrong shape for the
-- thing a company actually asks for next, which is "where do we put the
-- deck". A file that must belong to a page is a file somebody invents a page
-- for, and a wiki full of one-line pages that exist to hold a PDF is a wiki
-- nobody reads.
--
-- So page_id becomes optional and group_id arrives beside it. A file now has
-- two independent facts about it -- what it is attached to, and who it is for
-- -- and neither is required:
--
--   page + no group    a diagram on a runbook, as before
--   no page + group    the Sales team's drive
--   no page + no group the company's drive
--   page + group       filed in both places, which is one file, listed twice
--
-- TAGS ARE THE THIRD AXIS AND THE ONLY ONE THAT SCALES. A folder tree forces
-- one answer to "where does this live" and every company has at least two
-- (by client, and by kind). Tags are an array on the row rather than a join
-- table because the question asked of them is always "which files have this
-- one", a GIN index answers that directly, and a join table would be three
-- more tables to purge, migrate and explain for no read this product makes.
--
-- EXTRACTED TEXT IS WHAT MAKES THIS A DRIVE RATHER THAN A BUCKET. A file
-- nobody can search is a file nobody finds, and "search" over filenames finds
-- the one file whose name somebody remembers. The text is pulled out once, on
-- upload, and stored beside the row -- not re-derived per query, because
-- re-parsing a 40-page PDF to answer a keystroke is not a search box.
--
-- extract_status is a real column rather than an inference from a NULL,
-- because there are four different reasons the text might be missing and they
-- need different things from a person: still working, the format has no text
-- in it, it was too big to read, or the parse failed and somebody should look.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- FILES
-- ---------------------------------------------------------------------------

-- A file no longer needs a page to exist.
ALTER TABLE org_page_attachments ALTER COLUMN page_id DROP NOT NULL;

ALTER TABLE org_page_attachments
  ADD COLUMN IF NOT EXISTS group_id       uuid    NULL,
  ADD COLUMN IF NOT EXISTS tags           text[]  NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS title          text    NULL,
  ADD COLUMN IF NOT EXISTS description    text    NULL,
  ADD COLUMN IF NOT EXISTS extracted_text text    NULL,
  ADD COLUMN IF NOT EXISTS extract_status text    NOT NULL DEFAULT 'pending'
                                          CHECK (extract_status IN
                                            ('pending', 'ready', 'unsupported', 'too_large', 'failed'));

ALTER TABLE org_page_attachments DROP CONSTRAINT IF EXISTS org_page_attachments_group_fk;
ALTER TABLE org_page_attachments ADD CONSTRAINT org_page_attachments_group_fk
  FOREIGN KEY (org_id, group_id)
  REFERENCES org_groups (org_id, id) ON DELETE SET NULL;

COMMENT ON COLUMN org_page_attachments.group_id IS
  'The team this file is filed under. NULL means the whole company.';
COMMENT ON COLUMN org_page_attachments.tags IS
  'Lowercase, deduplicated. The third axis, alongside page and team.';
COMMENT ON COLUMN org_page_attachments.extracted_text IS
  'Text pulled out of the file once, on upload. What makes a drive searchable.';

CREATE INDEX IF NOT EXISTS org_page_attachments_drive
  ON org_page_attachments (org_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS org_page_attachments_by_group
  ON org_page_attachments (org_id, group_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS org_page_attachments_tags
  ON org_page_attachments USING gin (tags);

-- Filename first, because it is what people half-remember, then the contents.
CREATE INDEX IF NOT EXISTS org_page_attachments_fts
  ON org_page_attachments
  USING gin (to_tsvector('english',
    coalesce(title, '') || ' ' || coalesce(filename, '') || ' ' ||
    coalesce(description, '') || ' ' || coalesce(extracted_text, '')));

-- ---------------------------------------------------------------------------
-- PAGES GET THE SAME THIRD AXIS
--
-- Same reasoning, and the same vocabulary deliberately: a tag means the same
-- thing on a page and on a file, so one tag filter can return both. Two tag
-- namespaces that looked alike and did not match would be worse than none.
-- ---------------------------------------------------------------------------

ALTER TABLE org_pages
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS org_pages_tags
  ON org_pages USING gin (tags);

COMMIT;
