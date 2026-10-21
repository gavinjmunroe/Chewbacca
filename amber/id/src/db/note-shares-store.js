/**
 * VOICE-NOTE SHARING.
 *
 * What changed underneath: a note used to be identified by (owner_id uuid,
 * conversation_id TEXT) with no row anywhere representing the note itself, so its
 * visibility could not live in `shares` -- that table is keyed by an id, and there
 * was no id. It got its own additive table, `note_shares`, duplicating the whole
 * audience vocabulary.
 *
 * Now a note IS a row: `conversations`, kind 'note'. So its visibility is an
 * ordinary `shares` row with item_type = 'conversation', and there is exactly one
 * sharing table in the system again. `note_shares` is gone.
 *
 * ONE LIVE SCOPE PER NOTE, still. `shares` permits several rows per item (an
 * observation can be visible to a circle AND to one contact); a note is a single
 * post with a single audience, and the old PK (owner_id, conversation_id) enforced
 * that. Since the new table cannot express it as a constraint, setNoteShare
 * soft-deletes the note's other share rows inside the same transaction. That is a
 * weaker guarantee than a primary key and it is written down here so nobody
 * assumes otherwise.
 *
 * WRITE is owner-scoped: you can only share a note you own, to a circle or contact
 * you own. A client-supplied target id is never trusted -- it is checked against
 * the owner's own rows before anything is written.
 *
 * READ resolves the viewer through a real edge only: a live connection, being the
 * scoped contact, or being a current member of the scoped circle. Membership is
 * evaluated per query, so removing someone from a circle revokes every past note
 * in it on their next request. There is no snapshot of "who could see this".
 */

import { query, withTransaction } from "./sql.js";
import { KEY_TYPE } from "../lib/identity-keys.js";
import { VIEWER_REACH_SQL as _VIEWER_REACH } from "./viewer-reach.js";

// THE THIRD COPY OF THIS LIST, now the same object as the other two. One of
// them said network/circle/contact while the audience the predicate could
// resolve had grown, which is how a scope ends up accepted here and unresolvable
// there: the owner believes they shared something and nobody can read it.
const SCOPE_TYPES = new Set(REACHABLE_SCOPE_TYPES);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v) =>
  typeof v === "string" && UUID_RE.test(v.trim()) ? v.trim().toLowerCase() : null;

// The reach predicate lives in its own module now -- shares-store asks the same
// question about the same table, and two copies of an authorization rule drift.
// Re-exported so note-media-store's import does not have to move.
export { VIEWER_REACH_SQL } from "./viewer-reach.js";
import { SCOPE_TYPES as REACHABLE_SCOPE_TYPES } from "./viewer-reach.js";

// Does this note exist, as a note, under this owner?
async function _ownerOwnsNote(client, ownerId, conversationId) {
  const { rowCount } = await (client ?? { query }).query(
    `SELECT 1 FROM conversations
      WHERE conversation_id = $2 AND owner_id = $1 AND deleted_at IS NULL`,
    [ownerId, conversationId],
  );
  return rowCount > 0;
}

// Does the audience target belong to the owner? Never trust a client target id.
async function _ownerOwnsTarget(client, ownerId, scopeType, scopeRef) {
  if (scopeType === "network") return true;
  if (!scopeRef) return false;
  const run = client ?? { query };
  if (scopeType === "circle") {
    // MAY THIS PERSON POST HERE? The owner, or any CURRENT member -- resolved the
    // same two ways the read side resolves membership, so "can post" and "can
    // read" cannot disagree about who is in a circle.
    const { rowCount } = await run.query(
      `SELECT 1 FROM circles ci
        WHERE ci.id = $1 AND ci.deleted_at IS NULL
          AND (
            ci.owner_id = $2
            OR EXISTS (
              SELECT 1 FROM circle_members cm
                JOIN contacts c
                  ON c.id = cm.contact_id AND c.owner_id = ci.owner_id
                 AND c.deleted_at IS NULL
                LEFT JOIN contact_identity_keys k
                  ON k.owner_id = cm.owner_id AND k.contact_id = cm.contact_id
                 AND k.key_type = ${KEY_TYPE.PHONE}
                 AND k.key_hash IN (SELECT d.key_hash FROM discovery_keys d
                                     WHERE d.amber_id = $2 AND d.key_type = ${KEY_TYPE.PHONE})
               WHERE cm.circle_id = ci.id AND cm.owner_id = ci.owner_id
                 AND (c.linked_amber_id = $2 OR k.contact_id IS NOT NULL)
            )
          )`,
      [scopeRef, ownerId],
    );
    return rowCount > 0;
  }
  if (scopeType === "cohort") {
    // MAY THIS PERSON POST HERE? The owner, or a current member -- resolved the
    // same two ways the read side resolves it, so "can post" and "can read"
    // cannot disagree about who is in the audience.
    const { rowCount } = await run.query(
      `SELECT 1 FROM cohorts co
        WHERE co.id = $1 AND co.deleted_at IS NULL
          AND (
            co.owner_id = $2
            OR EXISTS (
              SELECT 1 FROM cohort_members cm
                JOIN contacts c
                  ON c.id = cm.contact_id AND c.owner_id = co.owner_id
                 AND c.deleted_at IS NULL
                LEFT JOIN contact_identity_keys k
                  ON k.owner_id = cm.owner_id AND k.contact_id = cm.contact_id
                 AND k.key_type = ${KEY_TYPE.PHONE}
                 AND k.key_hash IN (SELECT d.key_hash FROM discovery_keys d
                                     WHERE d.amber_id = $2 AND d.key_type = ${KEY_TYPE.PHONE})
               WHERE cm.cohort_id = co.id AND cm.owner_id = co.owner_id
                 AND (c.linked_amber_id = $2 OR k.contact_id IS NOT NULL)
            )
          )`,
      [scopeRef, ownerId],
    );
    return rowCount > 0;
  }
  if (scopeType === "contact") {
    const { rowCount } = await run.query(
      `SELECT 1 FROM contacts WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
      [scopeRef, ownerId],
    );
    return rowCount > 0;
  }
  return false;
}

/**
 * Set (or change) a note's share scope. `visibility` is
 * 'private' | 'network' | 'circle' | 'contact'; 'circle' and 'contact' require a
 * targetId belonging to the owner. 'private' un-shares.
 *
 * Returns { ok: true, visibility, targetId } or { ok: false, reason }, reason in
 * 'invalid' | 'note_not_found' | 'invalid_target' | 'error'. Unchanged.
 */
export async function setNoteShare(
  ownerId,
  conversationId,
  // sharerPhone is accepted and ignored: post rights now resolve through
  // discovery_keys, not through a number the caller hands us. The parameter stays
  // in the signature so no route has to change.
  { visibility, targetId = null, sharerPhone = null } = {},
) {
  const owner = asUuid(ownerId);
  const conv = asUuid(conversationId);
  if (!owner || !conv || typeof visibility !== "string") return { ok: false, reason: "invalid" };

  if (visibility === "private") {
    try {
      await query(
        `UPDATE shares SET deleted_at = now()
          WHERE owner_id = $1 AND item_type = 'conversation' AND item_id = $2
            AND deleted_at IS NULL`,
        [owner, conv],
      );
      return { ok: true, visibility: "private", targetId: null };
    } catch (e) {
      console.error(`UNSHARE_NOTE_ERR ${e?.stack || e?.message || e}`);
      return { ok: false, reason: "error" };
    }
  }

  if (!SCOPE_TYPES.has(visibility)) return { ok: false, reason: "invalid" };
  const ref = visibility === "network" ? null : asUuid(targetId);
  if (visibility !== "network" && !ref) return { ok: false, reason: "invalid_target" };

  try {
    return await withTransaction(async (client) => {
      if (!(await _ownerOwnsNote(client, owner, conv))) {
        return { ok: false, reason: "note_not_found" };
      }
      if (!(await _ownerOwnsTarget(client, owner, visibility, ref))) {
        return { ok: false, reason: "invalid_target" };
      }
      // ONE LIVE SCOPE. Retire whatever was there before, in the same
      // transaction, so the note is never briefly visible to two audiences and
      // never briefly visible to none.
      await client.query(
        `UPDATE shares SET deleted_at = now()
          WHERE owner_id = $1 AND item_type = 'conversation' AND item_id = $2
            AND deleted_at IS NULL
            AND NOT (scope_type = $3
                     AND COALESCE(scope_ref, '00000000-0000-0000-0000-000000000000'::uuid)
                       = COALESCE($4::uuid, '00000000-0000-0000-0000-000000000000'::uuid))`,
        [owner, conv, visibility, ref],
      );
      // Re-sharing to the SAME audience re-times it, so it sorts to the top of
      // their feed and re-triggers their unseen dot -- the old ON CONFLICT DO
      // UPDATE ... created_at = now() did exactly this.
      await client.query(
        `INSERT INTO shares (owner_id, item_type, item_id, scope_type, scope_ref)
         VALUES ($1, 'conversation', $2, $3, $4)
         ON CONFLICT (owner_id, item_type, item_id, scope_type,
                      COALESCE(scope_ref, '00000000-0000-0000-0000-000000000000'::uuid))
           WHERE deleted_at IS NULL
           DO UPDATE SET created_at = now()`,
        [owner, conv, visibility, ref],
      );
      return { ok: true, visibility, targetId: ref };
    });
  } catch (e) {
    // LOGGED, not just swallowed. A bare `catch {}` here is what hid the
    // `operator does not exist: uuid = text` failure for weeks: the query raised,
    // the catch turned it into a plausible-looking empty answer, and nothing
    // anywhere said so. The return shape stays what callers expect.
    console.error(`SET_NOTE_SHARE_ERR ${e?.stack || e?.message || e}`);
    return { ok: false, reason: "error" };
  }
}

/**
 * The current scope of one of the owner's notes, for the share sheet.
 * Owner-scoped. Shape unchanged: { visibility, targetId, targetName }.
 */
export async function getNoteShare(ownerId, conversationId) {
  const owner = asUuid(ownerId);
  const conv = asUuid(conversationId);
  const PRIVATE = { visibility: "private", targetId: null, targetName: null };
  if (!owner || !conv) return PRIVATE;
  try {
    const { rows } = await query(
      `SELECT s.scope_type, s.scope_ref,
              ci.name AS circle_name,
              COALESCE(ct.full_name,
                NULLIF(TRIM(CONCAT_WS(' ', ct.first_name, ct.last_name)), '')) AS contact_name
         FROM shares s
         LEFT JOIN circles  ci ON s.scope_type = 'circle'  AND ci.id = s.scope_ref
         LEFT JOIN contacts ct ON s.scope_type = 'contact' AND ct.id = s.scope_ref
        WHERE s.owner_id = $1 AND s.item_type = 'conversation' AND s.item_id = $2
          AND s.deleted_at IS NULL
        ORDER BY s.created_at DESC
        LIMIT 1`,
      [owner, conv],
    );
    if (rows.length === 0) return PRIVATE;
    const r = rows[0];
    return {
      visibility: r.scope_type,
      targetId: r.scope_ref != null ? String(r.scope_ref) : null,
      targetName: r.circle_name ?? r.contact_name ?? null,
    };
  } catch (e) {
    console.error(`GET_NOTE_SHARE_ERR ${e?.stack || e?.message || e}`);
    return PRIVATE;
  }
}

/** Retire every share row for a note (called when the note itself is deleted). */
export async function deleteNoteSharesForConversation(ownerId, conversationId) {
  const owner = asUuid(ownerId);
  const conv = asUuid(conversationId);
  if (!owner || !conv) return 0;
  try {
    const { rowCount } = await query(
      `UPDATE shares SET deleted_at = now()
        WHERE owner_id = $1 AND item_type = 'conversation' AND item_id = $2
          AND deleted_at IS NULL`,
      [owner, conv],
    );
    return rowCount ?? 0;
  } catch (e) {
    console.error(`DELETE_NOTE_SHARES_ERR ${e?.stack || e?.message || e}`);
    return 0;
  }
}

// A note's transcript: its user turns, in order, falling back to the whole thread
// when there are none. Correlated to the SHARER's conversation, so a recipient
// reads the sharer's note and not their own.
const _TRANSCRIPT_LATERAL = `LEFT JOIN LATERAL (
  SELECT COALESCE(
           string_agg(m.content, E'\\n' ORDER BY m.created_at)
             FILTER (WHERE m.role = 'user'),
           string_agg(m.content, E'\\n' ORDER BY m.created_at)
         ) AS transcript
    FROM conversation_messages m
   WHERE m.conversation_id = s.item_id
     AND m.deleted_at IS NULL
) tx ON true`;

function _mapFeedRow(r) {
  const item = {
    noteId: String(r.item_id),
    shareType: r.scope_type,
    transcript: r.transcript,
    sharedAt: r.created_at ?? null,
    sharedBy: {
      amberId: String(r.owner_id),
      name: r.owner_name ?? null,
      username: r.owner_username ?? null,
      avatarUrl: r.owner_avatar ?? null,
    },
  };
  if (r.scope_type === "circle") {
    item.circleId = r.scope_ref != null ? String(r.scope_ref) : null;
    item.circleName = r.circle_name ?? null;
  }
  return item;
}

/**
 * Every voice note shared WITH this viewer, newest first. Notes whose transcript
 * resolves to nothing (thread deleted) are dropped, so a deleted note never
 * surfaces even if its share row lingers.
 */
export async function getSharedNotesForViewer(viewerAmberId, viewerPhone, { limit = 100, from = null, to = null } = {}) {
  const viewer = asUuid(viewerAmberId);
  if (!viewer) return [];
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 200);
  try {
    const { rows } = await query(
      `SELECT s.item_id, s.scope_type, s.scope_ref, s.created_at, s.owner_id,
              ou.full_name AS owner_name, ou.username AS owner_username,
              ou.avatar_url AS owner_avatar,
              ci.name AS circle_name,
              tx.transcript
         FROM shares s
         JOIN conversations cv
           ON cv.conversation_id = s.item_id AND cv.deleted_at IS NULL
         JOIN users ou ON ou.amber_id = s.owner_id AND ou.deleted_at IS NULL
         LEFT JOIN circles ci
           ON s.scope_type = 'circle' AND ci.id = s.scope_ref AND ci.deleted_at IS NULL
         ${_TRANSCRIPT_LATERAL}
        WHERE s.item_type = 'conversation'
          AND s.deleted_at IS NULL
          AND s.owner_id <> $1
          AND ($3::timestamptz IS NULL OR s.created_at >= $3::timestamptz)
          AND ($4::timestamptz IS NULL OR s.created_at < $4::timestamptz)
          AND tx.transcript IS NOT NULL
          AND ${_VIEWER_REACH}
        ORDER BY s.created_at DESC
        LIMIT $2`,
      [viewer, lim, from, to],
    );
    return rows.map(_mapFeedRow);
  } catch (e) {
    console.error(`SHARED_NOTES_ERR ${e?.stack || e?.message || e}`);
    return [];
  }
}

// Can the viewer read circle C's feed? They own it, or are a current member.
async function _viewerCanAccessCircle(viewerAmberId, circleId) {
  const { rowCount } = await query(
    `SELECT 1
       FROM circles ci
      WHERE ci.id = $2 AND ci.deleted_at IS NULL
        AND (
          ci.owner_id = $1
          OR EXISTS (
            SELECT 1 FROM circle_members cm
              JOIN contacts c
                ON c.id = cm.contact_id AND c.owner_id = ci.owner_id
               AND c.deleted_at IS NULL
              LEFT JOIN contact_identity_keys k
                ON k.owner_id = cm.owner_id AND k.contact_id = cm.contact_id
               AND k.key_type = ${KEY_TYPE.PHONE}
        AND k.key_hash IN (SELECT d.key_hash FROM discovery_keys d
                            WHERE d.amber_id = $1 AND d.key_type = ${KEY_TYPE.PHONE})
             WHERE cm.circle_id = ci.id AND cm.owner_id = ci.owner_id
               AND (c.linked_amber_id = $1 OR k.contact_id IS NOT NULL)
          )
        )`,
    [viewerAmberId, circleId],
  );
  return rowCount > 0;
}

/**
 * One circle's feed, newest first. Returns null when the viewer is neither owner
 * nor current member (callers translate null to 404). An optional `q` filters on
 * transcript, parameterized -- searching a circle you cannot see still 404s,
 * because the access check runs first and identically either way.
 */
export async function getCircleNoteFeed(
  viewerAmberId,
  viewerPhone,
  circleId,
  { limit = 100, q = null } = {},
) {
  const viewer = asUuid(viewerAmberId);
  const id = asUuid(circleId);
  if (!viewer || !id) return null;
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 200);
  const needle = typeof q === "string" ? q.trim() : "";
  try {
    if (!(await _viewerCanAccessCircle(viewer, id))) return null;
    const params = [id, lim];
    let transcriptFilter = "";
    if (needle) {
      params.push(`%${needle}%`);
      transcriptFilter = `AND tx.transcript ILIKE $${params.length}`;
    }
    const { rows } = await query(
      `SELECT s.item_id, s.scope_type, s.scope_ref, s.created_at, s.owner_id,
              ou.full_name AS owner_name, ou.username AS owner_username,
              ou.avatar_url AS owner_avatar,
              ci.name AS circle_name,
              tx.transcript
         FROM shares s
         JOIN conversations cv
           ON cv.conversation_id = s.item_id AND cv.deleted_at IS NULL
         JOIN users ou ON ou.amber_id = s.owner_id AND ou.deleted_at IS NULL
         JOIN circles ci ON ci.id = s.scope_ref AND ci.deleted_at IS NULL
         ${_TRANSCRIPT_LATERAL}
        WHERE s.item_type = 'conversation'
          AND s.deleted_at IS NULL
          AND s.scope_type = 'circle'
          AND s.scope_ref = $1
          AND tx.transcript IS NOT NULL
          ${transcriptFilter}
        ORDER BY s.created_at DESC
        LIMIT $2`,
      params,
    );
    return rows.map(_mapFeedRow);
  } catch (e) {
    console.error(`CIRCLE_NOTE_FEED_ERR ${e?.stack || e?.message || e}`);
    return null;
  }
}

/**
 * Unseen circle-share counts, for the glowing dot. Map of circleId -> count,
 * non-zero entries only. A circle the viewer owns yields 0, because its shares
 * are authored by the viewer.
 */
export async function getUnseenCircleShareCounts(viewerAmberId, viewerPhone, circleIds = []) {
  const viewer = asUuid(viewerAmberId);
  const ids = (circleIds || []).map(asUuid).filter(Boolean);
  if (!viewer || ids.length === 0) return new Map();
  try {
    const { rows } = await query(
      `SELECT s.scope_ref AS circle_id, count(*)::int AS cnt
         FROM shares s
         JOIN conversations cv
           ON cv.conversation_id = s.item_id AND cv.deleted_at IS NULL
         LEFT JOIN circle_member_seen cs
           ON cs.viewer_amber_id = $1 AND cs.circle_id = s.scope_ref
        WHERE s.item_type = 'conversation'
          AND s.deleted_at IS NULL
          AND s.scope_type = 'circle'
          AND s.scope_ref = ANY($2::uuid[])
          AND s.owner_id <> $1
          AND s.created_at > COALESCE(cs.seen_at, 'epoch'::timestamptz)
          AND ${_VIEWER_REACH}
        GROUP BY s.scope_ref`,
      [viewer, ids],
    );
    const out = new Map();
    for (const r of rows) out.set(String(r.circle_id), r.cnt ?? 0);
    return out;
  } catch (e) {
    console.error(`UNSEEN_CIRCLE_SHARES_ERR ${e?.stack || e?.message || e}`);
    return new Map();
  }
}

/**
 * Mark a circle's feed seen (advances seen_at to now()), clearing its dot.
 * Idempotent. ADVANCES rather than inserts-once, so later shares re-trigger the
 * dot until the feed is opened again.
 */
export async function markCircleFeedSeen(viewerAmberId, circleId) {
  const viewer = asUuid(viewerAmberId);
  const id = asUuid(circleId);
  if (!viewer || !id) return false;
  try {
    await query(
      `INSERT INTO circle_member_seen (viewer_amber_id, circle_id)
       VALUES ($1, $2)
       ON CONFLICT (viewer_amber_id, circle_id) DO UPDATE SET seen_at = now()`,
      [viewer, id],
    );
    return true;
  } catch (e) {
    console.error(`MARK_CIRCLE_SEEN_ERR ${e?.stack || e?.message || e}`);
    return false;
  }
}
