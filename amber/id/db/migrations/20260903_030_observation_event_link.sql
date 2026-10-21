-- AN EVENT IS WHEN AND WHERE AND WHO. AN EXPERIENCE IS WHAT IT MEANT.
--
-- Both describe the same dinner from two angles, and until now nothing
-- connected them. Two consequences, and the second is the dangerous one:
--
--   You could not ask "what happened at that dinner" -- the narrative and the
--   calendar entry were unrelated rows.
--
--   THE SAME DINNER COUNTED TWICE. contact_rollup's INTERACTION_STREAM unions
--   observations, observation_participants, events and dm_messages. An
--   experience and an event describing one evening are two rows in that union,
--   so one dinner inflated warmth as though there had been two.
--
-- The link makes the pair addressable and lets the rollup count it once. The
-- rule after this: an event carries the interaction, an experience carries the
-- meaning, and where both exist the rollup counts the observation and skips the
-- event -- see the NOT EXISTS in contact-rollup.js.
--
-- ON DELETE SET NULL, not CASCADE. Deleting a calendar entry must not delete
-- what somebody wrote about the evening. The memory outlives the appointment.
--
-- The index is PARTIAL because most observations are not tied to an event --
-- a fact about where someone works has no date and no place -- and an index
-- over mostly-NULL is a scan waiting to happen.

ALTER TABLE observations
  ADD COLUMN event_id uuid REFERENCES events (event_id) ON DELETE SET NULL;

CREATE INDEX observations_event_idx
  ON observations (event_id) WHERE event_id IS NOT NULL;
