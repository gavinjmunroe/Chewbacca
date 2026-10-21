-- ---------------------------------------------------------------------------
-- 086 — KEEP THE ATTENDEE LIST THE CALENDAR ALREADY GAVE US.
--
-- THE BUG, which is a product failure rather than a defect:
--
-- A calendar invite arrives from Google carrying every attendee's address.
-- The sync matches those addresses against `contacts` and stores the matches.
-- Addresses that match nobody are discarded, and the raw list is never
-- written down.
--
-- On iOS that is correct. Somebody imports their phone's address book on day
-- one, so by the time a calendar connects there is something to match
-- against, and the calendar's job is to ENRICH contacts that already exist.
--
-- On the web there is no address book. Nobody uploads a vCard to a work
-- account. So a new member connects their calendar, the sync runs
-- successfully, every attendee matches nothing, and they are shown an empty
-- graph by a system that just read two years of their meetings. That is the
-- exact cold start this product is supposed to not have, arriving through
-- the one feature meant to prevent it.
--
-- The calendar IS the address book here. So the addresses get kept, and the
-- company-side producer resolves them against org_people directly rather
-- than through a personal contact card that was never going to exist.
--
-- WHY A COLUMN RATHER THAN A TABLE. event_participants already exists and is
-- the right shape for RESOLVED people. This is the opposite: the unresolved
-- input, kept so resolution can be re-run later by a consumer that did not
-- exist when the sync ran -- which is precisely what happened here. A text[]
-- on the event is the smallest thing that makes the raw signal recoverable,
-- and it costs one array per row.
--
-- NOT BACKFILLABLE. Events already synced have lost their attendees for good;
-- the only way back is a re-sync, which is cheap and idempotent. New rows
-- carry it from here.
-- ---------------------------------------------------------------------------

ALTER TABLE events ADD COLUMN IF NOT EXISTS attendees text[];

-- The organizer is not just another attendee: on a one-to-one it is the
-- difference between a meeting somebody called and one they were summoned to,
-- which is a real signal about who is pursuing whom.
ALTER TABLE events ADD COLUMN IF NOT EXISTS organizer text;

-- The company-side producer's read: this owner's past meetings that have any
-- attendee at all. Partial, because an event with no attendees is a personal
-- reminder and will never produce a relationship.
CREATE INDEX IF NOT EXISTS events_attendees_idx
  ON events (owner_id, starts_at DESC)
  WHERE attendees IS NOT NULL AND deleted_at IS NULL;
