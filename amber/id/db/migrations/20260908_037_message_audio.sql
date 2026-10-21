-- AUDIO PER MESSAGE, NOT ONLY PER NOTE.
--
-- "In the follow-up chats inside of a voice chat or whatever else that I just
--  choose to tap into on my home screen, there should be a voice option in
--  there... It should save the voice note in there as well, but it should also
--  transcribe it under."
--
-- The recorder already hands the caller its file, its duration and its
-- waveform, and the follow-up already arrives as text, because the transcript
-- IS the message. What had nowhere to go was the recording: media_assets holds
-- ONE live row per conversation (media_conv_live_uidx), so attaching a clip to
-- the third message of a thread would have replaced the note's own audio -- the
-- clip the card plays. A spoken follow-up therefore transcribed fine and threw
-- the audio away.
--
-- WHY A COLUMN ON media_assets AND NOT A NEW TABLE. That table is not a
-- convenient bucket for bytes, it is the UPLOAD STATE MACHINE: the server mints
-- the storage key, the client PUTs to the bucket, the server HEADs the object
-- and records the real size, and a row only reaches 'ready' when the server has
-- seen the bytes. A second table for message clips would be a second
-- implementation of that -- meaning a second place for "the client declared its
-- own upload complete" to creep back in -- plus a second thing for purge,
-- contact-delete and the note-media authorization check to remember. One more
-- nullable column reuses all of it.
--
-- conversation_id STAYS SET on a message clip, deliberately. It is what
-- canViewNote() is expressed in terms of, and what purge and the cascade on a
-- deleted note follow. The message reference is what makes it a per-message
-- clip; the conversation reference is what makes it governable.

ALTER TABLE media_assets
  ADD COLUMN IF NOT EXISTS message_id bigint
    REFERENCES conversation_messages (id) ON DELETE CASCADE;

-- ONE LIVE RECORDING PER NOTE -- now meaning per note, excluding its messages.
--
-- The old index made conversation_id unique among all live rows, so the note's
-- clip and a message's clip could not coexist. The rule it was protecting is
-- still worth having (reserveAudioUpload's ON CONFLICT needs something to
-- conflict WITH, or a retried reserve silently creates a second pending row),
-- so it is re-created as "one live NOTE-LEVEL recording per conversation", and
-- message rows get their own uniqueness below.
--
-- reserveAudioUpload's ON CONFLICT clause has to carry `message_id IS NULL` to
-- match this predicate, and it does -- via queryWithOptionalColumn, so a deploy
-- that reaches production before this migration keeps working on the old index
-- instead of failing every reserve. That ordering has bitten once already.
DROP INDEX IF EXISTS media_conv_live_uidx;
CREATE UNIQUE INDEX media_conv_live_uidx ON media_assets (conversation_id)
  WHERE conversation_id IS NOT NULL AND message_id IS NULL AND deleted_at IS NULL;

-- One live recording per MESSAGE, for the same reason: the reserve for a
-- message clip is an upsert and needs an arbiter.
CREATE UNIQUE INDEX media_message_live_uidx ON media_assets (message_id)
  WHERE message_id IS NOT NULL AND deleted_at IS NULL;

-- Reading a thread asks for every message clip in it at once, so the index
-- carries the conversation and the message together. Partial, because clips are
-- a small minority of media_assets rows and none of the other readers filter on
-- message_id at all.
CREATE INDEX media_conv_message_idx ON media_assets (conversation_id, message_id)
  WHERE message_id IS NOT NULL AND deleted_at IS NULL;
