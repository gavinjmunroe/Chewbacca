-- EVENTS AND REMINDERS GET THE FIELDS A PERSON ACTUALLY EDITS.
--
-- "How often it repeats (the frequency), if the reminder involves someone, if
--  there's a description to the reminder, if the reminder involves a location,
--  if the reminder should stop on a certain day."
--
-- Both objects want the same set -- title, description, place, who it is with,
-- how it repeats, when the repeat stops, when to be notified -- and an event
-- adds the one thing a reminder by definition does not have: a time. That is
-- the whole distinction:
--
--   a stated time      -> an event, on the calendar
--   no stated time     -> a reminder, at the top of Notes & Journal
--
-- So the columns are added to both tables in one migration rather than two,
-- because they are one idea and splitting them is how the two drift.

-- ── events ───────────────────────────────────────────────────────────────────

ALTER TABLE events ADD COLUMN IF NOT EXISTS description text;

-- THE LOCATION AS THE USER SAID IT, and it is text rather than a place_id.
--
-- events.place_id already exists and points at the `places` table, which is for
-- resolved, geocoded places. "Equinox in Dumbo" is not one of those, and minting
-- a places row for every spoken location would fill that table with
-- near-duplicates nobody can merge -- "Dumbo", "in Dumbo", "Dumbo, Brooklyn".
-- So the words go in a column and place_id stays for the day something actually
-- resolves them.
ALTER TABLE events ADD COLUMN IF NOT EXISTS place text;

-- An all-day event is the ONE event with no clock time -- a birthday, a day off.
-- Everything else without a clock time is a reminder, which is why this is a
-- flag on events rather than a third kind of thing.
ALTER TABLE events ADD COLUMN IF NOT EXISTS all_day boolean NOT NULL DEFAULT false;

-- MINUTES BEFORE, AND NULL MEANS SILENT.
--
-- Not a boolean plus a number: "notify me" and "how long before" are one
-- decision, and holding them apart is how you get a row that is notify=true
-- with no lead time and no way to render it. The app writes 10 on every event
-- it creates (the Google default, and what was asked for); a user clearing the
-- notification writes NULL.
ALTER TABLE events ADD COLUMN IF NOT EXISTS notify_minutes_before integer
  CHECK (notify_minutes_before IS NULL OR notify_minutes_before BETWEEN 0 AND 40320);

ALTER TABLE events ADD COLUMN IF NOT EXISTS repeat text NOT NULL DEFAULT 'none';
ALTER TABLE events ADD COLUMN IF NOT EXISTS repeat_until date;

ALTER TABLE events DROP CONSTRAINT IF EXISTS events_repeat_chk;
ALTER TABLE events ADD CONSTRAINT events_repeat_chk
  CHECK (repeat IN ('none','daily','weekdays','weekends','weekly','monthly'));

-- A stop date with nothing to stop is a value that can only mislead a reader.
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_repeat_until_chk;
ALTER TABLE events ADD CONSTRAINT events_repeat_until_chk
  CHECK (repeat_until IS NULL OR repeat <> 'none');

-- ── reminders ────────────────────────────────────────────────────────────────
--
-- These lived entirely inside the `data` jsonb blob. The blob stays -- the
-- iMessage scheduler reads it and nothing about that changes -- but every field
-- a person can now EDIT becomes a real column, because a settings screen that
-- writes into free-form json cannot be constrained, indexed, or read by a
-- migration later.

ALTER TABLE reminders ADD COLUMN IF NOT EXISTS title       text;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS place       text;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS contact_id  uuid;

ALTER TABLE reminders ADD COLUMN IF NOT EXISTS repeat       text NOT NULL DEFAULT 'none';
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS repeat_until date;

-- WHICH DAYS, for a weekly repeat. 0=Sunday .. 6=Saturday, matching
-- Date#getDay() so no translation happens anywhere. NULL for every other
-- frequency: "daily" already says which days, and a redundant copy of that is a
-- second place for it to be wrong.
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS repeat_days smallint[];

-- WHAT TIME OF DAY TO NUDGE, for a thing that has no time of its own.
-- A local wall-clock time, not an instant: "remind me every morning" means 9am
-- wherever the user wakes up, and storing an instant would drift a reminder
-- across the day the first time they fly somewhere.
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS notify_at_local time;

ALTER TABLE reminders DROP CONSTRAINT IF EXISTS reminders_repeat_chk;
ALTER TABLE reminders ADD CONSTRAINT reminders_repeat_chk
  CHECK (repeat IN ('none','daily','weekdays','weekends','weekly','monthly'));

ALTER TABLE reminders DROP CONSTRAINT IF EXISTS reminders_repeat_until_chk;
ALTER TABLE reminders ADD CONSTRAINT reminders_repeat_until_chk
  CHECK (repeat_until IS NULL OR repeat <> 'none');

ALTER TABLE reminders DROP CONSTRAINT IF EXISTS reminders_repeat_days_chk;
ALTER TABLE reminders ADD CONSTRAINT reminders_repeat_days_chk
  CHECK (
    repeat_days IS NULL
    OR (repeat = 'weekly'
        AND array_length(repeat_days, 1) BETWEEN 1 AND 7
        AND repeat_days <@ ARRAY[0,1,2,3,4,5,6]::smallint[])
  );

-- Backfill the title from the blob so no existing reminder loses its label the
-- moment a reader starts preferring the column.
UPDATE reminders
   SET title = COALESCE(title, data ->> 'title', data ->> 'text', data ->> 'body')
 WHERE title IS NULL;

-- The open ones, which is what the top of Notes & Journal asks for on every
-- load: everything not finished, newest first.
CREATE INDEX IF NOT EXISTS reminders_owner_open_idx
  ON reminders (owner_id, created_at DESC)
  WHERE status NOT IN ('done', 'completed');

-- ── ticking off ONE DAY of a repeating reminder ──────────────────────────────
--
-- "If they check it off, it goes away for the day. But it's still on the next
--  day and every other day."
--
-- WHICH IS WHY THIS IS A TABLE AND NOT A STATUS. A repeating reminder is one
-- row: "drink water every day" is not three hundred and sixty-five rows waiting
-- to be created. Ticking Tuesday off therefore cannot be a fact about the ROW --
-- setting status='done' would end the whole series on the first good day, which
-- is precisely the opposite of what a daily reminder is for.
--
-- It is a fact about (reminder, date), so that is the primary key. A one-off
-- reminder still uses status; this table is only consulted for repeats, and its
-- absence for them means "not yet today".
CREATE TABLE IF NOT EXISTS reminder_completions (
  reminder_id  text        NOT NULL REFERENCES reminders (reminder_id) ON DELETE CASCADE,
  owner_id     uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  -- The user's LOCAL date. A day is a timezone question and the client is the
  -- only one that knows the answer, so it sends the date rather than an instant.
  on_date      date        NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reminder_completions_pkey PRIMARY KEY (reminder_id, on_date)
);

CREATE INDEX IF NOT EXISTS reminder_completions_owner_date_idx
  ON reminder_completions (owner_id, on_date DESC);
