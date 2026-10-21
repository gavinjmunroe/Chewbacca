/**
 * Direct messages: one thread per pair of Amber users.
 *
 * SCHEMA LIVES IN db/migrations/20260826_add_dm_tables.sql, applied by
 * `npm run migrate`. This module creates nothing. It used to: every public
 * function awaited an ensureDmTables() that ran CREATE TABLE IF NOT EXISTS at
 * request time, which meant the database could not be rebuilt — drop a table and
 * the next request silently recreated it in its old shape.
 *
 * THE PAIR IS CANONICAL. `a_amber_id` is always the lexicographically smaller
 * uuid and `b_amber_id` the larger, enforced by a CHECK plus a UNIQUE. Two
 * people opening each other's chat at the same instant therefore cannot create
 * two threads — the second insert loses to the constraint rather than to a race
 * in application code, and ON CONFLICT turns that loss into a read.
 *
 * SECURITY INVARIANT: no function here takes a thread id without also taking the
 * caller's amber_id, and every statement re-checks participation in its own
 * WHERE clause. There is no "load the thread then check" path, because that is
 * the shape that leaks when someone forgets the second half.
 *
 * DELETING A THREAD IS PER-PERSON. "Delete the direct message" clears YOUR copy
 * by recording a high-water mark in dm_clears; it does not reach across and
 * destroy the other person's history, which is not yours to delete. Their thread
 * is untouched, and a new message re-opens yours.
 */
import { query } from "./sql.js";
import { noteMissingColumn } from "./optional-column.js";

// One reaction set for the whole app -- and it is one list now rather than
// three identical ones. The name is kept because callers import it; the values
// come from lib/reaction-kinds.js, which is also what the migration that widens
// every CHECK constraint is written against.
// IMPORTED AND RE-EXPORTED, for the same reason as note-media-store: a bare
// `export { X as Y } from` gives this module no local Y, and setDmReaction reads
// DM_REACTION_KINDS a few hundred lines down. It had not crashed yet only
// because nobody had reacted to a direct message since the vocabulary was
// centralized -- it would have thrown the first time somebody did.
import { REACTION_KINDS as DM_REACTION_KINDS } from "../lib/reaction-kinds.js";
export { DM_REACTION_KINDS };

const MAX_BODY = 4000;
export const DM_MAX_AUDIO_BYTES = 12 * 1024 * 1024;
export const DM_MAX_AUDIO_MS = 5 * 60 * 1000;


const _uuid = (v) =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.trim())
    ? v.trim().toLowerCase()
    : null;

const _id = (v) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/** The canonical (a, b) ordering for a pair. Null if either id is not a uuid. */
export function pairKey(x, y) {
  const a = _uuid(x);
  const b = _uuid(y);
  if (!a || !b || a === b) return null;
  return a < b ? { a, b } : { a: b, b: a };
}

/**
 * The thread for a pair, creating it on first use.
 *
 * ON CONFLICT DO NOTHING then SELECT, rather than "select, then insert if
 * missing": two devices opening the same chat simultaneously both run this, and
 * only the UNIQUE constraint can decide the winner correctly.
 */
export async function getOrCreateThread(meAmberId, otherAmberId) {
  const pair = pairKey(meAmberId, otherAmberId);
  if (!pair) return null;
  try {
    await query(
      `INSERT INTO dm_threads (a_amber_id, b_amber_id)
       VALUES ($1::uuid, $2::uuid)
       ON CONFLICT (a_amber_id, b_amber_id) DO NOTHING`,
      [pair.a, pair.b],
    );
    const { rows } = await query(
      `SELECT id, a_amber_id, b_amber_id, last_message_at
         FROM dm_threads WHERE a_amber_id = $1::uuid AND b_amber_id = $2::uuid`,
      [pair.a, pair.b],
    );
    if (!rows[0]) return null;
    return {
      id: String(rows[0].id),
      otherAmberId: String(
        String(rows[0].a_amber_id) === _uuid(meAmberId)
          ? rows[0].b_amber_id
          : rows[0].a_amber_id,
      ),
      lastMessageAt: rows[0].last_message_at,
    };
  } catch (err) {
    console.error(`DM_THREAD_ERR ${err?.message || err}`);
    return null;
  }
}

/**
 * The other participant's amber_id, or null when the caller is not in this
 * thread. Every mutating call goes through this first: it is both the
 * authorization check and the thing we need for the push notification, so there
 * is no way to do one without the other.
 */
export async function threadCounterparty(threadId, meAmberId) {
  const tid = _id(threadId);
  const me = _uuid(meAmberId);
  if (!tid || !me) return null;
  try {
    const { rows } = await query(
      `SELECT CASE WHEN a_amber_id = $2::uuid THEN b_amber_id ELSE a_amber_id END AS other
         FROM dm_threads
        WHERE id = $1 AND (a_amber_id = $2::uuid OR b_amber_id = $2::uuid)`,
      [tid, me],
    );
    return rows[0] ? String(rows[0].other) : null;
  } catch {
    return null;
  }
}

/**
 * Blocking moved to db/blocks-store.js, and these two are re-exported so the
 * DM routes keep their imports.
 *
 * WHY IT MOVED. The only code that ever consulted dm_blocks was in routes/dms.js,
 * so a block stopped direct messages and nothing else -- a blocked person could
 * still send a connection request, ask for an intro, and put a push on your lock
 * screen with their name on it. Living in a file called dm-store is most of why
 * nobody thought to ask it anywhere else.
 *
 * The other half of the move is that it now fails CLOSED. This version returned
 * false on any error, so a database blip un-blocked everybody for its duration,
 * silently. See the header of blocks-store.js.
 */
export { blocksInteraction as isBlockedBetween, setBlock } from "./blocks-store.js";

/**
 * Every thread the caller has, newest activity first, with the last message, the
 * unread count and the counterparty's public profile.
 *
 * A thread the caller has cleared and that has had no new message since is
 * omitted: they deleted it, and a row that comes back empty is the same bug as a
 * confirmation card that will not go away.
 */
export async function listThreads(meAmberId, { limit = 50 } = {}) {
  const me = _uuid(meAmberId);
  if (!me) return [];
  const cap = Math.min(Math.max(Number(limit) || 50, 1), 100);
  try {
    const { rows } = await query(
      `WITH mine AS (
         SELECT t.id,
                CASE WHEN t.a_amber_id = $1::uuid THEN t.b_amber_id ELSE t.a_amber_id END AS other_id,
                COALESCE(cl.cleared_before_id, 0) AS cleared,
                COALESCE(rd.last_read_message_id, 0) AS last_read
           FROM dm_threads t
           LEFT JOIN dm_clears cl ON cl.thread_id = t.id AND cl.amber_id = $1::uuid
           LEFT JOIN dm_reads  rd ON rd.thread_id = t.id AND rd.amber_id = $1::uuid
          WHERE t.a_amber_id = $1::uuid OR t.b_amber_id = $1::uuid
       ),
       last AS (
         SELECT DISTINCT ON (m.thread_id)
                m.thread_id, m.id, m.kind, m.body, m.duration_ms,
                m.sender_amber_id, m.created_at
           FROM dm_messages m
           JOIN mine ON mine.id = m.thread_id
          WHERE m.deleted_at IS NULL AND m.id > mine.cleared
          ORDER BY m.thread_id, m.id DESC
       ),
       unread AS (
         SELECT m.thread_id, COUNT(*)::int AS n
           FROM dm_messages m
           JOIN mine ON mine.id = m.thread_id
          WHERE m.deleted_at IS NULL
            AND m.id > GREATEST(mine.cleared, mine.last_read)
            AND m.sender_amber_id <> $1::uuid
          GROUP BY m.thread_id
       )
       SELECT mine.id, mine.other_id,
              u.username, u.full_name, u.avatar_url,
              last.id AS last_id, last.kind AS last_kind, last.body AS last_body,
              last.duration_ms AS last_duration_ms,
              last.sender_amber_id AS last_sender, last.created_at AS last_at,
              COALESCE(unread.n, 0) AS unread,
              -- THE VIEWER'S OWN CARD FOR THEM. The thread knows the account;
              -- everything else in the app is keyed by contact -- their card,
              -- their facts, their rank -- so without this the Info tab could
              -- show a name and nothing else. linked_amber_id is the only
              -- honest join (see db/identity-link.js); a name match would be a
              -- guess about which of the owner's contacts this account is.
              cc.id AS contact_id,
              EXISTS (
                SELECT 1 FROM dm_blocks b
                 WHERE b.blocker_amber_id = $1::uuid AND b.blocked_amber_id = mine.other_id
              ) AS blocked
         FROM mine
         LEFT JOIN last   ON last.thread_id = mine.id
         LEFT JOIN unread ON unread.thread_id = mine.id
         LEFT JOIN users u ON u.amber_id = mine.other_id AND u.deleted_at IS NULL
         -- LATERAL WITH A LIMIT, not a plain LEFT JOIN: two cards linked to the
         -- same account (a duplicate the merge has not caught yet) would
         -- otherwise DOUBLE the thread in the list.
         LEFT JOIN LATERAL (
           SELECT c2.id FROM contacts c2
            WHERE c2.owner_id = $1::uuid
              AND c2.linked_amber_id = mine.other_id
              AND c2.deleted_at IS NULL
            ORDER BY c2.updated_at DESC NULLS LAST
            LIMIT 1
         ) cc ON true
        WHERE last.id IS NOT NULL
        ORDER BY last.created_at DESC
        LIMIT $2`,
      [me, cap],
    );
    return rows.map((r) => ({
      threadId: String(r.id),
      other: {
        amberId: String(r.other_id),
        username: r.username ?? null,
        name: r.full_name ?? null,
        avatarUrl: r.avatar_url ?? null,
        contactId: r.contact_id ? String(r.contact_id) : null,
      },
      unread: Number(r.unread) || 0,
      blocked: !!r.blocked,
      last: {
        id: String(r.last_id),
        kind: r.last_kind,
        // A voice message's preview IS its transcript when there is one; the
        // duration is the fallback, because "Voice message" tells you nothing
        // about whether it is worth opening.
        body: r.last_body ?? null,
        durationMs: Number(r.last_duration_ms) || 0,
        mine: String(r.last_sender) === me,
        createdAt: r.last_at,
      },
    }));
  } catch (err) {
    console.error(`DM_LIST_ERR ${err?.message || err}`);
    return [];
  }
}

function _shapeMessage(r, me) {
  const raw = Array.isArray(r.reactions) ? r.reactions : [];
  const counts = {};
  let mine = null;
  for (const item of raw) {
    if (!item?.kind) continue;
    counts[item.kind] = (counts[item.kind] || 0) + 1;
    if (item.mine) mine = item.kind;
  }
  return {
    id: String(r.id),
    mine: String(r.sender_amber_id) === me,
    kind: r.kind,
    body: r.body ?? null,
    durationMs: Number(r.duration_ms) || 0,
    byteSize: Number(r.byte_size) || 0,
    peaks: Array.isArray(r.peaks) ? r.peaks.map((p) => Number(p) || 0) : [],
    audioStatus: r.audio_status,
    createdAt: r.created_at,
    reactions: { counts, mine },
  };
}

/** One page of a thread, newest first. `before` is an exclusive message id. */
export async function listMessages(threadId, meAmberId, { limit = 40, before = null } = {}) {
  const tid = _id(threadId);
  const me = _uuid(meAmberId);
  if (!tid || !me) return [];
  const cap = Math.min(Math.max(Number(limit) || 40, 1), 100);
  const beforeId = _id(before);
  try {
    const { rows } = await query(
      `SELECT m.id, m.sender_amber_id, m.kind, m.body, m.duration_ms, m.byte_size,
              m.peaks, m.audio_status, m.created_at,
              COALESCE(
                (SELECT json_agg(json_build_object(
                          'kind', r.kind,
                          'mine', r.reactor_amber_id = $2::uuid))
                   FROM dm_reactions r WHERE r.message_id = m.id),
                '[]'::json
              ) AS reactions
         FROM dm_messages m
         JOIN dm_threads t ON t.id = m.thread_id
         LEFT JOIN dm_clears cl ON cl.thread_id = t.id AND cl.amber_id = $2::uuid
        WHERE m.thread_id = $1
          AND (t.a_amber_id = $2::uuid OR t.b_amber_id = $2::uuid)
          AND m.deleted_at IS NULL
          AND m.id > COALESCE(cl.cleared_before_id, 0)
          AND ($3::bigint IS NULL OR m.id < $3::bigint)
        ORDER BY m.id DESC
        LIMIT $4`,
      [tid, me, beforeId, cap],
    );
    return rows.map((r) => _shapeMessage(r, me));
  } catch (err) {
    console.error(`DM_MESSAGES_ERR ${err?.message || err}`);
    return [];
  }
}

/**
 * Keyword search across one thread's transcripts, newest first.
 *
 * ILIKE over the body, which is the transcript for a voice message and the text
 * for a typed one — so searching finds what was SAID in a voice memo, not just
 * what was typed. `%` and `_` in the needle are escaped, or a query containing
 * one silently matches everything.
 */
export async function searchThread(threadId, meAmberId, q, { limit = 50 } = {}) {
  const tid = _id(threadId);
  const me = _uuid(meAmberId);
  const needle = typeof q === "string" ? q.trim() : "";
  if (!tid || !me || needle.length < 2) return [];
  const escaped = needle.replace(/([%_\\])/g, "\\$1");
  const cap = Math.min(Math.max(Number(limit) || 50, 1), 100);
  try {
    const { rows } = await query(
      `SELECT m.id, m.sender_amber_id, m.kind, m.body, m.duration_ms, m.byte_size,
              m.peaks, m.audio_status, m.created_at, '[]'::json AS reactions
         FROM dm_messages m
         JOIN dm_threads t ON t.id = m.thread_id
         LEFT JOIN dm_clears cl ON cl.thread_id = t.id AND cl.amber_id = $2::uuid
        WHERE m.thread_id = $1
          AND (t.a_amber_id = $2::uuid OR t.b_amber_id = $2::uuid)
          AND m.deleted_at IS NULL
          AND m.id > COALESCE(cl.cleared_before_id, 0)
          AND m.body ILIKE '%' || $3 || '%'
        ORDER BY m.id DESC
        LIMIT $4`,
      [tid, me, escaped, cap],
    );
    return rows.map((r) => _shapeMessage(r, me));
  } catch (err) {
    console.error(`DM_SEARCH_ERR ${err?.message || err}`);
    return [];
  }
}

async function _touch(threadId) {
  await query(`UPDATE dm_threads SET last_message_at = now() WHERE id = $1`, [
    threadId,
  ]).catch(() => null);
}

/** Insert a text message. Returns the shaped row, or null. */
export async function insertTextMessage(threadId, senderAmberId, body) {
  const tid = _id(threadId);
  const me = _uuid(senderAmberId);
  const text = typeof body === "string" ? body.trim().slice(0, MAX_BODY) : "";
  if (!tid || !me || !text) return null;
  try {
    const { rows } = await query(
      `INSERT INTO dm_messages (thread_id, sender_amber_id, kind, body, audio_status)
       VALUES ($1, $2::uuid, 'text', $3, 'none')
       RETURNING id, sender_amber_id, kind, body, duration_ms, byte_size, peaks,
                 audio_status, created_at, '[]'::json AS reactions`,
      [tid, me, text],
    );
    if (!rows[0]) return null;
    await _touch(tid);
    return _shapeMessage(rows[0], me);
  } catch (err) {
    console.error(`DM_SEND_ERR ${err?.message || err}`);
    return null;
  }
}

/**
 * Reserve a voice message and hand back its id + object key.
 *
 * The row is written FIRST, as 'pending', so the storage key is minted and owned
 * by the server rather than accepted from the client. A clip that never finishes
 * uploading leaves a pending row that is never served (every read filters on
 * audio_status), which is the right failure: no half-playable message.
 */
export async function reserveVoiceMessage(threadId, senderAmberId, { contentType = "audio/m4a" } = {}) {
  const tid = _id(threadId);
  const me = _uuid(senderAmberId);
  if (!tid || !me) return null;
  const type = /^audio\/[a-z0-9+.-]{1,40}$/i.test(String(contentType))
    ? String(contentType).toLowerCase()
    : "audio/m4a";
  try {
    const { rows } = await query(
      `INSERT INTO dm_messages (thread_id, sender_amber_id, kind, content_type, audio_status)
       VALUES ($1, $2::uuid, 'voice', $3, 'pending')
       RETURNING id`,
      [tid, me, type],
    );
    if (!rows[0]) return null;
    const messageId = String(rows[0].id);
    const storageKey = `dm/${tid}/${messageId}.m4a`;
    await query(`UPDATE dm_messages SET storage_key = $2 WHERE id = $1`, [
      messageId,
      storageKey,
    ]);
    return { messageId, storageKey, contentType: type };
  } catch (err) {
    console.error(`DM_VOICE_RESERVE_ERR ${err?.message || err}`);
    return null;
  }
}

/**
 * Mark a reserved voice message ready. `byteSize` comes from the bucket, never
 * from the client — the route HEADs the object before calling this.
 */
export async function finalizeVoiceMessage(
  messageId,
  senderAmberId,
  { durationMs, byteSize, peaks, transcript },
) {
  const mid = _id(messageId);
  const me = _uuid(senderAmberId);
  if (!mid || !me) return null;
  const dur = Math.max(0, Math.min(DM_MAX_AUDIO_MS, Math.round(Number(durationMs) || 0)));
  const size = Math.max(0, Math.round(Number(byteSize) || 0));
  const wave = Array.isArray(peaks)
    ? peaks.slice(0, 400).map((p) => Math.max(0, Math.min(100, Math.round(Number(p) || 0))))
    : [];
  const text =
    typeof transcript === "string" && transcript.trim()
      ? transcript.trim().slice(0, MAX_BODY)
      : null;
  try {
    const { rows } = await query(
      `UPDATE dm_messages
          SET audio_status = 'ready', duration_ms = $3, byte_size = $4,
              peaks = $5::smallint[], body = COALESCE($6, body)
        WHERE id = $1 AND sender_amber_id = $2::uuid AND kind = 'voice'
              AND deleted_at IS NULL
        RETURNING id, thread_id, sender_amber_id, kind, body, duration_ms, byte_size,
                  peaks, audio_status, created_at, '[]'::json AS reactions`,
      [mid, me, dur, size, wave, text],
    );
    if (!rows[0]) return null;
    await _touch(rows[0].thread_id);
    return _shapeMessage(rows[0], me);
  } catch (err) {
    console.error(`DM_VOICE_FINALIZE_ERR ${err?.message || err}`);
    return null;
  }
}

/** The object key for a message, only if the caller is in its thread. */
export async function audioKeyFor(messageId, meAmberId) {
  const mid = _id(messageId);
  const me = _uuid(meAmberId);
  if (!mid || !me) return null;
  try {
    const { rows } = await query(
      `SELECT m.storage_key, m.content_type, m.duration_ms, m.byte_size, m.peaks
         FROM dm_messages m
         JOIN dm_threads t ON t.id = m.thread_id
        WHERE m.id = $1
          AND (t.a_amber_id = $2::uuid OR t.b_amber_id = $2::uuid)
          AND m.kind = 'voice' AND m.audio_status = 'ready'
          AND m.deleted_at IS NULL`,
      [mid, me],
    );
    if (!rows[0]?.storage_key) return null;
    return {
      storageKey: String(rows[0].storage_key),
      contentType: rows[0].content_type || "audio/m4a",
      durationMs: Number(rows[0].duration_ms) || 0,
      byteSize: Number(rows[0].byte_size) || 0,
      peaks: Array.isArray(rows[0].peaks) ? rows[0].peaks.map((p) => Number(p) || 0) : [],
    };
  } catch {
    return null;
  }
}

/**
 * Set or clear the caller's reaction on a message they can see.
 * `kind: null` clears. Returns the message's new reaction summary, or null when
 * the message is not in a thread the caller belongs to.
 */
export async function setReaction(messageId, meAmberId, kind) {
  const mid = _id(messageId);
  const me = _uuid(meAmberId);
  if (!mid || !me) return null;
  if (kind !== null && !DM_REACTION_KINDS.includes(kind)) return null;
  try {
    const { rows: allowed } = await query(
      `SELECT 1 FROM dm_messages m JOIN dm_threads t ON t.id = m.thread_id
        WHERE m.id = $1 AND (t.a_amber_id = $2::uuid OR t.b_amber_id = $2::uuid)
              AND m.deleted_at IS NULL LIMIT 1`,
      [mid, me],
    );
    if (allowed.length === 0) return null;
    if (kind === null) {
      await query(
        `DELETE FROM dm_reactions WHERE message_id = $1 AND reactor_amber_id = $2::uuid`,
        [mid, me],
      );
    } else {
      await query(
        `INSERT INTO dm_reactions (message_id, reactor_amber_id, kind)
         VALUES ($1, $2::uuid, $3)
         ON CONFLICT (message_id, reactor_amber_id)
           DO UPDATE SET kind = EXCLUDED.kind, created_at = now()`,
        [mid, me, kind],
      );
    }
    const { rows } = await query(
      `SELECT kind, reactor_amber_id = $2::uuid AS mine
         FROM dm_reactions WHERE message_id = $1`,
      [mid, me],
    );
    const counts = {};
    let minePick = null;
    for (const r of rows) {
      counts[r.kind] = (counts[r.kind] || 0) + 1;
      if (r.mine) minePick = r.kind;
    }
    return { counts, mine: minePick };
  } catch (err) {
    console.error(`DM_REACT_ERR ${err?.message || err}`);
    return null;
  }
}

/** Advance the caller's read high-water mark. Never moves backwards. */
export async function markRead(threadId, meAmberId, messageId) {
  const tid = _id(threadId);
  const me = _uuid(meAmberId);
  const mid = _id(messageId);
  if (!tid || !me || !mid) return false;
  try {
    const other = await threadCounterparty(tid, me);
    if (!other) return false;
    await query(
      `INSERT INTO dm_reads (thread_id, amber_id, last_read_message_id)
       VALUES ($1, $2::uuid, $3)
       ON CONFLICT (thread_id, amber_id) DO UPDATE
         SET last_read_message_id = GREATEST(dm_reads.last_read_message_id, EXCLUDED.last_read_message_id),
             updated_at = now()`,
      [tid, me, mid],
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Clear the caller's copy of a thread.
 *
 * Per-person by design: this records a high-water mark, so your history empties
 * and the other person's is untouched. Deleting someone else's messages out of
 * their app is not something a "delete this chat" button should be able to do.
 */
export async function clearThreadForMe(threadId, meAmberId) {
  const tid = _id(threadId);
  const me = _uuid(meAmberId);
  if (!tid || !me) return false;
  try {
    const other = await threadCounterparty(tid, me);
    if (!other) return false;
    const { rows } = await query(
      `SELECT COALESCE(MAX(id), 0) AS top FROM dm_messages WHERE thread_id = $1`,
      [tid],
    );
    const top = Number(rows[0]?.top) || 0;
    await query(
      `INSERT INTO dm_clears (thread_id, amber_id, cleared_before_id)
       VALUES ($1, $2::uuid, $3)
       ON CONFLICT (thread_id, amber_id) DO UPDATE
         SET cleared_before_id = GREATEST(dm_clears.cleared_before_id, EXCLUDED.cleared_before_id),
             updated_at = now()`,
      [tid, me, top],
    );
    return true;
  } catch (err) {
    console.error(`DM_CLEAR_ERR ${err?.message || err}`);
    return false;
  }
}

/**
 * The whole visible thread, oldest first, for the transcript export. Bounded at
 * 5000 messages: an export is a file the user reads, not a backup, and an
 * unbounded scan of a years-long thread is not something a request should do.
 */
export async function exportThread(threadId, meAmberId) {
  const tid = _id(threadId);
  const me = _uuid(meAmberId);
  if (!tid || !me) return null;
  try {
    const other = await threadCounterparty(tid, me);
    if (!other) return null;
    const { rows } = await query(
      `SELECT m.id, m.sender_amber_id, m.kind, m.body, m.duration_ms, m.created_at,
              u.full_name, u.username
         FROM dm_messages m
         LEFT JOIN dm_clears cl ON cl.thread_id = m.thread_id AND cl.amber_id = $2::uuid
         LEFT JOIN users u ON u.amber_id = m.sender_amber_id
        WHERE m.thread_id = $1 AND m.deleted_at IS NULL
          AND m.id > COALESCE(cl.cleared_before_id, 0)
        ORDER BY m.id ASC
        LIMIT 5000`,
      [tid, me],
    );
    return rows.map((r) => ({
      id: String(r.id),
      mine: String(r.sender_amber_id) === me,
      author: r.full_name || r.username || "Amber user",
      kind: r.kind,
      body: r.body ?? null,
      durationMs: Number(r.duration_ms) || 0,
      createdAt: r.created_at,
    }));
  } catch (err) {
    console.error(`DM_EXPORT_ERR ${err?.message || err}`);
    return null;
  }
}

/**
 * WHO CAN I MESSAGE, AND WHO WOULD I HAVE TO INVITE — in one query.
 *
 * THE OLD SHAPE WAS THE BUG. The route took a comma-separated list of contact
 * ids in the QUERY STRING, capped at 200, and then looped over them doing two
 * awaits each: getContactById, then resolveContactAmberUser on that contact's
 * phone numbers. Four hundred sequential round trips, per keystroke, behind a
 * 7KB URL. On a 973-contact address book the request either timed out or took
 * long enough that the client — which had no try/catch around it — sat on a
 * spinner forever. "Direct messages still isn't working" was this.
 *
 * It also resolved by PHONE, which was the same mistake as everywhere else in
 * this codebase: contacts.linked_amber_id is the answer to "is this card an
 * account", it is populated now, and it costs one join instead of a lookup per
 * row.
 *
 * So the endpoint no longer needs to be told who to consider. With no query it
 * returns everyone you can actually message, which is a small and genuinely
 * useful list — the people you are connected to. With `q` it searches the whole
 * address book server-side and splits the results the same way.
 *
 * MESSAGEABLE FIRST, always. A direct message needs an account on the other
 * end; an invite is a hand-off to the phone's Messages app. Ordering the ones
 * that work above the ones that do not is the whole information content of this
 * screen.
 *
 * AND WITH NO QUERY IT STILL RETURNS A LIST. The first version restricted the
 * no-query case to linked contacts only, on the reasoning that 973 rows of "you
 * could text them from Messages" is not an answer to "who do you want to
 * message". True, but it meant opening the sheet with nothing to tap and no
 * indication of what to do next — and "it just doesn't have any contacts" is
 * how that reads. Linked contacts sort first and the rest fill the page up to
 * `limit`, so the sheet always opens onto something and the people you can
 * actually message are the ones at the top.
 */
export async function listDmCandidates(ownerId, { q = "", limit = 80 } = {}) {
  if (!ownerId) return { messageable: [], invite: [] };
  const needle = String(q || "").trim();
  const lim = Math.min(Math.max(Number(limit) || 60, 1), 200);
  try {
    const { rows } = await query(
      `SELECT c.id                                                   AS contact_id,
              COALESCE(NULLIF(TRIM(u.full_name), ''),
                       c.full_name,
                       NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), '')) AS name,
              c.phone_primary,
              c.linked_amber_id                                      AS amber_id,
              u.username,
              u.avatar_url
         FROM contacts c
         LEFT JOIN users u
           ON u.amber_id = c.linked_amber_id AND u.deleted_at IS NULL
        WHERE c.owner_id = $1
          AND c.deleted_at IS NULL
          AND ($2 = '' OR
               COALESCE(c.full_name, CONCAT_WS(' ', c.first_name, c.last_name))
                 ILIKE '%' || $2 || '%')
        ORDER BY (c.linked_amber_id IS NOT NULL) DESC, name ASC NULLS LAST, c.id ASC
        LIMIT $3`,
      [ownerId, needle, lim],
    );
    const messageable = [];
    const invite = [];
    for (const r of rows) {
      if (r.amber_id) {
        messageable.push({
          contactId: String(r.contact_id),
          name: r.name ?? null,
          amberId: String(r.amber_id),
          username: r.username ?? null,
          avatarUrl: r.avatar_url ?? null,
        });
      } else {
        invite.push({
          contactId: String(r.contact_id),
          name: r.name ?? null,
          phone: r.phone_primary ?? null,
        });
      }
    }
    return { messageable, invite };
  } catch (e) {
    console.error(`DM_CANDIDATES_ERR ${e?.stack || e?.message || e}`);
    // Rethrow: the route turns this into a 500 and the app can say "could not
    // load". Swallowing it here is what made an errored lookup and an empty
    // address book look identical.
    throw e;
  }
}

/**
 * PIN OR UNPIN ONE MESSAGE.
 *
 * A pin is a SHARED bookmark on the thread, not a private one: two people in one
 * conversation pinning "the one with the address" separately, each unable to see
 * the other's, is not what anybody means by pinning. pinned_by records who did
 * it, so the strip can say so and an accidental pin has an author.
 *
 * THE AUTHORIZATION IS MEMBERSHIP OF THE THREAD, not authorship of the message:
 * the point of pinning is usually to keep what the OTHER person said. It is in
 * the WHERE clause, so there is no read-then-check window, and a caller pinning
 * a message id from a thread they are not in gets the same null as one pinning
 * an id that does not exist.
 *
 * Returns the shaped message, or null.
 */
export async function setMessagePinned(messageId, meAmberId, pinned = true) {
  const mid = _id(messageId);
  const me = _uuid(meAmberId);
  if (!mid || !me) return null;
  try {
    const { rows } = await query(
      `UPDATE dm_messages m
          SET pinned_at = CASE WHEN $3 THEN now() ELSE NULL END,
              pinned_by = CASE WHEN $3 THEN $2::uuid ELSE NULL END
        WHERE m.id = $1
          AND m.deleted_at IS NULL
          AND EXISTS (
            SELECT 1 FROM dm_threads t
             WHERE t.id = m.thread_id
               AND (t.a_amber_id = $2::uuid OR t.b_amber_id = $2::uuid)
          )
        RETURNING m.id, m.sender_amber_id, m.kind, m.body, m.duration_ms, m.byte_size,
                  m.peaks, m.audio_status, m.created_at, m.pinned_at, m.pinned_by,
                  '[]'::json AS reactions`,
      [mid, me, Boolean(pinned)],
    );
    if (!rows[0]) return null;
    return { ..._shapeMessage(rows[0], me), pinnedAt: rows[0].pinned_at ?? null };
  } catch (err) {
    // 035 adds pinned_at/pinned_by. If the code is ahead of the migration the
    // pin simply cannot be stored -- report that, and name the reason once.
    if (err?.code === "42703") {
      noteMissingColumn("dm_messages.pinned_at");
      return null;
    }
    console.error(`DM_PIN_ERR ${err?.message || err}`);
    return null;
  }
}

/**
 * The thread's pinned messages, newest pin first.
 *
 * Respects the caller's own clear point, like every other read here: a message
 * cleared from your copy of the thread must not come back through the pinned
 * strip. Reactions are not joined -- the strip is a list of bookmarks, and the
 * message itself is one tap away in the thread.
 */
export async function listPinnedMessages(threadId, meAmberId, { limit = 30 } = {}) {
  const tid = _id(threadId);
  const me = _uuid(meAmberId);
  if (!tid || !me) return [];
  const cap = Math.min(Math.max(Number(limit) || 30, 1), 100);
  try {
    const { rows } = await query(
      `SELECT m.id, m.sender_amber_id, m.kind, m.body, m.duration_ms, m.byte_size,
              m.peaks, m.audio_status, m.created_at, m.pinned_at, m.pinned_by,
              '[]'::json AS reactions
         FROM dm_messages m
         JOIN dm_threads t ON t.id = m.thread_id
         LEFT JOIN dm_clears cl ON cl.thread_id = t.id AND cl.amber_id = $2::uuid
        WHERE m.thread_id = $1
          AND m.deleted_at IS NULL
          AND m.pinned_at IS NOT NULL
          AND (t.a_amber_id = $2::uuid OR t.b_amber_id = $2::uuid)
          AND m.id > COALESCE(cl.cleared_before_id, 0)
        ORDER BY m.pinned_at DESC
        LIMIT $3`,
      [tid, me, cap],
    );
    return rows.map((r) => ({
      ..._shapeMessage(r, me),
      pinnedAt: r.pinned_at ?? null,
      pinnedByMe: String(r.pinned_by ?? "") === me,
    }));
  } catch (err) {
    // Same pending column. "No pins yet" is the correct thing to show while the
    // migration has not run, and the log says which migration it is waiting on.
    if (err?.code === "42703") {
      noteMissingColumn("dm_messages.pinned_at");
      return [];
    }
    console.error(`DM_PINNED_LIST_ERR ${err?.message || err}`);
    return [];
  }
}
