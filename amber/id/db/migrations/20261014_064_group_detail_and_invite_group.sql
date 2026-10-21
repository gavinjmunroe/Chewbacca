-- ============================================================================
-- A GROUP SOMEBODY CAN UNDERSTAND, AND AN INVITE THAT KNOWS WHERE SOMEBODY GOES.
--
-- Migration 062 gave a group a name and nothing else, which is enough for the
-- authorization predicate and not nearly enough for the person using it. Two
-- months after setup, "Sales" and "Sales 2" are indistinguishable, and the
-- question an admin actually has -- what is this group FOR, and should this
-- thing go to it -- has no answer anywhere in the schema.
--
-- `purpose` is a short line shown beside the name in a share picker. It is the
-- thing read at the moment of a decision, so it is deliberately not the long
-- description: a picker that renders a paragraph per audience is a picker
-- nobody reads.
--
-- `description` is the longer one, for the admin console, where there is room.
--
-- AND AN INVITE CAN NOW NAME A GROUP. Without it, putting a new hire on the
-- Sales team is: invite them, wait for them to accept, remember days later that
-- they exist, find them in the roster, add them. Every step after the first is
-- one somebody forgets, and the cost of forgetting is a person who cannot see
-- what their team is sharing and does not know that is why.
--
-- The composite foreign key is to (org_id, id) on org_groups, so an invite can
-- only ever point at a group in its OWN organization -- that is not a check
-- somebody has to remember to write in a route, it is a row the database will
-- not accept. ON DELETE SET NULL because deleting a group should not silently
-- revoke outstanding invitations; they just arrive without a team.
-- ============================================================================

BEGIN;

ALTER TABLE org_groups
  ADD COLUMN IF NOT EXISTS purpose     text NULL,
  ADD COLUMN IF NOT EXISTS description text NULL;

COMMENT ON COLUMN org_groups.purpose IS
  'One line, shown beside the name wherever an audience is chosen.';
COMMENT ON COLUMN org_groups.description IS
  'The longer version, for the admin console.';

ALTER TABLE org_invites
  ADD COLUMN IF NOT EXISTS group_id uuid NULL;

ALTER TABLE org_invites DROP CONSTRAINT IF EXISTS org_invites_group_fk;
ALTER TABLE org_invites ADD CONSTRAINT org_invites_group_fk
  FOREIGN KEY (org_id, group_id)
  REFERENCES org_groups (org_id, id) ON DELETE SET NULL;

COMMENT ON COLUMN org_invites.group_id IS
  'The group this person joins on acceptance. Composite FK to (org_id, id), so
   an invite can only name a group in its own organization.';

COMMIT;
