-- Per-viewer "opened" state for inbound circles (circles someone else added you
-- to). Drives the one-time "you were added to this circle" banner and the "new"
-- marker on the circle card in Ask: both clear once the viewer opens the circle.
--
-- The app resolves inbound membership at read time (contacts.linked_amber_id or a
-- matching contact_identity_keys phone), so there is nothing to backfill here —
-- this table only records which inbound circles a given viewer has already seen.
--
-- Idempotent. Safe to run against prod. Until 2026-08-26 this table was ALSO
-- created at request time in two places (circles-store.js and, separately,
-- inside markCircleFeedSeen in note-shares-store.js). Both are gone; this file
-- is now the only definition.

CREATE TABLE IF NOT EXISTS circle_member_seen (
  viewer_amber_id uuid        NOT NULL,
  circle_id       bigint      NOT NULL,
  seen_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (viewer_amber_id, circle_id)
);
