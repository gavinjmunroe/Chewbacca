-- ============================================================================
-- WHO CAN SEE THIS. AUDIENCES FOR FILES, PAGES AND POSTS.
--
-- Until now a file, a page or a post carried one `group_id`, and that column
-- did two incompatible jobs at once: it said where the thing was FILED, and
-- the read paths quietly treated it as who the thing was FOR. It was never
-- enforced -- listFiles with no group filter returned every file in the
-- company to anybody who asked -- and it could only ever name one group.
--
-- The model the company actually needs is three kinds of audience:
--
--   the whole company
--   one named group, and there may be several
--   one named person, and there may be several
--
-- "Everybody" is said ONCE, by the `visibility` column, and never as a row in
-- this table -- two spellings of the same audience is exactly the ambiguity
-- that produces a read path agreeing with itself and disagreeing with the UI.
-- A row here always names somebody: a group or a person. "The founding team
-- and Maya" is one restricted item with two rows.
--
-- TWO COLUMNS, NOT ONE TABLE.
--
-- `visibility` lives on the item itself and is the hot path: the overwhelming
-- majority of what a company writes is for the whole company, and that case
-- has to be a column comparison rather than a subquery against a growing
-- table. A restricted item -- and only a restricted item -- has rows in
-- org_audiences.
--
-- WHAT THIS DELIBERATELY DOES NOT DO: there is no admin override. An owner can
-- see what is addressed to them and what is addressed to everybody, and that
-- is all. A role that silently reads every private share is not a permission
-- model, it is the absence of one.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The audience rows.
--
-- `kind` says which table `ref` points at, and `ref` is always required.
--
-- There are deliberately no foreign keys from (org_id, ref) to org_groups or
-- org_members, because ref points at two different tables depending on kind
-- and no single constraint can say that. The read path joins through live
-- membership instead, so a row naming a deleted group or a departed person
-- grants nothing: it stops matching the moment the membership does.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_audiences (
  org_id     uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  item_type  text        NOT NULL,
  item_id    uuid        NOT NULL,
  kind       text        NOT NULL,
  ref        uuid        NOT NULL,
  created_by uuid        NULL REFERENCES users (amber_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT org_audiences_item_type_shape
    CHECK (item_type IN ('file', 'page', 'post')),

  CONSTRAINT org_audiences_kind_shape
    CHECK (kind IN ('group', 'person')),

  CONSTRAINT org_audiences_ref_shape
    CHECK (ref IS NOT NULL)
);

-- One row per (item, kind, ref). Sharing with the same group twice is one share.
CREATE UNIQUE INDEX IF NOT EXISTS org_audiences_unique
  ON org_audiences (org_id, item_type, item_id, kind, ref);

-- The read direction: "everything shared with these refs". The leading
-- (org_id, kind, ref) matches how the predicate probes it.
CREATE INDEX IF NOT EXISTS org_audiences_ref_idx
  ON org_audiences (org_id, kind, ref, item_type);

-- The write/display direction: "who is this item shared with".
CREATE INDEX IF NOT EXISTS org_audiences_item_idx
  ON org_audiences (org_id, item_type, item_id);

-- ---------------------------------------------------------------------------
-- The hot-path column, on all three item tables.
--
-- 'org' is the default and the backfill value, which is what every existing
-- row already behaved as. Nothing becomes more private as a result of this
-- migration; things only become capable of being private.
-- ---------------------------------------------------------------------------
ALTER TABLE org_page_attachments
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'org';
ALTER TABLE org_pages
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'org';
ALTER TABLE org_posts
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'org';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['org_page_attachments', 'org_pages', 'org_posts'] LOOP
    EXECUTE format(
      'ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_visibility_shape');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (visibility IN (''org'', ''restricted''))',
      t, t || '_visibility_shape');
  END LOOP;
END $$;

-- Partial indexes on the restricted rows only. The whole point of the column
-- is that the common value is not worth indexing.
CREATE INDEX IF NOT EXISTS org_page_attachments_restricted_idx
  ON org_page_attachments (org_id, id) WHERE visibility = 'restricted';
CREATE INDEX IF NOT EXISTS org_pages_restricted_idx
  ON org_pages (org_id, id) WHERE visibility = 'restricted';
CREATE INDEX IF NOT EXISTS org_posts_restricted_idx
  ON org_posts (org_id, id) WHERE visibility = 'restricted';

-- ---------------------------------------------------------------------------
-- WHY THERE IS NO "RESTRICTED ITEMS MUST HAVE AN AUDIENCE" CONSTRAINT.
--
-- The obvious guard here is a deferred constraint trigger refusing to leave an
-- item marked 'restricted' with no audience rows, on the grounds that such an
-- item is addressed to nobody. It was written, and then removed, because it is
-- not true and it deadlocks the account purge.
--
-- It is not true because the AUTHOR is always in the audience and is never
-- stored as a row. A restricted item with zero rows is readable by exactly one
-- person -- the person who made it -- which is a perfectly coherent state and
-- the natural end state of the case below.
--
-- It deadlocks the purge because deleting an account deletes the audience rows
-- that name it, and an item shared with only that person would then have none.
-- A trigger would abort the whole deletion -- "delete my account" failing
-- because somebody once shared a file with you is not a trade worth making, and
-- the alternative (silently widening the item to the whole company on their way
-- out) is strictly worse.
--
-- The thing the trigger was actually guarding against -- a share sheet that
-- submits "nobody" -- is rejected in normalizeAudience(), at the only door
-- audiences are written through.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- BACKFILL: the single group_id becomes an audience row, and the item stays
-- visible to the whole company.
--
-- This is the conservative direction on purpose. Those group_ids were filing,
-- not permission -- every member of the company could already see them -- and
-- a migration that silently hid existing files from the people who have been
-- reading them for weeks would be a data-loss bug wearing a security hat.
-- They keep visibility = 'org'; the new rows just record where they are filed
-- so the group pages have something to list.
-- ---------------------------------------------------------------------------
INSERT INTO org_audiences (org_id, item_type, item_id, kind, ref)
SELECT org_id, 'file', id, 'group', group_id
  FROM org_page_attachments
 WHERE group_id IS NOT NULL AND deleted_at IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO org_audiences (org_id, item_type, item_id, kind, ref)
SELECT org_id, 'page', id, 'group', group_id
  FROM org_pages
 WHERE group_id IS NOT NULL AND archived_at IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO org_audiences (org_id, item_type, item_id, kind, ref)
SELECT org_id, 'post', id, 'group', group_id
  FROM org_posts
 WHERE group_id IS NOT NULL AND deleted_at IS NULL
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- The new table joins the tenant policy. Without this it is the one org table
-- with no policy on it -- and it is the table that decides who sees what.
-- ---------------------------------------------------------------------------
ALTER TABLE org_audiences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS amber_tenant ON org_audiences;
CREATE POLICY amber_tenant ON org_audiences
  USING (amber_current_org() IS NOT NULL AND org_id = amber_current_org())
  WITH CHECK (amber_current_org() IS NOT NULL AND org_id = amber_current_org());
