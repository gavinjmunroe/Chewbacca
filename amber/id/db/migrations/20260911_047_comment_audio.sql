-- Voice comments.
--
-- "There should be a little voice thing next to it, like a waveform, where I
--  can leave a voice comment, which should be transcribed and shown with the
--  voice."
--
-- NO NEW AUDIO TABLE. media_assets has been the app's audio store since
-- migration 010: it holds the storage key, the duration, the byte size, the
-- waveform peaks and the pending/ready status, and it is already in
-- STORAGE_KEY_TABLES in purge.js -- which is what makes deleting an account
-- delete the OBJECTS IN THE BUCKET and not just the rows pointing at them. A
-- comment_audio table of its own would have had to re-earn every one of those,
-- and would have gone into production missing at least the last one.
--
-- So a voice comment is a post_comments row that points at a media_assets row.
--
-- THE TRANSCRIPT LIVES IN `text`, the column that was already there. That is
-- the whole reason a voice comment is searchable, readable in a notification,
-- and countable the same way a typed one is -- and why the feed's existing
-- comment query needed no change at all. "Shown with the voice" means both: the
-- waveform plays and the words are underneath.
--
-- TEXT STOPS BEING REQUIRED, because transcription can fail or return nothing
-- (a two-second clip of somebody laughing). A voice comment with no words is
-- still a voice comment; a comment with neither words nor audio is not a
-- comment, and that is enforced by the CHECK below rather than by NOT NULL.
--
-- SAFE TO RE-RUN.

DO $$
BEGIN
  IF to_regclass('public.post_comments') IS NULL THEN
    RAISE NOTICE 'skipping: post_comments does not exist in this database';
    RETURN;
  END IF;

  -- The clip, when there is one. ON DELETE SET NULL rather than CASCADE: if the
  -- media row is ever removed the transcript is still worth keeping, and a
  -- comment silently vanishing from a thread is worse than one that lost its
  -- audio.
  ALTER TABLE post_comments
    ADD COLUMN IF NOT EXISTS media_id uuid REFERENCES media_assets (media_id) ON DELETE SET NULL;

  ALTER TABLE post_comments ALTER COLUMN text DROP NOT NULL;

  ALTER TABLE post_comments DROP CONSTRAINT IF EXISTS post_comments_content_chk;
  ALTER TABLE post_comments
    ADD CONSTRAINT post_comments_content_chk
    CHECK (
      media_id IS NOT NULL
      OR (text IS NOT NULL AND length(btrim(text)) > 0)
    );

  CREATE INDEX IF NOT EXISTS post_comments_media_idx
    ON post_comments (media_id) WHERE media_id IS NOT NULL;
END $$;

-- WHICH COMMENT A CLIP BELONGS TO, from the media side.
--
-- media_assets is reached two ways: by the comment that points at it, and by
-- the owner sweeping their own media. The second one needs the back-reference
-- or an orphaned clip -- uploaded, never attached because the app was killed
-- mid-post -- is invisible and un-collectable.
DO $$
BEGIN
  IF to_regclass('public.media_assets') IS NULL THEN
    RAISE NOTICE 'skipping: media_assets does not exist in this database';
    RETURN;
  END IF;

  ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS comment_id bigint;

  CREATE INDEX IF NOT EXISTS media_comment_idx
    ON media_assets (comment_id) WHERE comment_id IS NOT NULL;

  -- Orphan sweep: a reserved clip nobody attached within a day.
  CREATE INDEX IF NOT EXISTS media_pending_idx
    ON media_assets (created_at)
    WHERE status = 'pending' AND deleted_at IS NULL;
END $$;
