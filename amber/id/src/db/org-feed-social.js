/**
 * THE CHEAP GESTURES — reactions, mentions, pinning, and files on a message.
 *
 * Separate from org-knowledge-store.js because that file already owns pages,
 * revisions, attachments, the drive and the feed itself, and a file that owns
 * six things is a file nobody reads before adding a seventh.
 *
 * WHY ANY OF THIS EXISTS. The feed had exactly two verbs: post, and reply. If
 * replying is the only way to respond, people who agree say nothing — so the
 * author cannot tell consensus from silence — and the ones who do respond fill
 * the thread with "+1" that buries the one reply worth reading. A one-click
 * acknowledgment is not decoration; it is the thing that makes an
 * asynchronous channel legible.
 */

import { query } from "./sql.js";
import { visibleClause } from "./org-audience-store.js";

/**
 * The six, and no more.
 *
 * Free-form emoji turns into a second messaging channel nobody can search:
 * twelve near-identical faces and a column somebody has to moderate. These
 * cover what a reaction is FOR at work — read it, agree, on it, nice, funny,
 * confused — and anybody needing more has a reply button. The database CHECK
 * is the real enforcement; this list is so the UI and the server agree.
 */
export const REACTIONS = ["👍", "🎉", "❤️", "👀", "😄", "🤔"];

/* -------------------------------------------------------------- reactions */

/**
 * Add or remove one reaction. Clicking the same one twice takes it back.
 *
 * A DELETE rather than an `active` flag, so there is no soft-deleted reaction
 * state for every count in the product to remember to filter out.
 *
 * THE POST IS CHECKED FOR VISIBILITY FIRST. Without it, reacting is an oracle:
 * a 200 means the post exists and a 404 means it does not, which tells
 * somebody outside the audience exactly what they were not allowed to know.
 */
export async function toggleReaction({ orgId, postId, amberId, emoji } = {}) {
  if (!orgId || !postId || !amberId) return { ok: false, reason: "bad_input" };
  if (!REACTIONS.includes(emoji)) return { ok: false, reason: "bad_emoji" };

  const { rows: seen } = await query(
    `SELECT 1 FROM org_posts p
      WHERE p.org_id = $1 AND p.id = $2 AND p.deleted_at IS NULL
        AND ${visibleClause({ alias: "p", itemType: "post", viewer: "$3" })}`,
    [orgId, postId, amberId],
  );
  if (seen.length === 0) return { ok: false, reason: "not_found" };

  const { rowCount } = await query(
    `DELETE FROM org_post_reactions
      WHERE org_id = $1 AND post_id = $2 AND amber_id = $3 AND emoji = $4`,
    [orgId, postId, amberId, emoji],
  );
  if (rowCount > 0) return { ok: true, on: false };

  await query(
    `INSERT INTO org_post_reactions (org_id, post_id, amber_id, emoji)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [orgId, postId, amberId, emoji],
  );
  return { ok: true, on: true };
}

/**
 * Who reacted, by name, for the hover.
 *
 * "7 👍" is a number. "Maya, Sagar and 5 others" is the thing somebody
 * actually wants to know, which is whether the person whose agreement matters
 * is in there.
 */
export async function reactionDetail({ orgId, postId } = {}) {
  if (!orgId || !postId) return [];
  const { rows } = await query(
    `SELECT r.emoji, COALESCE(u.full_name, 'Someone') AS name
       FROM org_post_reactions r
       LEFT JOIN users u ON u.amber_id = r.amber_id
      WHERE r.org_id = $1 AND r.post_id = $2
      ORDER BY r.emoji, r.created_at`,
    [orgId, postId],
  );
  const byEmoji = new Map();
  for (const r of rows) {
    if (!byEmoji.has(r.emoji)) byEmoji.set(r.emoji, []);
    byEmoji.get(r.emoji).push(r.name);
  }
  return [...byEmoji].map(([emoji, names]) => ({ emoji, names }));
}

/* --------------------------------------------------------------- mentions */

/**
 * Record who a post addresses.
 *
 * Rows rather than a parse of the body on every read: the body is display text
 * and will be edited, while "who was addressed" is a fact that has to survive
 * somebody fixing a typo in a name.
 *
 * A MENTION GRANTS NOTHING. Addressing somebody outside the audience does not
 * let them read the post — the audience predicate still decides and the
 * mention simply never surfaces for them. The alternative is a permission
 * model with a hole shaped like the @ key.
 */
export async function setMentions({ orgId, postId, amberIds = [] } = {}) {
  if (!orgId || !postId) return { ok: false, reason: "bad_input" };
  const ids = [...new Set((amberIds ?? []).map((x) => String(x ?? "").trim()).filter(Boolean))];

  await query(
    `DELETE FROM org_post_mentions WHERE org_id = $1 AND post_id = $2`,
    [orgId, postId],
  );
  if (ids.length === 0) return { ok: true, count: 0 };

  /*
   * ONLY ACTUAL MEMBERS. The ids arrive from a client, and a mention row
   * naming somebody who is not in this company would sit there forever being
   * counted by nothing and confusing anybody who read the table.
   */
  const { rowCount } = await query(
    `INSERT INTO org_post_mentions (org_id, post_id, amber_id)
     SELECT $1, $2, m.amber_id
       FROM org_members m
      WHERE m.org_id = $1 AND m.status = 'active' AND m.amber_id = ANY($3::uuid[])
     ON CONFLICT DO NOTHING`,
    [orgId, postId, ids],
  );
  return { ok: true, count: rowCount ?? 0 };
}

/**
 * How many posts are waiting on this person BY NAME.
 *
 * The number that earns a badge. A feed that badges every post trains people
 * to ignore the badge inside a week; one that means "somebody asked YOU
 * something" keeps meaning it.
 *
 * The audience predicate is applied here too, so a mention on a post somebody
 * cannot see is not a number they can never clear.
 */
export async function unreadMentions({ orgId, amberId } = {}) {
  if (!orgId || !amberId) return 0;
  const { rows } = await query(
    `SELECT count(*)::int AS n
       FROM org_post_mentions mn
       JOIN org_posts p ON p.org_id = mn.org_id AND p.id = mn.post_id
      WHERE mn.org_id = $1 AND mn.amber_id = $2::uuid
        AND mn.seen_at IS NULL
        AND p.deleted_at IS NULL
        AND p.author_id IS DISTINCT FROM $2::uuid
        AND ${visibleClause({ alias: "p", itemType: "post", viewer: "$2" })}`,
    [orgId, amberId],
  );
  return rows[0]?.n ?? 0;
}

/** Everything addressed to this person is now seen. */
export async function clearMentions({ orgId, amberId } = {}) {
  if (!orgId || !amberId) return { ok: false, reason: "bad_input" };
  await query(
    `UPDATE org_post_mentions SET seen_at = now()
      WHERE org_id = $1 AND amber_id = $2::uuid AND seen_at IS NULL`,
    [orgId, amberId],
  );
  return { ok: true };
}

/* ---------------------------------------------------------------- pinning */

/**
 * Pin or unpin. Admin-only, enforced in the route.
 *
 * A timestamp rather than a boolean, because the useful ordering of several
 * pinned posts is the order they were pinned in, and a boolean cannot say
 * that. A feed where anybody can pin their own post to the top is a feed
 * where everybody does.
 */
export async function setPinned({ orgId, postId, pinned, byId = null } = {}) {
  if (!orgId || !postId) return { ok: false, reason: "bad_input" };
  const { rows } = await query(
    `UPDATE org_posts
        SET pinned_at = CASE WHEN $3::boolean THEN now() ELSE NULL END,
            pinned_by = CASE WHEN $3::boolean THEN $4::uuid ELSE NULL END
      WHERE org_id = $1 AND id = $2 AND deleted_at IS NULL AND parent_id IS NULL
      RETURNING id, pinned_at`,
    [orgId, postId, Boolean(pinned), byId],
  );
  return rows[0] ? { ok: true, pinnedAt: rows[0].pinned_at } : { ok: false, reason: "not_found" };
}

/* ------------------------------------------------------- files on a post */

/**
 * The files shared in a message.
 *
 * These are ordinary drive rows with a post_id, not a parallel store — so a
 * deck posted to the feed is searchable by its contents, carries an audience,
 * and shows up in the drive like everything else. The alternative, a separate
 * message-attachments table, is a second place files live that none of those
 * features know about.
 */
export async function postFiles({ orgId, postIds = [] } = {}) {
  const ids = [...new Set((postIds ?? []).map((x) => String(x ?? "").trim()).filter(Boolean))];
  if (!orgId || ids.length === 0) return new Map();
  const { rows } = await query(
    `SELECT a.post_id, a.id, a.filename, a.title, a.content_type, a.byte_size
       FROM org_page_attachments a
      WHERE a.org_id = $1 AND a.post_id = ANY($2::uuid[])
        AND a.deleted_at IS NULL AND a.status = 'ready'
      ORDER BY a.created_at`,
    [orgId, ids],
  );
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.post_id)) out.set(r.post_id, []);
    out.get(r.post_id).push({
      id: r.id,
      filename: r.filename,
      title: r.title,
      contentType: r.content_type,
      byteSize: r.byte_size,
    });
  }
  return out;
}

/** Attach already-uploaded drive files to a post. */
export async function attachToPost({ orgId, postId, fileIds = [] } = {}) {
  const ids = [...new Set((fileIds ?? []).map((x) => String(x ?? "").trim()).filter(Boolean))];
  if (!orgId || !postId || ids.length === 0) return { ok: true, count: 0 };
  const { rowCount } = await query(
    `UPDATE org_page_attachments
        SET post_id = $2
      WHERE org_id = $1 AND id = ANY($3::uuid[]) AND deleted_at IS NULL`,
    [orgId, postId, ids],
  );
  return { ok: true, count: rowCount ?? 0 };
}

/**
 * Decorate a listing with its reactions' names and its files, in two queries
 * rather than two per post.
 */
export async function decorateFeed({ orgId, rows } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return list;
  const files = await postFiles({ orgId, postIds: list.map((r) => r.id) });
  for (const row of list) {
    row.files_list = files.get(row.id) ?? [];
  }
  return list;
}
