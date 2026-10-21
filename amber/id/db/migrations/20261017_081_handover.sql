-- ============================================================================
-- A PLACE TO HAND OVER A PIECE OF WORK.
--
-- The wiki has five kinds of page -- page, runbook, brief, how_to, decision --
-- and every one of them is a finished thing written for a reader who will
-- arrive later. None of them is the shape of what people actually need to
-- pass to each other now, which is the state of a piece of work IN PROGRESS:
-- what we are trying to do, what we have tried, what is decided, what is
-- still open, and the links and files you need to carry on.
--
-- That shape has a name in practice. It is the context somebody has built up
-- working with an assistant on a problem for a week, and today it lives in
-- one person's chat history where nobody else can reach it. When they go on
-- holiday it goes with them.
--
-- `handover` is that kind. Structurally it is a page -- same table, same
-- audience rules, same revisions, same search -- because it IS a page, and a
-- second table would mean a second search, a second permissions path, and one
-- of the two forgotten. What makes it different is the prompts the editor
-- puts in front of somebody, and a status that says whether the thing is
-- still moving.
--
-- STATUS IS ON THE PAGE RATHER THAN IN THE BODY because "which of these is
-- still live" is the question somebody scanning this list has, and a list
-- cannot answer it from prose.
-- ============================================================================

ALTER TABLE org_pages DROP CONSTRAINT IF EXISTS org_pages_kind_check;
ALTER TABLE org_pages ADD CONSTRAINT org_pages_kind_check
  CHECK (kind IN ('page', 'runbook', 'brief', 'how_to', 'decision', 'handover'));

-- ---------------------------------------------------------------------------
-- WHERE A PIECE OF WORK HAS GOT TO.
--
-- NULL for every page that is not a handover, which is why this is a nullable
-- column rather than a NOT NULL with a default: a runbook is not "active",
-- and giving it a status would put a meaningless word on every row in the
-- wiki.
--
-- The three values are the three states anybody actually reports. "Blocked"
-- is deliberately present and deliberately not a synonym for paused: a
-- blocked piece of work is waiting on somebody, and that is the one state
-- worth putting in front of a person who did not come looking.
-- ---------------------------------------------------------------------------
ALTER TABLE org_pages ADD COLUMN IF NOT EXISTS work_status text NULL;

ALTER TABLE org_pages DROP CONSTRAINT IF EXISTS org_pages_work_status_check;
ALTER TABLE org_pages ADD CONSTRAINT org_pages_work_status_check
  CHECK (work_status IS NULL OR work_status IN ('active', 'blocked', 'done'));

-- ---------------------------------------------------------------------------
-- WHOSE IT IS NOW.
--
-- Not the author -- the author wrote it, which the revision ledger already
-- records. This is who to ask, and it is the single most useful field on a
-- handover: a document explaining a half-finished piece of work with no name
-- attached is a document nobody picks up, because picking it up means first
-- working out whom to interrupt.
--
-- ON DELETE SET NULL, like every other person reference on a company page:
-- somebody leaving does not delete the company's work, it just means the
-- handover now has no owner, which is true and worth seeing.
-- ---------------------------------------------------------------------------
ALTER TABLE org_pages ADD COLUMN IF NOT EXISTS owner_id uuid NULL
  REFERENCES users (amber_id) ON DELETE SET NULL;

-- Scanning "what is live and who has it" is the whole use of this list.
--
-- archived_at, NOT deleted_at. org_pages retires a page by archiving it;
-- the attachments and posts beside it in the same migration use deleted_at,
-- and reaching for the more common name here is what made the first attempt
-- at this file fail. Worth knowing when writing the next one: the soft-delete
-- column in this schema is per table, not a convention.
CREATE INDEX IF NOT EXISTS org_pages_handover_idx
  ON org_pages (org_id, work_status, updated_at DESC)
  WHERE kind = 'handover' AND archived_at IS NULL;
