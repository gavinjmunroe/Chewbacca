/**
 * Conversation threads — chat, voice notes, group spaces.
 *
 * Was app_conversation_messages: a single flat table where the "conversation"
 * was nothing but a repeated text column. There was no row representing the
 * thread itself, so a thread had no title, no kind, no updated_at, could not be
 * shared as an object, and could not be pointed at by a foreign key. Deleting
 * one meant soft-deleting every message and hoping none were missed.
 *
 * Now: `conversations` is the thread and `conversation_messages` are its turns.
 * That is what lets `observations.source_conversation_id` record where a fact was
 * learned, and what lets a note be shared as one thing.
 *
 * The exported signatures are unchanged, so every route keeps working.
 */

import { query, withTransaction } from "./sql.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v) =>
  typeof v === "string" && UUID_RE.test(v.trim()) ? v.trim().toLowerCase() : null;

/**
 * THE WIRE VOCABULARY IS "assistant". THE COLUMN'S VOCABULARY IS "amber".
 *
 * conversation_messages.role is CHECK (role IN ('user','amber','system')) --
 * inherited from the old spaces table, where Amber's turns were literally
 * "amber" rows. Everything else in this codebase says "assistant": every
 * appendMessage call site in routes/chat.js, the reader in routes/
 * conversations.js, toAnthropicMessages, and the iOS client's own type.
 *
 * The two vocabularies used to be bridged by a coercion that defaulted anything
 * unrecognised to "user":
 *
 *     const ROLE = (r) => (r === "amber" ? "amber" : r === "system" ? "system" : "user");
 *
 * So appendMessage(..., role: "assistant") -- which is what EVERY reply in
 * routes/chat.js passes -- wrote a USER row. Silently, for every answer, since
 * the conversations cutover. Four separate features were broken by that one
 * line, and every one of them got diagnosed as its own bug:
 *
 *   - Reopening a note rendered Amber's answer and its "Got it, I'll write that
 *     down" as the USER's own gold bubbles, each with a spinner under it,
 *     because the client pairs a user message with the assistant message after
 *     it and there were no assistant messages.
 *   - toAnthropicMessages fed Amber its own previous replies back as things the
 *     user had said, so every multi-turn thread degraded.
 *   - The correction fast-path looks for the last assistant turn carrying
 *     capturedOutcomes ("no, that's Ajay, not AJ"). It could never match.
 *   - The people-merge in routes/conversations.js skips non-assistant rows, so
 *     a corrected name never reached a reopened note.
 *
 * So the translation is explicit now, in both directions, at the one boundary
 * that touches the column -- and an unknown role THROWS. A typo must fail at
 * the call site instead of quietly becoming a user message.
 */
const ROLE_TO_COLUMN = {
  user: "user",
  assistant: "amber",
  amber: "amber",
  system: "system",
};
export function roleToColumn(r) {
  const v = ROLE_TO_COLUMN[r];
  if (!v) {
    throw new Error(
      `conversation_messages: unknown role ${JSON.stringify(r)} (expected user | assistant | system)`,
    );
  }
  return v;
}
/** Back out to the vocabulary every reader in the app actually speaks. */
export const roleFromColumn = (r) => (r === "amber" ? "assistant" : r);

/**
 * Append a turn, creating the thread if this is the first one.
 *
 * ONE TRANSACTION, and the reason is a race the old flat table could not even
 * have: two requests arriving together for a thread that does not exist yet
 * would otherwise both try to create it. The insert takes the conflict, and the
 * ownership check inside the same transaction means a caller cannot append to
 * somebody else's thread by guessing its id.
 */
export async function appendMessage(ownerId, { conversationId, role, content, intent = null, metadata = null } = {}) {
  const owner = asUuid(ownerId);
  if (!owner || typeof content !== "string" || !content.length) return null;
  // Validated BEFORE the transaction opens, so a bad role never costs a
  // connection and never half-writes a thread.
  const roleColumn = roleToColumn(role);

  return withTransaction(async (client) => {
    let conv = asUuid(conversationId);
    if (conv) {
      const ins = await client.query(
        `INSERT INTO conversations (conversation_id, owner_id, kind)
         VALUES ($1, $2, 'chat')
         ON CONFLICT (conversation_id) DO NOTHING
         RETURNING conversation_id`,
        [conv, owner],
      );
      if (!ins.rowCount) {
        // It already existed. It must be theirs.
        const own = await client.query(
          `SELECT 1 FROM conversations WHERE conversation_id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
          [conv, owner],
        );
        if (!own.rowCount) return null;
      }
    } else {
      const { rows } = await client.query(
        `INSERT INTO conversations (owner_id, kind) VALUES ($1,'chat') RETURNING conversation_id`,
        [owner],
      );
      conv = rows[0].conversation_id;
    }

    const { rows } = await client.query(
      `INSERT INTO conversation_messages (conversation_id, owner_id, role, content, intent, metadata)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)
       RETURNING id, created_at`,
      [conv, owner, roleColumn, content, intent, metadata ? JSON.stringify(metadata) : null],
    );
    // The thread's recency is what the "recent conversations" list sorts on, so
    // it has to move with its newest message rather than sit at creation time.
    await client.query(`UPDATE conversations SET updated_at = now() WHERE conversation_id = $1`, [conv]);
    return { id: rows[0].id, conversationId: conv, created_at: rows[0].created_at };
  });
}

/** One thread, oldest first, capped. */
export async function listConversation(ownerId, conversationId, { limit = 50 } = {}) {
  const owner = asUuid(ownerId), conv = asUuid(conversationId);
  if (!owner || !conv) return [];
  const { rows } = await query(
    `SELECT * FROM (
       SELECT id, role, content, intent, metadata, created_at
         FROM conversation_messages
        WHERE owner_id = $1 AND conversation_id = $2 AND deleted_at IS NULL
        ORDER BY created_at DESC, id DESC
        LIMIT $3
     ) t ORDER BY created_at ASC, id ASC`,
    [owner, conv, Math.max(1, Math.min(Number(limit) || 50, 500))],
  );
  // Normalized here rather than at each of the six call sites, all of which
  // already test for "assistant". See roleToColumn above.
  return rows.map((r) => ({ ...r, role: roleFromColumn(r.role) }));
}

/**
 * The thread list. One row per conversation with its newest message as a
 * preview — a plain join off `conversations`, where the old version had to
 * DISTINCT ON over every message row in the table to reconstruct the fact that
 * threads existed at all.
 *
 * ── WHY THIS TAKES A DAY WINDOW ─────────────────────────────────────────────
 *
 * "My notes and journals from yesterday are not showing up either. In some
 *  cases, that needs to show up all the time."
 *
 * Home's Notes & Journal list is single-day by design -- the day filter is what
 * makes the list readable, a week-old note above this morning's reminder would
 * be absurd -- and it was being fed by an UNWINDOWED call for the 30 most
 * recent threads, which the client then bucketed into days on its own. So the
 * day view could only ever show a day that happened to fall inside the newest
 * thirty threads.
 *
 * Every Ask conversation is a row in this same table with `kind = 'chat'`, and
 * they compete for the same thirty slots. Thirty threads is one busy day for
 * somebody who actually uses the app -- and then yesterday's notes are still in
 * the database, still perfectly intact, and permanently invisible. They did not
 * fail to save; they failed to be asked for.
 *
 * A LIMIT can never fix that, whatever number it is, because the question being
 * asked is the wrong one: the day view wants A DAY, not "some recent stuff,
 * hopefully enough". So the caller may name a window, and then the answer does
 * not depend on how much else happened since.
 *
 * ── AND THE COLUMN, WHICH WAS A SECOND BUG ──────────────────────────────────
 *
 * This ordered and cut on `c.updated_at`, while the client buckets notes into
 * days on `last_at` -- the newest MESSAGE's timestamp. Two different columns, so
 * the thirty rows that survived were not the thirty the client would have shown,
 * and a thread whose updated_at moved without a new message (a retitle, a
 * participant edit) displaced one that had something to say. The window and the
 * ordering are both on the message time now, which is the one the reader sees.
 *
 * Threads with no messages sort last and fall outside any window -- correct
 * either way, since the client drops a thread with no lastAt.
 */
export async function listRecentConversations(ownerId, { limit = 20, from = null, to = null } = {}) {
  const owner = asUuid(ownerId);
  if (!owner) return [];
  // Half-open [from, to), matching the agenda and the week strip: a day is
  // [midnight, next midnight), and a closed upper bound shows midnight twice.
  const windowed = Boolean(from && to);
  const { rows } = await query(
    `SELECT c.conversation_id, c.kind, c.title, c.created_at, c.updated_at,
            m.content AS last_message, m.role AS last_role, m.created_at AS last_at,
            (SELECT count(*)::int FROM conversation_messages x
              WHERE x.conversation_id = c.conversation_id AND x.deleted_at IS NULL) AS message_count
       FROM conversations c
       LEFT JOIN LATERAL (
         SELECT content, role, created_at FROM conversation_messages
          WHERE conversation_id = c.conversation_id AND deleted_at IS NULL
          ORDER BY created_at DESC, id DESC LIMIT 1
       ) m ON true
      WHERE c.owner_id = $1 AND c.deleted_at IS NULL
        AND ($3::timestamptz IS NULL OR m.created_at >= $3::timestamptz)
        AND ($4::timestamptz IS NULL OR m.created_at <  $4::timestamptz)
      ORDER BY COALESCE(m.created_at, c.updated_at) DESC
      LIMIT $2`,
    [
      owner,
      Math.max(1, Math.min(Number(limit) || 20, 200)),
      windowed ? from : null,
      windowed ? to : null,
    ],
  );
  return rows.map((r) => ({ ...r, last_role: roleFromColumn(r.last_role) }));
}

/**
 * Soft delete a thread.
 *
 * The messages go with it by one UPDATE on the parent — previously this had to
 * find and mark every message individually, and any it missed stayed visible.
 * Observations learned from the thread are deliberately NOT deleted: deleting
 * the recording of a conversation is not the same as unlearning what was said
 * in it, and `source_conversation_id` is ON DELETE SET NULL for exactly that.
 */
export async function softDeleteConversation(ownerId, conversationId) {
  const owner = asUuid(ownerId), conv = asUuid(conversationId);
  if (!owner || !conv) return 0;
  return withTransaction(async (client) => {
    const { rowCount } = await client.query(
      `UPDATE conversations SET deleted_at = now()
        WHERE conversation_id = $2 AND owner_id = $1 AND deleted_at IS NULL`,
      [owner, conv],
    );
    if (!rowCount) return 0;
    await client.query(
      `UPDATE conversation_messages SET deleted_at = now()
        WHERE conversation_id = $1 AND deleted_at IS NULL`,
      [conv],
    );
    return rowCount;
  });
}

/** Merge a patch into one message's metadata. Used to attach answer groups and
 *  people results to the turn that produced them, after streaming finishes. */
export async function mergeMessageMetadata(ownerId, messageId, patch) {
  const owner = asUuid(ownerId);
  if (!owner || !messageId || !patch || typeof patch !== "object") return 0;
  const { rowCount } = await query(
    `UPDATE conversation_messages
        SET metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
      WHERE id = $2 AND owner_id = $1 AND deleted_at IS NULL`,
    [owner, messageId, JSON.stringify(patch)],
  );
  return rowCount;
}
