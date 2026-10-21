-- Widen the reaction vocabulary again: add 'heart'.
--
-- "It should be a clean set of emojis that look exactly like the Apple emojis."
--
-- The set has been emphasis / like / dislike / laugh / question since
-- 20260818_reactions_add_like.sql, where `like` means THUMBS UP. That was a
-- deliberate reading of an earlier instruction about the DM tapbacks, and it
-- came with a note admitting the gap: "Apple leads with a heart, which this app
-- has no kind for; adding one is a schema change and not what 'make the
-- reactions like the Apple ones' was asking for."
--
-- It is what this one is asking for. A feed you answer with a thumbs-up and no
-- heart is not the set anybody means by "the Apple emojis", and the design's own
-- feed card draws a heart with a count beside it.
--
-- ALL THREE TABLES, IN ONE FILE, and that is the point of the file.
--
-- There are three: note_reactions (shared voice notes, 20260817), dm_reactions
-- (direct messages, 20260826) and post_reactions (network posts, 044). They
-- agree today -- dm_reactions was created after 'like' was added and was written
-- with the wider list, and 044 copied it -- but they agree only because three
-- separate authors happened to copy the same five strings. Nothing enforces it.
--
-- So the widening is done in one place rather than in three follow-ups, and the
-- client's copy of the list is pinned against this one by a test
-- (lib/postSocial.test.mts) that reads the vocabulary out of the app and
-- compares it to the set here. A sixth reaction added on one side only is then
-- a failing test rather than a tap that works on a post and fails on a DM.
--
-- ONLY THE TABLES THAT ACTUALLY EXIST, and the first version of this did not
-- check. It ran `ALTER TABLE note_reactions` unconditionally and died on
-- production with `relation "note_reactions" does not exist` -- rolling back
-- the whole file, so post_reactions did not get widened either and the heart
-- was unusable everywhere.
--
-- The reason is worth writing down: note_reactions was created by
-- _archive/20260817_add_note_media.sql, and the archive is not what this
-- database was built from. A table being in the repo's history is not the same
-- as a table being in the database, and any migration that assumes otherwise is
-- one bad deploy away from taking its file down with it.
--
-- So each widening is guarded by to_regclass, which answers null for a table
-- that is not there. A missing table is skipped with a notice rather than
-- failing the file -- and if it is created later, its own migration carries the
-- current vocabulary.
--
-- SAFE TO RE-RUN, and safe while an older client is live: this only WIDENS what
-- is accepted, so no existing row can violate it, there is nothing to backfill,
-- and a client that never sends 'heart' is unaffected. Not NOT VALID: these
-- tables are small and the validation scan costs nothing.
--
-- Rolling the client back without rolling this back is fine -- a wider
-- constraint accepts a narrower client. Rolling THIS back while the new client
-- is live is not: drop it only once any 'heart' rows are gone.

DO $$
DECLARE
  t   text;
  con text;
  -- THE VOCABULARY, ONCE. The server reads its own copy from
  -- src/lib/reaction-kinds.js and a test compares the two by parsing this exact
  -- line, so the two cannot drift without something going red.
  kinds  text[] := ARRAY['emphasis','like','dislike','laugh','question','heart'];
  -- Every table that carries it. A fourth means adding it here, not writing a
  -- fourth migration.
  tables text[] := ARRAY['note_reactions','dm_reactions','post_reactions'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'skipping %: table does not exist in this database', t;
      CONTINUE;
    END IF;

    -- Drop whatever the constraint is called here. Two of these tables named it
    -- explicitly (<table>_kind_chk); post_reactions used an inline CHECK in
    -- migration 044, which Postgres auto-names <table>_kind_check. Both are
    -- dropped so this never depends on which one it turns out to be.
    FOREACH con IN ARRAY ARRAY[t || '_kind_chk', t || '_kind_check'] LOOP
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, con);
    END LOOP;

    -- `= ANY (array)` rather than `IN (list)`: same meaning to the planner, and
    -- it lets the vocabulary stay a single array instead of being spliced into
    -- the statement one literal at a time.
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (kind = ANY (%L::text[]))',
      t, t || '_kind_chk', kinds
    );
    RAISE NOTICE 'widened %', t;
  END LOOP;
END $$;
