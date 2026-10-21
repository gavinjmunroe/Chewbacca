-- ============================================================================
-- THE FEED BECOMES SOMETHING PEOPLE CAN ACTUALLY TALK IN.
--
-- What was here: a post, and answers to a post. That is enough to ask a
-- question and enough to broadcast an update, and it is not enough to run a
-- company's internal channel, because it is missing every cheap gesture that
-- makes asynchronous communication bearable.
--
-- The expensive gesture is writing a reply. If the only way to respond to
-- something is to write a reply, then three things happen: people who agree
-- say nothing, so the author cannot tell the difference between consensus and
-- silence; people who read it say nothing, so nobody knows if an announcement
-- landed; and the thread fills with "+1" and "thanks" that bury the one reply
-- that mattered. Every product that works at this -- Yammer, Teams, Slack --
-- fixed it the same way, with a one-click acknowledgement.
--
-- Four things, each the smallest version of itself:
--
--   org_post_reactions   acknowledge without writing
--   org_post_mentions    put something in front of one named person
--   org_posts.pinned_at  the announcement that must not scroll away
--   attachments.post_id  a file that belongs to a message, not to a page
-- ============================================================================

-- ---------------------------------------------------------------------------
-- REACTIONS.
--
-- A SHORT FIXED SET, NOT ARBITRARY EMOJI. Free-form reactions turn into a
-- second messaging channel nobody can search: twelve near-identical faces,
-- inside jokes, and a column that has to be moderated. Six verbs cover what a
-- reaction is for in a work context -- I have read this, I agree, I will do
-- it, this is good, this is funny, I am confused -- and a person who needs to
-- say more than that has a reply button.
--
-- The primary key IS the uniqueness rule: one person, one post, one emoji.
-- Clicking the same one twice removes it, which the store does with a DELETE
-- rather than a toggle flag, so there is no "inactive reaction" state to
-- filter out of every count.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_post_reactions (
  org_id     uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  post_id    uuid        NOT NULL,
  amber_id   uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  emoji      text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (org_id, post_id, amber_id, emoji),

  CONSTRAINT org_post_reactions_post_fk
    FOREIGN KEY (org_id, post_id)
    REFERENCES org_posts (org_id, id) ON DELETE CASCADE,

  CONSTRAINT org_post_reactions_emoji_shape
    CHECK (emoji IN ('👍', '🎉', '❤️', '👀', '😄', '🤔'))
);

-- "Everything on this post" is how it is always read.
CREATE INDEX IF NOT EXISTS org_post_reactions_post_idx
  ON org_post_reactions (org_id, post_id);

-- ---------------------------------------------------------------------------
-- MENTIONS.
--
-- Stored as rows rather than parsed out of the body on every read. The body
-- is the display text and will be edited; the mention is a fact about who was
-- addressed, and it has to survive somebody fixing a typo in their own name.
--
-- WHAT THIS IS FOR is the unread badge. A company feed that badges every post
-- trains people to ignore the badge within a week. A badge that means
-- "somebody asked YOU something" keeps meaning that.
--
-- A mention does NOT grant visibility. Addressing somebody who is not in the
-- audience does not let them read the post -- the audience predicate still
-- decides, and the mention simply never surfaces. The alternative, where
-- typing a name widens who can see a restricted post, is a permission model
-- with a hole shaped like the @ key.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS org_post_mentions (
  org_id     uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  post_id    uuid        NOT NULL,
  amber_id   uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  seen_at    timestamptz NULL,

  PRIMARY KEY (org_id, post_id, amber_id),

  CONSTRAINT org_post_mentions_post_fk
    FOREIGN KEY (org_id, post_id)
    REFERENCES org_posts (org_id, id) ON DELETE CASCADE
);

-- "What has been addressed to me and not yet seen" -- the badge query.
CREATE INDEX IF NOT EXISTS org_post_mentions_unseen_idx
  ON org_post_mentions (org_id, amber_id) WHERE seen_at IS NULL;

-- ---------------------------------------------------------------------------
-- PINNING.
--
-- One timestamp, not a boolean, because the useful ordering of several pinned
-- posts is the order they were pinned in -- and a boolean cannot say that.
--
-- Admin-only in the route layer. A feed where anybody can pin their own post
-- to the top is a feed where everybody does.
-- ---------------------------------------------------------------------------
ALTER TABLE org_posts
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz NULL;
ALTER TABLE org_posts
  ADD COLUMN IF NOT EXISTS pinned_by uuid NULL REFERENCES users (amber_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS org_posts_pinned_idx
  ON org_posts (org_id, pinned_at DESC) WHERE pinned_at IS NOT NULL AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- A FILE ON A MESSAGE.
--
-- org_page_attachments already carries a nullable page_id and a nullable
-- group_id, because a file in this product belongs to any combination of a
-- page, a team and a set of tags. A post is the third place a file can hang
-- from, and it is the same row: the drive should show a deck somebody posted
-- to the feed, with the search, the audience and the extracted text all
-- working, rather than keeping a second parallel store of message files that
-- none of those features know about.
--
-- ON DELETE SET NULL, not CASCADE. Deleting a message must not delete the
-- file that was shared in it -- the file outlives the sentence that
-- introduced it, and somebody tidying the feed should not silently destroy
-- the quarterly deck.
-- ---------------------------------------------------------------------------
ALTER TABLE org_page_attachments
  ADD COLUMN IF NOT EXISTS post_id uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'org_page_attachments_post_fk'
  ) THEN
    ALTER TABLE org_page_attachments
      ADD CONSTRAINT org_page_attachments_post_fk
      FOREIGN KEY (org_id, post_id)
      REFERENCES org_posts (org_id, id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS org_page_attachments_post_idx
  ON org_page_attachments (org_id, post_id) WHERE post_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Both new tables join the tenant policy. A table without one is the only
-- place a cross-company read could come from.
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['org_post_reactions', 'org_post_mentions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS amber_tenant ON %I', t);
    EXECUTE format($f$
      CREATE POLICY amber_tenant ON %I
        USING (amber_current_org() IS NOT NULL AND org_id = amber_current_org())
        WITH CHECK (amber_current_org() IS NOT NULL AND org_id = amber_current_org())
    $f$, t);
  END LOOP;
END $$;
