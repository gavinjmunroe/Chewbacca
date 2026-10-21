-- ---------------------------------------------------------------------------
-- 087 — KEEP THE ATTENDEE'S NAME, NOT ONLY THEIR ADDRESS.
--
-- The first real backfill produced a graph whose strongest relationships read:
--
--     sagartiw@stanford.edu          6 touches
--     sagar@amberintelligence.ai     4 touches
--     sagart851@gmail.com            1 touch
--
-- Two problems in three lines, and they are the same problem.
--
-- FIRST, NOBODY IS CALLED sagartiw@stanford.edu. Google sends a displayName
-- with every attendee and the reader dropped it on the floor, keeping only
-- the address. A relationship graph whose nodes are email addresses is one
-- nobody can read, and "who do we know at this firm" cannot be answered by
-- squinting at local parts.
--
-- SECOND, AND WORSE, THOSE THREE ROWS ARE ONE PERSON. A calendar invite
-- carries one address per attendee and nothing that ties a work address to a
-- university one. The resolver behaved exactly as designed -- attach to the
-- first match, never merge, because a wrong merge rewrites who an interaction
-- happened with and that is not a call a sync job makes at 3am -- and the
-- result is still a graph with one human in it three times.
--
-- The name is what breaks that tie. It is weak evidence on its own, which is
-- why 088 uses it to SUGGEST a merge rather than to perform one, but it is
-- the only signal a calendar actually carries that spans two addresses.
--
-- SO attendees BECOMES jsonb: [{ "email": "...", "name": "..." }]. The column
-- is one day old and holds a single sync's worth of rows, so converting now
-- costs nothing and avoids a parallel names array that has to stay
-- index-aligned with the addresses forever. Future producers want more fields
-- on an attendee -- a response status, an organizer flag -- and jsonb has
-- room for them without another migration.
--
-- WHY A COLUMN SWAP RATHER THAN ALTER COLUMN ... TYPE ... USING. The obvious
-- one-liner is rejected: `cannot use subquery in transform expression`. A
-- USING clause is evaluated per row as a scalar expression and may not open a
-- subquery, and turning text[] into an array of OBJECTS needs unnest, which
-- is one. There is no array_map in Postgres to reach for instead.
--
-- So: new column, populate, drop, rename. Three statements that each do one
-- obvious thing, in a transaction, which is what the migration runner gives
-- every file anyway.
-- ---------------------------------------------------------------------------

ALTER TABLE events ADD COLUMN IF NOT EXISTS attendees_jsonb jsonb;

UPDATE events
   SET attendees_jsonb = (
     SELECT jsonb_agg(jsonb_build_object('email', a, 'name', NULL))
       FROM unnest(attendees) AS a
   )
 WHERE attendees IS NOT NULL
   AND attendees_jsonb IS NULL;

-- The index from 086 is on the old column and goes with it. Named here so
-- the recreate below is obviously the same index rather than a new one.
DROP INDEX IF EXISTS events_attendees_idx;

ALTER TABLE events DROP COLUMN attendees;
ALTER TABLE events RENAME COLUMN attendees_jsonb TO attendees;

CREATE INDEX IF NOT EXISTS events_attendees_idx
  ON events (owner_id, starts_at DESC)
  WHERE attendees IS NOT NULL AND deleted_at IS NULL;

COMMENT ON COLUMN events.attendees IS
  'The guest list as the provider gave it: [{email, name}]. Unresolved on
   purpose -- event_participants holds people we matched, this holds the raw
   input so a consumer that did not exist at sync time can resolve it later.';
