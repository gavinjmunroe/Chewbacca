import { query } from "./sql.js";

/**
 * REACTING AND REPLYING TO A CONNECTION'S POST.
 *
 * The network feed has been readable and inert: posts arrive and there is
 * nothing to do with one. A feed you cannot answer is a broadcast, and the
 * whole premise of this one is that it is people you actually know.
 *
 * MIRRORS dm-store.js, which has carried reactions on direct messages since
 * migration 017. The aggregation shape is identical -- `{ counts, mine }` --
 * so a client that can draw a reaction row on a message can draw one on a post
 * without learning a second format, and so the two cannot drift into disagreeing
 * about what a reaction is.
 *
 * VISIBILITY IS THE WHOLE SECURITY STORY HERE, and it is checked on every write
 * rather than assumed from the fact that the post appeared in a feed. A post id
 * is a small integer: anybody can type the next one. `canSeePost` is the single
 * predicate, and every function below goes through it.
 */

/**
 * The reaction vocabulary, re-exported so a route can validate against it.
 *
 * NOT DECLARED HERE ANY MORE. This file used to carry its own copy of the five
 * strings, as did dm-store.js and note-media-store.js -- three copies of one
 * list, kept equal by hand, each with its own CHECK constraint. See
 * lib/reaction-kinds.js.
 */
import { isReactionKind } from "../lib/reaction-kinds.js";

export { isReactionKind };

/**
 * May this viewer see this post at all?
 *
 * Their own, or an active connection's. NOT "is it in the feed query" -- the
 * feed is a read and this is the gate for writes, and a gate that trusts a
 * different query to have been run first is not a gate.
 */
async function canSeePost(postId, me) {
  const { rows } = await query(
    `SELECT 1
       FROM wall_posts p
      WHERE p.id = $1
        AND p.deleted_at IS NULL
        AND (
          p.owner_id = $2::uuid
          OR EXISTS (
            SELECT 1 FROM connections c
             WHERE c.status = 'active'
               AND ((c.a_amber_id = $2::uuid AND c.b_amber_id = p.owner_id)
                 OR (c.b_amber_id = $2::uuid AND c.a_amber_id = p.owner_id))
          )
        )
      LIMIT 1`,
    [postId, me],
  );
  return rows.length > 0;
}

/** `{ counts, mine }` for one post, read back after a write. */
async function readReactions(postId, me) {
  const { rows } = await query(
    `SELECT kind, reactor_amber_id = $2::uuid AS mine
       FROM post_reactions WHERE post_id = $1`,
    [postId, me],
  );
  const counts = {};
  let mine = null;
  for (const r of rows) {
    counts[r.kind] = (counts[r.kind] || 0) + 1;
    if (r.mine) mine = r.kind;
  }
  return { counts, mine };
}

/**
 * Set, change or clear this viewer's reaction to a post.
 *
 * `kind === null` clears it. Anything else is an upsert on the primary key, so
 * a double tap cannot make two rows and changing your mind is one statement
 * rather than a delete-then-insert that can half fail.
 *
 * Returns the post's whole reaction state, not just the change, because that is
 * what the caller has to render and a client computing it from a delta will
 * eventually be wrong.
 */
/**
 * WHAT CAME BACK WHEN A REACTION DID NOT SAVE.
 *
 * `null` has meant "you cannot see that post" and the route turns it into a
 * 404. It also silently meant "the database refused the value", because a CHECK
 * violation lands in the same catch -- and that is exactly what happened when
 * `heart` shipped to a server whose migration had not run: every tap answered
 * "Could not save that reaction", with nothing anywhere saying the vocabulary
 * and the constraint disagreed.
 *
 * A deployment fault and a permission fault are not the same event and must not
 * produce the same answer. This is the first one.
 */
export const REACTION_NOT_ACCEPTED = Symbol("reaction_not_accepted");

/** Postgres: a CHECK constraint refused the row. */
const PG_CHECK_VIOLATION = "23514";

export async function reactToPost(me, postId, kind) {
  const id = Number(postId);
  if (!me || !Number.isInteger(id) || id <= 0) return null;
  if (kind !== null && !isReactionKind(kind)) return null;
  try {
    if (!(await canSeePost(id, me))) return null;
    if (kind === null) {
      await query(
        `DELETE FROM post_reactions WHERE post_id = $1 AND reactor_amber_id = $2::uuid`,
        [id, me],
      );
    } else {
      await query(
        `INSERT INTO post_reactions (post_id, reactor_amber_id, kind)
         VALUES ($1, $2::uuid, $3)
         ON CONFLICT (post_id, reactor_amber_id)
           DO UPDATE SET kind = EXCLUDED.kind, created_at = now()`,
        [id, me, kind],
      );
    }
    return await readReactions(id, me);
  } catch (e) {
    if (e?.code === PG_CHECK_VIOLATION) {
      /**
       * THE APP AND THE DATABASE DISAGREE ABOUT WHAT A REACTION IS, which is a
       * migration that has not been applied. Loud, and named, because the
       * symptom otherwise reaches somebody as "reactions are broken".
       */
      console.error(
        `REACTION_KIND_REJECTED kind=${kind} -- post_reactions_kind_chk refused it. ` +
          `Apply db/migrations/20260911_045_reactions_add_heart.sql.`,
      );
      return REACTION_NOT_ACCEPTED;
    }
    console.error(`REACT_TO_POST_ERR ${e?.message || e}`);
    return null;
  }
}

/** One post's thread, oldest first: a conversation reads down the page. */
export async function listPostComments(me, postId, { limit = 100 } = {}) {
  const id = Number(postId);
  if (!me || !Number.isInteger(id) || id <= 0) return null;
  try {
    if (!(await canSeePost(id, me))) return null;
    const { rows } = await query(
      `SELECT c.id, c.text, c.created_at,
              u.amber_id, u.username, u.full_name, u.avatar_url,
              m.media_id, m.duration_ms, m.peaks
         FROM post_comments c
         JOIN users u ON u.amber_id = c.author_amber_id AND u.deleted_at IS NULL
         -- LEFT: almost every comment is typed and has no clip.
         LEFT JOIN media_assets m
           ON m.media_id = c.media_id AND m.deleted_at IS NULL AND m.status = 'ready'
        WHERE c.post_id = $1 AND c.deleted_at IS NULL
        ORDER BY c.created_at ASC, c.id ASC
        LIMIT $2`,
      [id, Math.min(Math.max(Number(limit) || 100, 1), 200)],
    );
    return rows.map((r) => ({
      commentId: String(r.id),
      text: r.text ?? "",
      createdAt: r.created_at,
      mine: String(r.amber_id) === String(me),
      /**
       * THE WAVEFORM RIDES WITH THE COMMENT; the playback URL does not.
       * A signed URL is a capability with a short life, so it is minted per
       * play rather than baked into a list that might sit in a cache for an
       * hour. The peaks are what the row needs to DRAW, and they are just
       * numbers.
       */
      audio: r.media_id
        ? {
            mediaId: String(r.media_id),
            durationMs: Number(r.duration_ms) || 0,
            peaks: Array.isArray(r.peaks) ? r.peaks.map(Number) : [],
          }
        : null,
      author: {
        amberId: String(r.amber_id),
        username: r.username ?? null,
        fullName: r.full_name ?? null,
        avatarUrl: r.avatar_url ?? null,
      },
    }));
  } catch (e) {
    console.error(`LIST_POST_COMMENTS_ERR ${e?.message || e}`);
    return null;
  }
}

/**
 * WHO REACTED, AND WITH WHAT.
 *
 * "If you long-press that, you should see who sent which reaction."
 *
 * A SEPARATE READ, not part of the feed payload, and deliberately so: the feed
 * carries counts because every card needs them, and this carries names because
 * one card at a time needs them. Shipping every reactor on every post down with
 * the page would make a busy feed pay for a gesture almost nobody performs on
 * almost every post.
 *
 * Returns null when the viewer cannot see the post -- same rule as everything
 * else here, and the route turns that into a 404 rather than a 403.
 */
export async function listPostReactors(me, postId, { limit = 200 } = {}) {
  const id = Number(postId);
  if (!me || !Number.isInteger(id) || id <= 0) return null;
  try {
    if (!(await canSeePost(id, me))) return null;
    const { rows } = await query(
      `SELECT r.kind, r.created_at,
              u.amber_id, u.username, u.full_name, u.avatar_url
         FROM post_reactions r
         JOIN users u ON u.amber_id = r.reactor_amber_id AND u.deleted_at IS NULL
        WHERE r.post_id = $1
        ORDER BY r.created_at ASC
        LIMIT $2`,
      [id, Math.min(Math.max(Number(limit) || 200, 1), 500)],
    );
    return rows.map((r) => ({
      kind: r.kind,
      reactedAt: r.created_at,
      mine: String(r.amber_id) === String(me),
      person: {
        amberId: String(r.amber_id),
        username: r.username ?? null,
        fullName: r.full_name ?? null,
        avatarUrl: r.avatar_url ?? null,
      },
    }));
  } catch (e) {
    console.error(`LIST_POST_REACTORS_ERR ${e?.message || e}`);
    return null;
  }
}

/**
 * VOICE COMMENTS: reserving a clip, and reading one back.
 *
 * media_assets has been the app's audio store since migration 010 -- storage
 * key, duration, byte size, waveform peaks, pending/ready -- and it is already
 * in purge.js's STORAGE_KEY_TABLES, which is what makes deleting an account
 * delete the OBJECTS IN THE BUCKET rather than only the rows pointing at them.
 * A comment_audio table would have had to re-earn every one of those and would
 * have shipped missing at least the last.
 */

/** Where a comment's clip lives in the bucket. */
function commentAudioKey(ownerId, mediaId) {
  return `comment-audio/${ownerId}/${mediaId}.m4a`;
}

/**
 * Reserve an upload slot and return the key to sign.
 *
 * THE SERVER NAMES THE OBJECT, always. A client that supplies its own key can
 * point the server at somebody else's audio, so the key is derived from the
 * owner and a fresh id and persisted here; finalize reads it back from the row
 * rather than from the request.
 */
export async function reserveCommentAudio(me) {
  if (!me) return null;
  try {
    const { rows } = await query(
      `INSERT INTO media_assets (owner_id, storage_key, content_type, status)
       VALUES ($1::uuid, '', 'audio/m4a', 'pending')
       RETURNING media_id`,
      [me],
    );
    const mediaId = rows[0]?.media_id ? String(rows[0].media_id) : null;
    if (!mediaId) return null;
    const storageKey = commentAudioKey(me, mediaId);
    await query(`UPDATE media_assets SET storage_key = $2 WHERE media_id = $1::uuid`, [
      mediaId,
      storageKey,
    ]);
    return { mediaId, storageKey };
  } catch (e) {
    console.error(`RESERVE_COMMENT_AUDIO_ERR ${e?.message || e}`);
    return null;
  }
}

/** The reserved row, so finalize can check what actually landed in the bucket. */
export async function readPendingCommentAudio(me, mediaId) {
  if (!me || !mediaId) return null;
  try {
    const { rows } = await query(
      `SELECT media_id, storage_key, status
         FROM media_assets
        WHERE media_id = $1::uuid AND owner_id = $2::uuid AND deleted_at IS NULL`,
      [mediaId, me],
    );
    return rows[0] ?? null;
  } catch (e) {
    console.error(`READ_PENDING_COMMENT_AUDIO_ERR ${e?.message || e}`);
    return null;
  }
}

/** Record what the bucket actually received. */
export async function markCommentAudioReady(me, mediaId, { durationMs = 0, byteSize = 0, peaks = [] } = {}) {
  if (!me || !mediaId) return false;
  try {
    const { rowCount } = await query(
      `UPDATE media_assets
          SET duration_ms = $3, byte_size = $4, peaks = $5::smallint[], status = 'ready'
        WHERE media_id = $1::uuid AND owner_id = $2::uuid`,
      [mediaId, me, Math.max(0, Number(durationMs) || 0), Math.max(0, Number(byteSize) || 0),
       (peaks ?? []).slice(0, 512).map((n) => Math.max(0, Math.min(100, Number(n) || 0)))],
    );
    return rowCount > 0;
  } catch (e) {
    console.error(`MARK_COMMENT_AUDIO_READY_ERR ${e?.message || e}`);
    return false;
  }
}

/** Drop a reserved clip that never became a comment. */
export async function discardCommentAudio(me, mediaId) {
  if (!me || !mediaId) return;
  try {
    await query(
      `UPDATE media_assets SET deleted_at = now()
        WHERE media_id = $1::uuid AND owner_id = $2::uuid AND comment_id IS NULL`,
      [mediaId, me],
    );
  } catch (e) {
    console.error(`DISCARD_COMMENT_AUDIO_ERR ${e?.message || e}`);
  }
}

/** The shape a comment carries: enough to draw the waveform, no URL. */
async function readCommentAudio(mediaId) {
  try {
    const { rows } = await query(
      `SELECT media_id, duration_ms, peaks FROM media_assets
        WHERE media_id = $1::uuid AND deleted_at IS NULL`,
      [mediaId],
    );
    const r = rows[0];
    return r
      ? {
          mediaId: String(r.media_id),
          durationMs: Number(r.duration_ms) || 0,
          peaks: Array.isArray(r.peaks) ? r.peaks.map(Number) : [],
        }
      : null;
  } catch {
    return null;
  }
}

/**
 * The storage key for a clip, for anybody allowed to hear it.
 *
 * ALLOWED means "can see the post the comment is on", which is the same gate as
 * everything else here -- not "owns the clip". A voice comment is FOR the
 * thread; the author is usually not the person listening.
 */
export async function commentAudioForPlayback(me, commentId) {
  const id = Number(commentId);
  if (!me || !Number.isInteger(id) || id <= 0) return null;
  try {
    const { rows } = await query(
      `SELECT c.post_id, m.storage_key, m.content_type, m.duration_ms, m.peaks
         FROM post_comments c
         JOIN media_assets m ON m.media_id = c.media_id AND m.deleted_at IS NULL
        WHERE c.id = $1 AND c.deleted_at IS NULL AND m.status = 'ready'`,
      [id],
    );
    const r = rows[0];
    if (!r) return null;
    if (!(await canSeePost(Number(r.post_id), me))) return null;
    return {
      storageKey: r.storage_key,
      contentType: r.content_type ?? "audio/m4a",
      durationMs: Number(r.duration_ms) || 0,
      peaks: Array.isArray(r.peaks) ? r.peaks.map(Number) : [],
    };
  } catch (e) {
    console.error(`COMMENT_AUDIO_PLAYBACK_ERR ${e?.message || e}`);
    return null;
  }
}

/** The maximum a comment may be. Long enough for a paragraph, short of an essay. */
export const COMMENT_MAX = 2000;

/**
 * Add a comment. Returns the created row, or null if the viewer cannot see the
 * post or the text is empty.
 *
 * TRIMMED AND LENGTH-CHECKED HERE rather than only in the route, because this
 * is the function anything else will call, and "the route validates it" stops
 * being true the first time something else writes a comment.
 */
export async function addPostComment(me, postId, text, { mediaId = null } = {}) {
  const id = Number(postId);
  const body = typeof text === "string" ? text.trim() : "";
  if (!me || !Number.isInteger(id) || id <= 0) return null;
  /**
   * A VOICE COMMENT MAY HAVE NO WORDS. Transcription can fail, and a two-second
   * clip of somebody laughing has nothing to transcribe -- it is still a
   * comment. What is never a comment is neither words nor audio, which is the
   * CHECK constraint in migration 047 and is checked here too so the caller
   * gets null rather than a constraint violation in the log.
   */
  if (body.length === 0 && !mediaId) return null;
  if (body.length > COMMENT_MAX) return null;
  try {
    if (!(await canSeePost(id, me))) return null;
    const { rows } = await query(
      `INSERT INTO post_comments (post_id, author_amber_id, text, media_id)
       VALUES ($1, $2::uuid, NULLIF($3, ''), $4::uuid)
       RETURNING id, text, created_at, media_id`,
      [id, me, body, mediaId],
    );
    const r = rows[0];
    if (!r) return null;
    /**
     * POINT THE CLIP BACK AT THE COMMENT. Without this back-reference a clip
     * that was uploaded and then attached is indistinguishable from one that was
     * uploaded and abandoned, so the orphan sweep cannot tell them apart and
     * either collects live audio or collects nothing.
     */
    if (r.media_id) {
      await query(
        `UPDATE media_assets SET comment_id = $1, status = 'ready'
          WHERE media_id = $2::uuid AND owner_id = $3::uuid`,
        [r.id, r.media_id, me],
      );
    }
    const audio = r.media_id ? await readCommentAudio(r.media_id) : null;
    const { rows: who } = await query(
      `SELECT amber_id, username, full_name, avatar_url FROM users WHERE amber_id = $1::uuid`,
      [me],
    );
    const u = who[0] ?? {};
    return {
      commentId: String(r.id),
      text: r.text ?? "",
      createdAt: r.created_at,
      mine: true,
      audio,
      author: {
        amberId: String(me),
        username: u.username ?? null,
        fullName: u.full_name ?? null,
        avatarUrl: u.avatar_url ?? null,
      },
    };
  } catch (e) {
    console.error(`ADD_POST_COMMENT_ERR ${e?.message || e}`);
    return null;
  }
}

/**
 * Delete your own comment. Soft, and only your own.
 *
 * A post's author cannot remove somebody else's comment from here. That is a
 * moderation decision with its own consequences and it should be built
 * deliberately, not fall out of an ownership check nobody wrote down.
 */
export async function deletePostComment(me, commentId) {
  const id = Number(commentId);
  if (!me || !Number.isInteger(id) || id <= 0) return false;
  try {
    const { rowCount } = await query(
      `UPDATE post_comments SET deleted_at = now()
        WHERE id = $1 AND author_amber_id = $2::uuid AND deleted_at IS NULL`,
      [id, me],
    );
    return rowCount > 0;
  } catch (e) {
    console.error(`DELETE_POST_COMMENT_ERR ${e?.message || e}`);
    return false;
  }
}

/**
 * Reactions and comment counts for a page of posts, in one round trip each.
 *
 * NOT N+1. The feed renders a page of posts and every one of them needs its
 * reaction row and its comment count; asking per post is the difference between
 * two queries and forty.
 */
export async function socialForPosts(me, postIds) {
  /**
   * DEDUPED, AND THAT IS A BUG FIX RATHER THAN TIDINESS.
   *
   * `ids` feeds `unnest($1::bigint[])`, which the comment-preview query CROSS
   * JOINs LATERAL against. A repeated id therefore runs the LATERAL twice and
   * pushes the same two comments into the same slot twice -- so a post that
   * appeared twice in the page (a retry, a merge, two shares of one note) drew
   * every comment on it twice. Reported as "for some reason there are two
   * comments, it looks like it duplicated them."
   *
   * A Set is the fix at the source. The push below is also made idempotent,
   * because this query is not the only way a row can arrive twice.
   */
  const ids = [
    ...new Set(
      (Array.isArray(postIds) ? postIds : [])
        .map((x) => Number(x))
        .filter((n) => Number.isInteger(n) && n > 0),
    ),
  ];
  const out = new Map();
  if (!me || ids.length === 0) return out;
  for (const id of ids) {
    out.set(String(id), {
      reactions: { counts: {}, mine: null },
      commentCount: 0,
      comments: [],
    });
  }
  try {
    const [{ rows: reactions }, { rows: comments }, { rows: preview }] = await Promise.all([
      query(
        `SELECT post_id, kind, reactor_amber_id = $2::uuid AS mine
           FROM post_reactions WHERE post_id = ANY($1::bigint[])`,
        [ids, me],
      ),
      query(
        `SELECT post_id, count(*)::int AS n
           FROM post_comments
          WHERE post_id = ANY($1::bigint[]) AND deleted_at IS NULL
          GROUP BY post_id`,
        [ids],
      ),
      /**
       * THE FIRST TWO COMMENTS, FOR THE CARD.
       *
       * "Only two comments should be shown, and if you want to see the rest,
       *  you should click on the comments button."
       *
       * ONE QUERY FOR THE WHOLE PAGE, not one per card. A LATERAL take-2 per
       * post is the difference between a feed that costs three queries and one
       * that costs three plus a round trip per post -- and the per-post version
       * is the one that draws every card empty and then pops the comments in.
       *
       * THE TWO MOST RECENT, returned newest-first here and reversed by the
       * client so they read in order. A thread's first two comments are its
       * oldest and are usually the least interesting thing on the card; what
       * somebody wants to see under a post is what was just said.
       */
      query(
        `SELECT c.post_id, c.id, c.text, c.created_at,
                u.amber_id, u.username, u.full_name, u.avatar_url,
                m.media_id, m.duration_ms, m.peaks
           FROM unnest($1::bigint[]) AS p(post_id)
           CROSS JOIN LATERAL (
             SELECT id, post_id, text, created_at, author_amber_id, media_id
               FROM post_comments
              WHERE post_id = p.post_id AND deleted_at IS NULL
              ORDER BY created_at DESC, id DESC
              LIMIT 2
           ) c
           JOIN users u ON u.amber_id = c.author_amber_id AND u.deleted_at IS NULL
           LEFT JOIN media_assets m
             ON m.media_id = c.media_id AND m.deleted_at IS NULL AND m.status = 'ready'`,
        [ids],
      ),
    ]);
    for (const r of reactions) {
      const slot = out.get(String(r.post_id));
      if (!slot) continue;
      slot.reactions.counts[r.kind] = (slot.reactions.counts[r.kind] || 0) + 1;
      if (r.mine) slot.reactions.mine = r.kind;
    }
    for (const c of comments) {
      const slot = out.get(String(c.post_id));
      if (slot) slot.commentCount = Number(c.n) || 0;
    }
    const seenComments = new Set();
    for (const c of preview) {
      const slot = out.get(String(c.post_id));
      if (!slot) continue;
      // BELT AND BRACES for the same failure. One comment is one comment however
      // many times the query hands it over.
      if (seenComments.has(String(c.id))) continue;
      seenComments.add(String(c.id));
      slot.comments.push({
        commentId: String(c.id),
        text: c.text ?? "",
        createdAt: c.created_at,
        mine: String(c.amber_id) === String(me),
        audio: c.media_id
          ? {
              mediaId: String(c.media_id),
              durationMs: Number(c.duration_ms) || 0,
              peaks: Array.isArray(c.peaks) ? c.peaks.map(Number) : [],
            }
          : null,
        author: {
          amberId: String(c.amber_id),
          username: c.username ?? null,
          fullName: c.full_name ?? null,
          avatarUrl: c.avatar_url ?? null,
        },
      });
    }
    // Oldest-first within the two, so the card reads down the way a thread does.
    for (const slot of out.values()) {
      slot.comments.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    }
    return out;
  } catch (e) {
    // A feed that renders without its reaction counts is a degraded feed. A
    // feed that fails to render is not a feed.
    console.error(`SOCIAL_FOR_POSTS_ERR ${e?.message || e}`);
    return out;
  }
}
