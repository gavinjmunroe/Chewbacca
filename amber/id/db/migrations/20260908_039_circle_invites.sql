-- BEING PUT IN SOMEBODY'S CIRCLE IS AN INVITATION, NOT A FACT ABOUT YOU.
--
-- "I'm right now creating a bunch of circles without Amber users, basically
--  meaning a bunch of contacts that don't have Amber yet. Those should be
--  resolved the second those people sign up for Amber with their phone number or
--  email... They should be notified that they are in the circle and be asked to
--  accept if they want to join the circle."
--
-- Resolution already happens: a contact card carrying a phone the new account
-- proves it owns gets linked at signup, and the inbound-circle predicate then
-- matches. What has never existed is the other half -- nobody was told, and
-- nobody was asked. A circle simply appeared in their app, created by someone
-- else, containing people they may not know.
--
-- This table is the asking. One row per (circle, viewer):
--
--   pending    they have been put in it and have not answered
--   accepted   they are in it, by their own say-so
--   declined   they said no; the inbound list stops showing it
--
-- WHY A MISSING ROW MEANS ACCEPTED. Everyone already in a circle today has no
-- row here, and asking them to re-consent to a circle they have been reading for
-- weeks would be a regression dressed as a feature. So absence is grandfathered:
-- the reads treat "no row" as accepted, and rows are only created at the moments
-- we know about -- an Amber user being added to a circle, and a new account's
-- first look at what is waiting for it. When rows are materialised for an
-- existing member, a circle they have already OPENED (circle_member_seen) is
-- seeded 'accepted' rather than 'pending', because someone who has been living
-- in a circle has answered the question with their feet.
--
-- WHY DECLINING IS NOT THE SAME AS LEAVING, quite. Leaving deletes the
-- circle_members rows, and the owner can add you again tomorrow. A declined row
-- survives that, so the answer is remembered: the inbound list keeps it hidden
-- instead of re-offering the same circle every time the owner re-syncs their
-- address book. Both happen together on a decline; this is the memory of it.
--
-- NOT AN ACCESS CONTROL. Note-share reach and DM routing resolve circle
-- membership through circle_members and linked_amber_id, and they are untouched:
-- this table decides what the INBOUND CIRCLES LIST shows and what it asks, and
-- nothing else. Making acceptance a precondition for reach is a much larger
-- change to who can see what, and it is not what was asked for.

CREATE TABLE IF NOT EXISTS circle_invites (
  circle_id       uuid        NOT NULL REFERENCES circles (id)      ON DELETE CASCADE,
  viewer_amber_id uuid        NOT NULL REFERENCES users   (amber_id) ON DELETE CASCADE,
  status          text        NOT NULL DEFAULT 'pending',
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- When they answered. NULL while pending.
  responded_at    timestamptz,
  -- When they were told. NULL means the push has not gone out, which is how the
  -- notifier knows not to tell somebody twice about the same circle.
  notified_at     timestamptz,
  PRIMARY KEY (circle_id, viewer_amber_id),
  CONSTRAINT circle_invites_status_chk
    CHECK (status IN ('pending', 'accepted', 'declined'))
);

-- "What is waiting for me?" and "what have I turned down?" -- both are per-viewer
-- lookups over a handful of rows, and both run on every load of the Circles tab.
CREATE INDEX IF NOT EXISTS circle_invites_viewer_idx
  ON circle_invites (viewer_amber_id, status);

-- "Who have I not told yet?", for the signup sweep.
CREATE INDEX IF NOT EXISTS circle_invites_unnotified_idx
  ON circle_invites (viewer_amber_id)
  WHERE notified_at IS NULL;
