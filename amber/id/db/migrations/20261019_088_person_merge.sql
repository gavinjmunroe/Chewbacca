-- ---------------------------------------------------------------------------
-- 088 — ONE HUMAN, THREE ADDRESSES, ONE NODE.
--
-- The first real backfill produced this, and it is the failure mode that
-- decides whether any of this is a product:
--
--     sagartiw@stanford.edu          6 touches
--     sagar@amberintelligence.ai     4 touches
--     sagart851@gmail.com            1 touch
--
-- One person. A calendar invite carries one address per attendee and nothing
-- that ties a work address to a university one, so no amount of care at write
-- time can join them. The resolver was right to refuse: merging on a name at
-- 3am would eventually put one customer's private conversation onto another
-- customer's record, and that is the worst thing this system can do.
--
-- So the join happens later, deliberately, and this is the schema for it.
--
-- A POINTER, NOT A REWRITE. merged_into names the surviving person. The
-- losing row stays exactly where it is and so does every interaction that
-- points at it: the ledger is append-only and a merge must not rewrite who an
-- interaction happened with. Reads resolve through the pointer, so the three
-- rows above become one node with eleven touches without a single historical
-- row changing.
--
-- That is also what makes a merge REVERSIBLE. Somebody will merge two real
-- people who happen to share a name, notice, and need it undone. With a
-- pointer, undo is setting one column back to NULL. With a rewrite, undo is
-- impossible, and "are you sure" is doing all the work -- which it never
-- does.
--
-- CHAINS ARE FORBIDDEN rather than resolved. A merged into B and B into C is
-- a graph read that needs recursion, and the day somebody makes a cycle every
-- read of the table hangs. The constraint below keeps the survivor unmerged,
-- so resolution is always exactly one hop.
-- ---------------------------------------------------------------------------

ALTER TABLE org_people ADD COLUMN IF NOT EXISTS merged_into uuid NULL;
ALTER TABLE org_people ADD COLUMN IF NOT EXISTS merged_at   timestamptz NULL;

-- Who pressed the button. The first question about a wrong merge.
ALTER TABLE org_people ADD COLUMN IF NOT EXISTS merged_by   uuid NULL
  REFERENCES users (amber_id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'org_people_merged_into_fk'
  ) THEN
    ALTER TABLE org_people
      ADD CONSTRAINT org_people_merged_into_fk
      FOREIGN KEY (org_id, merged_into)
      REFERENCES org_people (org_id, id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'org_people_merged_not_self'
  ) THEN
    -- A row merged into itself is a node that disappears from every list and
    -- cannot be recovered through the UI, because it is simultaneously the
    -- survivor and the merged-away.
    ALTER TABLE org_people
      ADD CONSTRAINT org_people_merged_not_self
      CHECK (merged_into IS NULL OR merged_into <> id);
  END IF;
END $$;

-- The hot read is "everybody who is still their own node", so the index is on
-- the survivors rather than on the merged.
CREATE INDEX IF NOT EXISTS org_people_merged_idx
  ON org_people (org_id, merged_into)
  WHERE merged_into IS NOT NULL;

-- ---------------------------------------------------------------------------
-- NO CHAINS.
--
-- Enforced with a trigger rather than a CHECK, because a CHECK cannot see
-- another row. Two rules, both cheap:
--
--   you may not merge into somebody who is themselves merged, and
--   you may not merge away somebody who is already a survivor.
--
-- Together they keep resolution to exactly one hop, forever, which is what
-- lets every read be a LEFT JOIN rather than a recursive CTE.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION amber_person_merge_is_flat() RETURNS trigger AS $$
BEGIN
  IF NEW.merged_into IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM org_people t
     WHERE t.org_id = NEW.org_id AND t.id = NEW.merged_into
       AND t.merged_into IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'cannot merge into a person who is already merged (would create a chain)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM org_people c
     WHERE c.org_id = NEW.org_id AND c.merged_into = NEW.id
  ) THEN
    RAISE EXCEPTION
      'cannot merge away a person others are merged into (unmerge them first)';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS amber_person_merge_flat ON org_people;
CREATE TRIGGER amber_person_merge_flat
  BEFORE INSERT OR UPDATE OF merged_into ON org_people
  FOR EACH ROW EXECUTE FUNCTION amber_person_merge_is_flat();
