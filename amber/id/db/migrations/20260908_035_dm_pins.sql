-- PINNED MESSAGES IN A DIRECT MESSAGE THREAD.
--
-- "Pinned notes" in the DM Info tab. The thing people pin in a chat is almost
-- always a voice memo or the one line with the address in it, and until now the
-- only way back to it was scrolling -- which in a thread that has run for months
-- is not a way back at all.
--
-- WHY A COLUMN AND NOT A TABLE. A pin is one nullable timestamp on a row that
-- already exists, read in the same query as the message, and every access path
-- already filters by thread. A dm_pins table would add a join to the hot read
-- and a second place for a delete to have to remember to visit -- dm_messages
-- rows are already cascaded on thread delete and soft-deleted per message.
--
-- IT IS PER THREAD, NOT PER VIEWER, and that is a deliberate choice rather than
-- an oversight: a pin in a two-person conversation is a shared bookmark ("this
-- is the one with the address"), the same way it works in every messenger
-- people already use. pinned_by records who did it so the UI can say so.
--
-- Both columns are nullable and unpinning writes NULL, so there is no state to
-- migrate and nothing to backfill.

ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS pinned_at timestamptz;
ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS pinned_by uuid;

-- The pinned strip is "this thread's pins, newest first", so the index carries
-- the thread and the timestamp and covers nothing else. PARTIAL, because pinned
-- rows are a tiny fraction of dm_messages and an index over all of them would be
-- most of the table for no reader.
CREATE INDEX IF NOT EXISTS dm_messages_pinned_idx
  ON dm_messages (thread_id, pinned_at DESC)
  WHERE pinned_at IS NOT NULL;
