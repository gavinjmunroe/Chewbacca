/**
 * Voice-note media: the audio, the tapbacks, the comments.
 *
 * Was three tables keyed on a text conversation_id that referenced nothing:
 *   note_audio      -> media_assets, which already had to exist for every other
 *                      kind of upload, and now carries conversation_id
 *   note_reactions  -> conversation_reactions
 *   note_comments   -> conversation_comments
 *
 * All three now hang off a real `conversations` row with a foreign key, so
 * deleting a note takes its audio, its comments and its reactions with it instead
 * of leaving three sets of orphans keyed on a string. That also removes the
 * note_owner_id column those tables carried: the owner is a property of the
 * conversation, and storing it again on every child row was a second copy that
 * could disagree with the first.
 *
 * THE AUTHORIZATION RULE IS NOT IN THIS FILE. canViewNote() imports
 * VIEWER_REACH_SQL from note-shares-store rather than keeping a second copy, so
 * the feed and the audio endpoint cannot drift apart about who may see a note.
 *
 * THE UPLOAD IS THREE LEGS AND THE SERVER OWNS TWO OF THEM:
 *   reserve   the server mints the storage key. A client never chooses where its
 *             own bytes land, or it can choose someone else's path.
 *   PUT       the client uploads straight to Cloud Storage. Bytes never pass
 *             through this service.
 *   finalize  the server HEADs the object and records the REAL size. A client
 *             never declares its own upload complete.
 *
 * EVERY EXPORTED SIGNATURE AND RETURN SHAPE IS UNCHANGED. The routes and the app
 * are not part of this migration; only the storage underneath is.
 */

import crypto from "node:crypto";
import { query } from "./sql.js";
import { queryWithOptionalColumn } from "./optional-column.js";
import { VIEWER_REACH_SQL } from "./note-shares-store.js";

// One list for the whole app; see lib/reaction-kinds.js for why this stopped
// being a local literal.
// IMPORTED AND RE-EXPORTED, NOT JUST RE-EXPORTED.
//
// `export { X } from "..."` creates NO LOCAL BINDING. This file uses
// REACTION_KINDS twice below -- zeroCounts and isReactionKind -- and both threw
// at runtime:
//
//   unhandled_error PUT /v1/notes/:ownerId/:id/reactions
//     ReferenceError REACTION_KINDS is not defined
//       at isReactionKind (src/db/note-media-store.js:55)
//
// which is "Could not save that reaction" on the feed, and the same crash took
// comments and voice notes down with it. Nothing static caught it: it is valid
// syntax, valid ESM, and the module loads fine -- the reference only fails when
// the function is called. scripts/local-binding-check.mjs catches it now.
import { REACTION_KINDS } from "../lib/reaction-kinds.js";
export { REACTION_KINDS };
export const MAX_DURATION_MS = 5 * 60 * 1000;
export const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
export const AUDIO_CONTENT_TYPE = "audio/m4a";
export const MAX_PEAKS = 240;

const MAX_COMMENT_LENGTH = 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v) =>
  typeof v === "string" && UUID_RE.test(v.trim()) ? v.trim().toLowerCase() : null;

const zeroCounts = () => Object.fromEntries(REACTION_KINDS.map((k) => [k, 0]));

export function isReactionKind(kind) {
  return typeof kind === "string" && REACTION_KINDS.includes(kind);
}

export async function ownerOwnsNote(ownerId, conversationId) {
  const owner = asUuid(ownerId);
  const conv = asUuid(conversationId);
  if (!owner || !conv) return false;
  const { rowCount } = await query(
    `SELECT 1 FROM conversations
      WHERE conversation_id = $2 AND owner_id = $1 AND deleted_at IS NULL`,
    [owner, conv],
  );
  return rowCount > 0;
}

/**
 * THE CHOKE POINT. Can this viewer see this note at all?
 *
 * True when they are the note's owner, or when a live share row for the note
 * reaches them under VIEWER_REACH_SQL. Deliberately NOT cached: a membership
 * change has to take effect on the next request, and this is one indexed query.
 *
 * viewerPhone is accepted and ignored. The reach predicate resolves a viewer's
 * phone identity through discovery_keys now, so there is no number for a caller
 * to get wrong. The parameter stays so no route has to change.
 */
export async function canViewNote(viewerAmberId, viewerPhone, noteOwnerId, conversationId) {
  const viewer = asUuid(viewerAmberId);
  const owner = asUuid(noteOwnerId);
  const conv = asUuid(conversationId);
  if (!viewer || !owner || !conv) return false;
  if (viewer === owner) return true;
  const { rowCount } = await query(
    `SELECT 1
       FROM shares s
      WHERE s.owner_id = $2
        AND s.item_type = 'conversation'
        AND s.item_id = $3
        AND s.deleted_at IS NULL
        AND ${VIEWER_REACH_SQL}
      LIMIT 1`,
    [viewer, owner, conv],
  );
  return rowCount > 0;
}

// ── Audio ─────────────────────────────────────────────────────────────────────

/**
 * Leg one: mint a storage key and record the intent. Returns the key.
 *
 * THE KEY IS SERVER-GENERATED and stored before the client ever uploads. A
 * client-supplied key would let someone overwrite another user's object or walk
 * out of their prefix; because finalize only ever reads the key already in this
 * row, neither is expressible.
 *
 * The random suffix matters: re-recording a note must land on a NEW object, or a
 * signed URL or CDN entry for the old audio can still serve the old bytes under
 * a path the client now believes holds the new ones.
 *
 * Idempotent by `media_conv_live_uidx` (added in migration 014). Without that
 * partial unique index the ON CONFLICT here has nothing to conflict with, and a
 * retried reserve silently created a second pending row; finalize would then
 * update whichever one it happened to find.
 */
export async function reserveAudioUpload(ownerId, conversationId) {
  const owner = asUuid(ownerId);
  const conv = asUuid(conversationId);
  if (!owner || !conv) return null;
  const storageKey = `notes/${owner}/${conv}/${crypto.randomUUID()}.m4a`;
  // THE ARBITER PREDICATE HAS TO MATCH THE INDEX, and the index changed in 037:
  // media_conv_live_uidx is now "one live NOTE-LEVEL row per conversation", so
  // it carries `message_id IS NULL` and this ON CONFLICT must say so too or
  // Postgres cannot infer it. Run through queryWithOptionalColumn so a deploy
  // that lands before the migration keeps working against the old index instead
  // of failing every reserve -- that exact ordering has cost a feature once.
  const { rows } = await queryWithOptionalColumn(
    "media_assets.message_id",
    (has) => `INSERT INTO media_assets (owner_id, conversation_id, storage_key, content_type, status)
     VALUES ($1, $2, $3, $4, 'pending')
     ON CONFLICT (conversation_id) WHERE conversation_id IS NOT NULL${has ? " AND message_id IS NULL" : ""} AND deleted_at IS NULL
       DO UPDATE SET storage_key  = EXCLUDED.storage_key,
                     content_type = EXCLUDED.content_type,
                     status       = 'pending',
                     duration_ms  = 0,
                     byte_size    = 0,
                     peaks        = '{}'
     RETURNING storage_key`,
    [owner, conv, storageKey, AUDIO_CONTENT_TYPE],
  );
  return rows[0]?.storage_key ?? null;
}

/** The pending/ready row for a note, or null. */
export async function getAudioRow(ownerId, conversationId) {
  const owner = asUuid(ownerId);
  const conv = asUuid(conversationId);
  if (!owner || !conv) return null;
  // THE NOTE'S OWN CLIP, not a clip attached to one of its messages. Without
  // the message_id test this read would return whichever row it found first, so
  // recording a spoken follow-up could change what the card plays.
  const { rows } = await queryWithOptionalColumn(
    "media_assets.message_id",
    (has) => `SELECT owner_id, conversation_id, storage_key, content_type, duration_ms,
            byte_size, peaks, status, created_at
       FROM media_assets
      WHERE owner_id = $1 AND conversation_id = $2 AND deleted_at IS NULL
        ${has ? "AND message_id IS NULL" : ""}
      LIMIT 1`,
    [owner, conv],
  );
  return rows[0] ?? null;
}

/** Clamp a client-sent waveform to smallint range and a fixed sample count. */
export function normalizePeaks(peaks) {
  if (!Array.isArray(peaks)) return [];
  const clean = peaks.map((p) => {
    const n = typeof p === "number" ? p : Number(p);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, Math.round(n)));
  });
  if (clean.length <= MAX_PEAKS) return clean;
  // DOWNSAMPLE, don't slice. Slicing keeps the first 240 samples and throws the
  // rest away, so a clip whose client sent 400 samples would draw the waveform of
  // its first 60% and then stop -- the shape the listener sees would not be the
  // shape the speaker made. The client already downsamples to MAX_PEAKS, so in
  // practice this never fires; it fires the day a client doesn't, and on that day
  // it should still be right. Averages each bucket rather than picking every Nth
  // value, so a shout that landed between two sample points cannot vanish.
  const out = [];
  for (let i = 0; i < MAX_PEAKS; i += 1) {
    const start = Math.floor((i * clean.length) / MAX_PEAKS);
    const end = Math.max(start + 1, Math.floor(((i + 1) * clean.length) / MAX_PEAKS));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += clean[j] ?? 0;
    out.push(Math.round(sum / (end - start)));
  }
  return out;
}

/** Leg three. byteSize is what the SERVER measured, never what the client said. */
export async function markAudioReady(ownerId, conversationId, { durationMs, byteSize, peaks }) {
  const owner = asUuid(ownerId);
  const conv = asUuid(conversationId);
  if (!owner || !conv) return false;
  const dur = Math.max(0, Math.min(MAX_DURATION_MS, Math.floor(Number(durationMs) || 0)));
  const size = Math.max(0, Math.floor(Number(byteSize) || 0));
  const { rowCount } = await queryWithOptionalColumn(
    "media_assets.message_id",
    (has) => `UPDATE media_assets
        SET status = 'ready', duration_ms = $3, byte_size = $4, peaks = $5::smallint[]
      WHERE owner_id = $1 AND conversation_id = $2 AND deleted_at IS NULL
        ${has ? "AND message_id IS NULL" : ""}`,
    [owner, conv, dur, size, normalizePeaks(peaks)],
  );
  return rowCount > 0;
}

/** Soft-delete a note's audio row. The object itself is removed by the caller. */
export async function deleteAudio(ownerId, conversationId) {
  const owner = asUuid(ownerId);
  const conv = asUuid(conversationId);
  if (!owner || !conv) return true;
  // Deletes the NOTE'S clip. A message's clip goes with its message (ON DELETE
  // CASCADE) or through deleteMessageAudio; removing the note's audio must not
  // silently take the follow-ups' recordings with it.
  await queryWithOptionalColumn(
    "media_assets.message_id",
    (has) => `UPDATE media_assets SET deleted_at = now()
      WHERE owner_id = $1 AND conversation_id = $2 AND deleted_at IS NULL
        ${has ? "AND message_id IS NULL" : ""}`,
    [owner, conv],
  );
  return true;
}

// ── Audio on ONE MESSAGE of a note ───────────────────────────────────────────
//
// "There should also be a little voice area: the same UI... That should just
//  record the voice and go up and transcribe. It should save the voice note in
//  there as well, but it should also transcribe it under."
//
// A spoken follow-up inside an expanded card. The transcript is the message --
// it is what was said, and it is what Amber answers -- and this is where the
// recording itself lives. Same three legs as the note's own audio, same server
// ownership of the key and the size; the only difference is what the row is
// keyed to.
//
// EVERY FUNCTION HERE TAKES THE CONVERSATION AS WELL AS THE MESSAGE, and not
// for convenience: the message id alone would let a caller attach audio to
// somebody else's message by guessing a bigserial. The conversation is checked
// against the owner in the same statement, so a mismatch writes nothing rather
// than relying on a prior read somebody can forget to do.

const asMessageId = (v) => {
  const n = typeof v === "bigint" ? Number(v) : Number(v);
  return Number.isInteger(n) && n > 0 ? String(n) : null;
};

/** Leg one for a message clip. Mints and stores the key; returns it. */
export async function reserveMessageAudioUpload(ownerId, conversationId, messageId, deps = {}) {
  // The query function is injectable so the authorization rule and the key
  // shape can be tested without a database. Production passes nothing.
  const run = deps.queryImpl || query;
  const owner = asUuid(ownerId);
  const conv = asUuid(conversationId);
  const mid = asMessageId(messageId);
  if (!owner || !conv || !mid) return null;
  // THE MESSAGE HAS TO BE THEIRS, AND IN THIS THREAD. Checked in SQL as part of
  // the insert -- a client that guesses another row's id inserts nothing.
  const { rows: owns } = await run(
    `SELECT 1 FROM conversation_messages
      WHERE id = $3::bigint AND owner_id = $1 AND conversation_id = $2
        AND deleted_at IS NULL`,
    [owner, conv, mid],
  );
  if (!owns.length) return null;
  const storageKey = `notes/${owner}/${conv}/m${mid}-${crypto.randomUUID()}.m4a`;
  const { rows } = await run(
    `INSERT INTO media_assets (owner_id, conversation_id, message_id, storage_key, content_type, status)
     VALUES ($1, $2, $3::bigint, $4, $5, 'pending')
     ON CONFLICT (message_id) WHERE message_id IS NOT NULL AND deleted_at IS NULL
       DO UPDATE SET storage_key  = EXCLUDED.storage_key,
                     content_type = EXCLUDED.content_type,
                     status       = 'pending',
                     duration_ms  = 0,
                     byte_size    = 0,
                     peaks        = '{}'
     RETURNING storage_key`,
    [owner, conv, mid, storageKey, AUDIO_CONTENT_TYPE],
  );
  return rows[0]?.storage_key ?? null;
}

/** The pending/ready row for one message's clip, or null. */
export async function getMessageAudioRow(ownerId, conversationId, messageId, deps = {}) {
  const run = deps.queryImpl || query;
  const owner = asUuid(ownerId);
  const conv = asUuid(conversationId);
  const mid = asMessageId(messageId);
  if (!owner || !conv || !mid) return null;
  const { rows } = await run(
    `SELECT owner_id, conversation_id, message_id, storage_key, content_type,
            duration_ms, byte_size, peaks, status, created_at
       FROM media_assets
      WHERE owner_id = $1 AND conversation_id = $2 AND message_id = $3::bigint
        AND deleted_at IS NULL
      LIMIT 1`,
    [owner, conv, mid],
  );
  return rows[0] ?? null;
}

/** Leg three. byteSize is what the SERVER measured, never what the client said. */
export async function markMessageAudioReady(
  ownerId,
  conversationId,
  messageId,
  { durationMs, byteSize, peaks },
  deps = {},
) {
  const run = deps.queryImpl || query;
  const owner = asUuid(ownerId);
  const conv = asUuid(conversationId);
  const mid = asMessageId(messageId);
  if (!owner || !conv || !mid) return false;
  const dur = Math.max(0, Math.min(MAX_DURATION_MS, Math.floor(Number(durationMs) || 0)));
  const size = Math.max(0, Math.floor(Number(byteSize) || 0));
  const { rowCount } = await run(
    `UPDATE media_assets
        SET status = 'ready', duration_ms = $4, byte_size = $5, peaks = $6::smallint[]
      WHERE owner_id = $1 AND conversation_id = $2 AND message_id = $3::bigint
        AND deleted_at IS NULL`,
    [owner, conv, mid, dur, size, normalizePeaks(peaks)],
  );
  return rowCount > 0;
}

/** Soft-delete one message's clip. The object itself is removed by the caller. */
export async function deleteMessageAudio(ownerId, conversationId, messageId, deps = {}) {
  const run = deps.queryImpl || query;
  const owner = asUuid(ownerId);
  const conv = asUuid(conversationId);
  const mid = asMessageId(messageId);
  if (!owner || !conv || !mid) return true;
  await run(
    `UPDATE media_assets SET deleted_at = now()
      WHERE owner_id = $1 AND conversation_id = $2 AND message_id = $3::bigint
        AND deleted_at IS NULL`,
    [owner, conv, mid],
  );
  return true;
}

/**
 * Every message clip in one thread, keyed by message id.
 *
 * ONE QUERY FOR THE WHOLE THREAD. Opening a note with four spoken follow-ups in
 * it must not be four requests -- the player needs the duration and the waveform
 * to draw at all, so a per-message fetch would mean the transcript appearing
 * first and the players popping in one at a time underneath it.
 *
 * Returns { [messageId]: { durationMs, byteSize, peaks } } for READY clips only.
 * A pending row is an upload that never finished; drawing a player for it would
 * offer the listener a button that cannot work.
 *
 * Degrades to {} until migration 037 lands, which is the honest answer then:
 * no message has a clip yet, because there was nowhere to put one.
 */
export async function getMessageAudioForConversation(ownerId, conversationId, deps = {}) {
  const owner = asUuid(ownerId);
  const conv = asUuid(conversationId);
  if (!owner || !conv) return {};
  const { rows } = await queryWithOptionalColumn(
    "media_assets.message_id",
    (has) =>
      has
        ? `SELECT message_id, duration_ms, byte_size, peaks
             FROM media_assets
            WHERE owner_id = $1 AND conversation_id = $2
              AND message_id IS NOT NULL AND deleted_at IS NULL
              AND status = 'ready'`
          // No column, so no message can have a clip. The parameters are named
          // and CAST because both variants are run with one parameter list and
          // an unreferenced parameter has no inferable type; `false` is what
          // makes it return nothing.
        : `SELECT NULL::bigint AS message_id, 0 AS duration_ms, 0 AS byte_size,
                  '{}'::smallint[] AS peaks
             WHERE $1::uuid IS NOT NULL AND $2::uuid IS NOT NULL AND false`,
    [owner, conv],
    deps,
  );
  const out = {};
  for (const r of rows) {
    if (r.message_id == null) continue;
    out[String(r.message_id)] = {
      durationMs: Number(r.duration_ms) || 0,
      byteSize: Number(r.byte_size) || 0,
      peaks: (r.peaks ?? []).map((p) => Number(p) || 0),
    };
  }
  return out;
}

// ── Reactions ─────────────────────────────────────────────────────────────────
// ONE per person per note, by primary key rather than by application logic, so a
// double tap cannot write two rows.

/** Set (or change) the caller's single reaction. */
export async function setReaction(noteOwnerId, conversationId, reactorAmberId, kind) {
  const conv = asUuid(conversationId);
  const reactor = asUuid(reactorAmberId);
  if (!conv || !reactor || !isReactionKind(kind)) return false;
  await query(
    `INSERT INTO conversation_reactions (conversation_id, reactor_amber_id, kind)
     VALUES ($1, $2, $3)
     ON CONFLICT (conversation_id, reactor_amber_id)
       DO UPDATE SET kind = EXCLUDED.kind, updated_at = now()`,
    [conv, reactor, kind],
  );
  return true;
}

export async function clearReaction(noteOwnerId, conversationId, reactorAmberId) {
  const conv = asUuid(conversationId);
  const reactor = asUuid(reactorAmberId);
  if (!conv || !reactor) return true;
  await query(
    `DELETE FROM conversation_reactions
      WHERE conversation_id = $1 AND reactor_amber_id = $2`,
    [conv, reactor],
  );
  return true;
}

/**
 * Everyone's reactions on a note: per-kind counts, who reacted, and the viewer's
 * own choice so the client can render the selected state without a second
 * request. counts is zero-filled for all five kinds -- the sheet renders a row
 * per kind and a missing key would render undefined.
 */
export async function listReactions(noteOwnerId, conversationId, viewerAmberId = null) {
  const conv = asUuid(conversationId);
  const empty = { counts: zeroCounts(), mine: null, total: 0, people: [] };
  if (!conv) return empty;
  const { rows } = await query(
    `SELECT r.kind, r.reactor_amber_id, u.full_name, u.username, u.avatar_url
       FROM conversation_reactions r
       LEFT JOIN users u ON u.amber_id = r.reactor_amber_id AND u.deleted_at IS NULL
      WHERE r.conversation_id = $1
      ORDER BY r.created_at ASC`,
    [conv],
  );
  const counts = zeroCounts();
  const viewer = asUuid(viewerAmberId);
  let mine = null;
  const people = [];
  for (const r of rows) {
    if (counts[r.kind] != null) counts[r.kind] += 1;
    if (viewer && String(r.reactor_amber_id) === viewer) mine = r.kind;
    people.push({
      amberId: String(r.reactor_amber_id),
      kind: r.kind,
      name: r.full_name ?? null,
      username: r.username ?? null,
      avatarUrl: r.avatar_url ?? null,
    });
  }
  return { counts, mine, total: rows.length, people };
}

// ── Comments ──────────────────────────────────────────────────────────────────

export async function addComment(noteOwnerId, conversationId, authorAmberId, body) {
  const conv = asUuid(conversationId);
  const author = asUuid(authorAmberId);
  const text = typeof body === "string" ? body.trim() : "";
  // Rejected, not truncated. Silently storing the first 1000 characters of a
  // longer comment shows the author something they did not write.
  if (!conv || !author || !text || text.length > MAX_COMMENT_LENGTH) return null;
  const { rows } = await query(
    `INSERT INTO conversation_comments (conversation_id, author_amber_id, body)
     VALUES ($1, $2, $3)
     RETURNING id, created_at`,
    [conv, author, text],
  );
  const row = rows[0];
  return row ? { id: String(row.id), createdAt: row.created_at } : null;
}

export async function listComments(noteOwnerId, conversationId, { limit = 200 } = {}) {
  const conv = asUuid(conversationId);
  if (!conv) return [];
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const { rows } = await query(
    `SELECT c.id, c.body, c.created_at, c.author_amber_id,
            u.full_name, u.username, u.avatar_url
       FROM conversation_comments c
       LEFT JOIN users u ON u.amber_id = c.author_amber_id AND u.deleted_at IS NULL
      WHERE c.conversation_id = $1 AND c.deleted_at IS NULL
      ORDER BY c.created_at ASC
      LIMIT $2`,
    [conv, lim],
  );
  return rows.map((r) => ({
    id: String(r.id),
    body: r.body,
    createdAt: r.created_at,
    author: {
      amberId: String(r.author_amber_id),
      name: r.full_name ?? null,
      username: r.username ?? null,
      avatarUrl: r.avatar_url ?? null,
    },
  }));
}

/**
 * Delete a comment. The AUTHOR can remove their own; the NOTE'S OWNER can remove
 * any comment on their note -- you need to be able to moderate your own post.
 * Both live in the WHERE clause, so a mismatch deletes nothing rather than
 * relying on a prior read somebody can forget to do.
 *
 * THE OWNER BRANCH MUST TEST THE ACTOR, NOT THE CONVERSATION. The first version
 * of this port asked "does this conversation have an owner", which is true of
 * every conversation, so any authenticated user could delete any comment. The
 * old schema could not express that mistake because note_owner_id sat on the
 * comment row itself; hanging comments off the conversation is what created the
 * opportunity. It now asks whether the ACTOR is that owner.
 */
export async function deleteComment(noteOwnerId, conversationId, commentId, actorAmberId) {
  const conv = asUuid(conversationId);
  const actor = asUuid(actorAmberId);
  const id = typeof commentId === "bigint" ? commentId : Number(commentId);
  if (!conv || !actor || !Number.isInteger(Number(id)) || Number(id) <= 0) return false;
  const { rowCount } = await query(
    `UPDATE conversation_comments c
        SET deleted_at = now()
      WHERE c.id = $2::bigint
        AND c.conversation_id = $1
        AND c.deleted_at IS NULL
        AND (
          c.author_amber_id = $3
          OR EXISTS (SELECT 1 FROM conversations cv
                      WHERE cv.conversation_id = $1 AND cv.owner_id = $3)
        )`,
    [conv, String(id), actor],
  );
  return rowCount > 0;
}

/**
 * Audio + reaction + comment-count summaries for a batch of notes, so a feed of N
 * notes costs one query instead of 3N.
 *
 * Keyed "ownerId|conversationId", unchanged -- the feed builds that key from the
 * share row it already has, and re-keying on conversation alone would silently
 * return undefined for every note in the list.
 */
export async function getNoteMetaBatch(pairs, viewerAmberId = null) {
  const list = (Array.isArray(pairs) ? pairs : [])
    .filter((p) => p && asUuid(p.ownerId) && asUuid(p.conversationId))
    .slice(0, 200);
  if (list.length === 0) return {};
  const viewer = asUuid(viewerAmberId);
  const keyOf = (o, c) => `${o}|${c}`;

  const out = {};
  for (const p of list) {
    out[keyOf(p.ownerId, p.conversationId)] = {
      audio: null,
      reactions: { counts: zeroCounts(), mine: null, total: 0 },
      commentCount: 0,
    };
  }

  const owners = list.map((p) => asUuid(p.ownerId));
  const convos = list.map((p) => asUuid(p.conversationId));

  // unnest + join keeps this to one round trip without building a variadic IN
  // list, which is where injection creeps into batch helpers. The three laterals
  // are correlated to the same pair, so the whole summary is one scan of the
  // requested notes rather than three passes over three tables.
  // Through the optional-column helper because of `m.message_id` below: this one
  // query carries the audio, the reactions AND the comment counts for a whole
  // feed page, so a column that has not migrated yet would take all three out at
  // once. See optional-column.js.
  const { rows } = await queryWithOptionalColumn(
    "media_assets.message_id",
    (has) => `SELECT w.owner_id, w.conversation_id,
            a.duration_ms, a.byte_size, a.peaks,
            COALESCE(k.n, 0) AS comment_count,
            COALESCE(r.total, 0) AS reaction_total,
            r.kinds, r.mine
       FROM unnest($1::uuid[], $2::uuid[]) AS w(owner_id, conversation_id)
       LEFT JOIN LATERAL (
         SELECT m.duration_ms, m.byte_size, m.peaks
           FROM media_assets m
          WHERE m.owner_id = w.owner_id AND m.conversation_id = w.conversation_id
            AND m.deleted_at IS NULL AND m.status = 'ready'
            -- The note's own recording. A follow-up's clip is not what the feed
            -- card plays, and picking one up here would show the wrong waveform.
            ${has ? "AND m.message_id IS NULL" : ""}
          LIMIT 1) a ON true
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS n
           FROM conversation_comments cc
          WHERE cc.conversation_id = w.conversation_id AND cc.deleted_at IS NULL) k ON true
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS total,
                jsonb_object_agg(z.kind, z.n) AS kinds,
                max(CASE WHEN z.is_mine THEN z.kind END) AS mine
           FROM (SELECT cr.kind, count(*)::int AS n,
                        bool_or(cr.reactor_amber_id = $3) AS is_mine
                   FROM conversation_reactions cr
                  WHERE cr.conversation_id = w.conversation_id
                  GROUP BY cr.kind) z) r ON true`,
    [owners, convos, viewer],
  );

  for (const r of rows) {
    const bucket = out[keyOf(r.owner_id, r.conversation_id)];
    if (!bucket) continue;
    if (r.duration_ms != null) {
      bucket.audio = {
        durationMs: Number(r.duration_ms) || 0,
        byteSize: Number(r.byte_size) || 0,
        peaks: (r.peaks ?? []).map((p) => Number(p) || 0),
      };
    }
    bucket.commentCount = Number(r.comment_count) || 0;
    // `total` counts DISTINCT KINDS in the subquery, not reactions. Sum the
    // per-kind counts instead, which is what the old row-by-row loop produced.
    const kinds = r.kinds ?? {};
    let total = 0;
    for (const [kind, n] of Object.entries(kinds)) {
      if (bucket.reactions.counts[kind] != null) bucket.reactions.counts[kind] = Number(n) || 0;
      total += Number(n) || 0;
    }
    bucket.reactions.total = total;
    bucket.reactions.mine = r.mine ?? null;
  }
  return out;
}
