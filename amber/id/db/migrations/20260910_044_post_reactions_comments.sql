-- REACTING AND REPLYING TO WHAT YOUR CONNECTIONS POST.
--
-- The network feed has been readable and inert: posts arrive, and there is
-- nothing to do with one. A feed you cannot answer is a broadcast, and the
-- point of this one is that it is people you actually know.
--
-- MODELLED ON dm_reactions, which has been carrying reactions on direct
-- messages since migration 017 and got the two things right that matter here.
-- Reusing that shape rather than inventing a second one means the aggregation
-- (counts + whether I reacted) reads the same on both surfaces.

CREATE TABLE IF NOT EXISTS post_reactions (
  post_id          bigint      NOT NULL REFERENCES wall_posts (id) ON DELETE CASCADE,
  reactor_amber_id uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  -- THE SAME VOCABULARY AS A DM REACTION, deliberately. Somebody who has
  -- learned what the reactions are in one place has learned them in both, and a
  -- feed with its own private set would be a second thing to learn for no
  -- reason. Extending it later is one migration on two tables, which is the
  -- right amount of friction for adding to a vocabulary.
  kind             text        NOT NULL
                               CHECK (kind IN ('emphasis','like','dislike','laugh','question')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- ONE REACTION PER PERSON PER POST, enforced by the primary key rather than
  -- by application logic: a double tap cannot produce two rows, and changing
  -- your reaction is an upsert rather than a delete-then-insert that can half
  -- fail.
  PRIMARY KEY (post_id, reactor_amber_id)
);

-- The only read: every reaction on a set of posts, to aggregate.
CREATE INDEX IF NOT EXISTS post_reactions_post_idx ON post_reactions (post_id);

-- ── comments ────────────────────────────────────────────────────────────────
--
-- A SEPARATE TABLE FROM THE SHARED-NOTE COMMENTS in note-media, and that is on
-- purpose. Those hang off a conversation and carry a viewer who may not have an
-- account at all (a note shared by link). These hang off a post and the author
-- is always a registered account, because only a connection can see the post to
-- comment on it. One table serving both would need half its columns nullable
-- and a discriminator, and every query would have to remember which world it
-- was in.

CREATE TABLE IF NOT EXISTS post_comments (
  id              bigserial   PRIMARY KEY,
  post_id         bigint      NOT NULL REFERENCES wall_posts (id) ON DELETE CASCADE,
  author_amber_id uuid        NOT NULL REFERENCES users (amber_id) ON DELETE CASCADE,
  text            text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- SOFT, like every other removal in this schema. A deleted comment leaves a
  -- row so the thread's shape survives and a count cannot go stale against it.
  deleted_at      timestamptz
);

-- Reading one post's thread, oldest first, and counting across a page of posts.
CREATE INDEX IF NOT EXISTS post_comments_post_idx
  ON post_comments (post_id, created_at) WHERE deleted_at IS NULL;
