-- ============================================================================
-- THE ORDER TEAMS ARE IN, AND WHICH ONES SIT AT THE TOP.
--
-- A list of groups has had exactly one order since it existed: alphabetical.
-- That is the right default and the wrong permanent arrangement, because the
-- order people want is the order they work in -- the channel they are in all
-- day first, the one they check on Fridays last -- and no property of the
-- data can predict that. It is a preference, so it has to be stored.
--
-- `sort_order` IS THE COMPANY'S, NOT THE VIEWER'S, and that is a real choice
-- with a cost. Per-person ordering is what a chat app does and it would need
-- a row per person per group; one shared order is a single integer and means
-- somebody dragging Engineering to the top does it for everybody. For a
-- company arranging its own teams that is defensible -- the arrangement IS
-- company information, the same argument the canvas positions are stored
-- under -- and if it turns out people want their own, this column stays and
-- a per-person override table sits beside it.
--
-- `pinned_at` is separate from sort_order rather than a reserved range of it,
-- because they answer different questions. Order is "where does this sit";
-- pinned is "this one stays visible whatever else happens". Encoding the
-- second as a magic value of the first is the kind of cleverness that breaks
-- the moment somebody pins two things.
-- ============================================================================

ALTER TABLE org_groups ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0;
ALTER TABLE org_groups ADD COLUMN IF NOT EXISTS pinned_at timestamptz NULL;

-- ---------------------------------------------------------------------------
-- SEED THE ORDER FROM THE ORDER PEOPLE ALREADY SEE.
--
-- Defaulting every row to 0 would be a tie across the whole table, and a tie
-- is resolved by whatever the planner feels like -- so the first render after
-- this migration would scramble a list that had been stable for weeks, which
-- is a worse first impression than any arrangement. Numbering them by their
-- current alphabetical position means nothing moves until somebody moves it.
--
-- Gaps of ten, so an insert between two neighbours does not have to renumber
-- the whole list on its first drag.
-- ---------------------------------------------------------------------------
WITH ordered AS (
  SELECT org_id, id,
         row_number() OVER (PARTITION BY org_id ORDER BY lower(name)) * 10 AS n
    FROM org_groups
   WHERE deleted_at IS NULL
)
UPDATE org_groups g
   SET sort_order = ordered.n
  FROM ordered
 WHERE g.org_id = ordered.org_id
   AND g.id = ordered.id
   AND g.sort_order = 0;

-- The list reads pinned first, then by hand order, then by name.
CREATE INDEX IF NOT EXISTS org_groups_order_idx
  ON org_groups (org_id, pinned_at DESC NULLS LAST, sort_order)
  WHERE deleted_at IS NULL;
