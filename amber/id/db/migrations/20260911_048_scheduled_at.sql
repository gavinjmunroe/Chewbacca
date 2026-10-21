-- WHAT BELONGS ON A CALENDAR, AND WHAT IS JUST SOMETHING YOU SAID.
--
-- "I said Emily and Bo are moving in together in October, and that put it on my
--  calendar for yesterday. Why? The calendar should be for things that are
--  scheduled in my life... Neither is the fact that Shirley and Caleb are
--  working with me. Neither is the fact that I'm going to Bedstuy to see a
--  friend. These are just journals I was giving about my plans for the day."
--
-- THE BUG, EXACTLY. Capture writes an `events` row for any experience with a
-- person in it, and `starts_at` falls back to `observations.observed_at`, which
-- falls back to now(). So every note that mentioned somebody became an event at
-- the moment it was spoken, and `listAgendaEvents` -- which selects on modality
-- alone -- put all of them on today.
--
-- WHAT THIS DOES NOT DO: stop writing those events. `events` is the integration
-- point for the whole app -- contact-rollup.js reads it into
-- contact_interaction_stats, then contact_scores, then PeopleRank, then the six
-- dimensions -- so an experience that stops producing an event is a conversation
-- that stops counting toward the person's warmth. That regression would be far
-- worse than a wrong calendar and completely invisible.
--
-- So the row stays and the DAY VIEW gets a question it can actually answer:
-- did anybody state a time for this?
--
--   observations.scheduled_at  the instant the SPEAKER named. NULL when they did
--                              not name one. Distinct from observed_at, which is
--                              NOT NULL and defaults to now() -- that column
--                              cannot answer this, because a default and a
--                              statement look identical once written.
--   events.scheduled_at        the same fact on the row the day view reads,
--                              denormalized because calendar-synced events have
--                              no observation behind them at all.
--
-- "At 10:00 I have to be at Sephora for a pop-up" keeps its ten o'clock and
-- keeps appearing. "Shirley and Caleb are working with me" keeps its events row,
-- keeps counting toward Shirley and Caleb, and stops claiming to be an
-- appointment.

ALTER TABLE observations ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;
ALTER TABLE events       ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;

COMMENT ON COLUMN observations.scheduled_at IS
  'The time the speaker actually named, or NULL. Never defaulted -- see migration 048.';
COMMENT ON COLUMN events.scheduled_at IS
  'Set when this is a real appointment. NULL means it is an interaction record only.';

-- THE BACKFILL, AND IT IS DELIBERATELY NARROW.
--
-- Only events that came from a real calendar are scheduled beyond doubt: a
-- Google or Outlook row IS an appointment, by construction, and every one of
-- them should keep appearing on the day exactly as it does today. Migration 046
-- added `source` for precisely this kind of question.
--
-- Everything already in the table from capture is left NULL, which is the
-- honest answer: nobody recorded whether a time was stated, so nobody knows,
-- and the failure mode of guessing "yes" is the bug this migration is fixing.
-- The cost is that a genuine "coffee with Mina at ten" from before today drops
-- off its day. That is one day of history against a calendar that has been
-- wrong for every note ever captured.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'source'
  ) THEN
    UPDATE events
       SET scheduled_at = starts_at
     WHERE scheduled_at IS NULL
       AND starts_at IS NOT NULL
       AND source IN ('google', 'microsoft');
    RAISE NOTICE 'backfilled calendar-synced events';
  ELSE
    RAISE NOTICE 'events.source absent; nothing to backfill';
  END IF;
END $$;

-- The day view asks for one owner's scheduled events inside two instants, so
-- that is the index. PARTIAL, because the rows it excludes are the majority --
-- every captured interaction -- and an index that does not carry them is a
-- fraction of the size and never has to be walked past them.
CREATE INDEX IF NOT EXISTS events_scheduled_idx
  ON events (owner_id, scheduled_at)
  WHERE scheduled_at IS NOT NULL AND deleted_at IS NULL;
