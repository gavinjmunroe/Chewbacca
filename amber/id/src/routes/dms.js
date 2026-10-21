/**
 * Direct messages — 1:1 threads between Amber users.
 *
 *   GET    /v1/me/dms                        the thread list (the People-tab section)
 *   GET    /v1/me/dms/candidates             who you can DM, and who to invite
 *   POST   /v1/me/dms/open                   {contactId} | {amberId} -> a thread
 *   GET    /v1/me/dms/:id/messages           ?before=&limit=
 *   POST   /v1/me/dms/:id/messages           {body} -> a text message
 *   GET    /v1/me/dms/:id/search             ?q= keyword match over transcripts
 *   GET    /v1/me/dms/:id/export             the whole visible thread, oldest first
 *   POST   /v1/me/dms/:id/read               {messageId}
 *   DELETE /v1/me/dms/:id                    clears YOUR copy (see dm-store)
 *   POST   /v1/me/dms/:id/block              {blocked:boolean}
 *   POST   /v1/me/dms/:id/voice/upload-url   reserve a clip, get a signed PUT
 *   POST   /v1/me/dms/voice/:messageId       finalize it (server HEADs the object)
 *   GET    /v1/me/dms/voice/:messageId       a short-lived signed playback URL
 *   POST   /v1/me/dms/messages/:messageId/reaction  {kind|null}
 *
 * THE AUTHORIZATION RULE IS IN THE STORE, NOT HERE. Every dm-store function that
 * touches a thread takes the caller's amber_id and re-checks participation in its
 * own WHERE clause, so a handler that forgets a check gets an empty result rather
 * than someone else's messages. This file's job is shape, limits and transport.
 *
 * Delivery is poll-while-open plus push-when-closed: there is no socket here on
 * purpose. The client polls an open thread and the list; a send fires a push
 * through lib/notify.js for the app that is not in the foreground.
 */
import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import { resolveAmberIdByPhone, getContactById } from "../db/store.js";
import { resolveContactAmberUser } from "../db/connections-store.js";
import { listDmCandidates } from "../db/dm-store.js";
import { notifyAmberUsers } from "../lib/notify.js";
import { observeDmMessage } from "../db/interaction-observations.js";
import {
  gcsConfigured,
  signGcsUrl,
  statGcsObject,
} from "../lib/gcs-signing.js";
import {


  DM_MAX_AUDIO_BYTES,
  DM_MAX_AUDIO_MS,
  DM_REACTION_KINDS,
  audioKeyFor,
  clearThreadForMe,
  exportThread,
  finalizeVoiceMessage,
  getOrCreateThread,
  insertTextMessage,
  listPinnedMessages,
  setMessagePinned,
  isBlockedBetween,
  listMessages,
  listThreads,
  markRead,
  reserveVoiceMessage,
  searchThread,
  setBlock,
  setReaction,
  threadCounterparty,
} from "../db/dm-store.js";

// A contact id is a uuid. Declared here rather than inlined so the checks in
// this file cannot drift apart.
const _CONTACT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


// Same rationale as note-media: the signed URL IS the capability, so its lifetime
// is the window in which a leaked link works.
const PLAYBACK_TTL_SECONDS = 300;
const UPLOAD_TTL_SECONDS = 600;

async function resolveMe(request, reply) {
  if (!request.privyUser?.userId) {
    reply.code(401).send({ error: "no_user", message: "Auth required" });
    return null;
  }
  const phone = request.privyUser?.phone;
  const amberId = phone ? await resolveAmberIdByPhone(phone).catch(() => null) : null;
  if (!amberId) {
    reply.code(401).send({ error: "no_amber_id", message: "Account not found" });
    return null;
  }
  return amberId;
}

/** A truthy positive integer id from a path param, or null after replying 400. */
function idParam(request, reply, key = "id") {
  const raw = String(request.params?.[key] ?? "").trim();
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) {
    reply.code(400).send({ error: "bad_id", message: "A valid id is required." });
    return null;
  }
  return n;
}

/**
 * The counterparty, or null after replying. Combines "is this thread mine" with
 * "who is the other person" because every mutating route needs both and doing
 * only the second is the mistake worth making impossible.
 */
async function requireThread(threadId, me, reply) {
  const other = await threadCounterparty(threadId, me);
  if (!other) {
    reply.code(404).send({ error: "thread_not_found" });
    return null;
  }
  return other;
}

const _preview = (msg, senderName) => {
  if (!msg) return "New message";
  if (msg.kind === "voice") {
    // The transcript is the preview when we have one. "Voice message" tells you
    // nothing about whether it is worth opening.
    if (msg.body) return msg.body.slice(0, 140);
    const secs = Math.round((msg.durationMs || 0) / 1000);
    return secs > 0 ? `Voice message · ${secs}s` : "Voice message";
  }
  return (msg.body || "New message").slice(0, 140);
};

export function registerDmRoutes(app, deps = {}) {
  const requireAuth = deps.requireAuth || defaultRequireAuth;
  const notify = deps.notifyAmberUsers || notifyAmberUsers;

  // ── The section on the People tab ──────────────────────────────────────────
  app.get("/v1/me/dms", { preHandler: [requireAuth] }, async (request, reply) => {
    const me = await resolveMe(request, reply);
    if (!me) return;
    const threads = await listThreads(me, { limit: 50 }).catch(() => []);
    return { threads };
  });

  /**
   * Who the caller can actually message, and who to invite instead.
   *
   * This is the honest answer to "why is my DM list empty": a contact is
   * messageable only when their number matches an Amber account. Everyone else
   * comes back under `invite` with their phone, so the picker can offer an
   * invite (and the contact card can hand off to iMessage) rather than
   * pretending a chat exists.
   */
  // ── GET /v1/me/dms/candidates?q= ──────────────────────────────────────────
  //
  // No contactIds any more. The old signature took up to 200 of them in the
  // query string — roughly 7KB of URL — and then did two sequential awaits per
  // id, so a full address book meant four hundred round trips per keystroke.
  // One indexed query answers the whole question now; see
  // db/dm-store.listDmCandidates for why, and for what it replaced.
  app.get(
    "/v1/me/dms/candidates",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const me = await resolveMe(request, reply);
      if (!me) return;
      const q = typeof request.query?.q === "string" ? request.query.q.trim() : "";
      const limit = Math.min(Number(request.query?.limit) || 80, 200);
      try {
        return await listDmCandidates(me, { q, limit });
      } catch {
        // A 500, not two empty arrays. "Nobody to message" and "we could not
        // ask" are different sentences and the app renders them differently.
        return reply
          .code(500)
          .send({ error: "candidates_failed", message: "Could not load your contacts." });
      }
    },
  );

  // ── Open (or create) a thread ─────────────────────────────────────────────
  app.post(
    "/v1/me/dms/open",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          properties: {
            amberId: { type: "string", maxLength: 64 },
            contactId: { type: "string", maxLength: 32 },
          },
        },
      },
    },
    async (request, reply) => {
      const me = await resolveMe(request, reply);
      if (!me) return;
      const body = request.body || {};
      let otherAmberId =
        typeof body.amberId === "string" && body.amberId.trim() ? body.amberId.trim() : null;

      // A contactId is the ordinary path — the app knows a contact, not an
      // account. Resolving here (rather than trusting a client-supplied
      // amberId) means the caller can only open a thread with someone whose
      // number is in their OWN address book.
      // This branch is how a DM opens against somebody in your own address book,
      // and /^\d+$/ meant it never fired for a real contact id.
      if (!otherAmberId && _CONTACT_ID_RE.test(String(body.contactId ?? ""))) {
        const contact = await getContactById(me, String(body.contactId)).catch(() => null);

        // ── THE LINK FIRST, THE PHONE SECOND ──────────────────────────────
        //
        // This resolved the card to an account by PHONE only, so a contact
        // saved with just an email -- or one whose account signed up with a
        // number the owner never saved -- came back "not_on_amber", and tapping
        // them in the new-message list spun and then said "Couldn't open chat".
        // For somebody who demonstrably HAS an Amber account and an Amber
        // username, that is simply wrong.
        //
        // contacts.linked_amber_id is the answer and it is already on the row:
        // db/identity-link.js writes it from a phone OR an email the account
        // itself proved, and from a human confirmation. It is the same field
        // circle membership, note sharing and the DM candidate list all resolve
        // through -- so reading it here makes this route agree with every other
        // surface in the app about who is reachable.
        //
        // The phone path stays as the fallback for a card that has never been
        // linked but whose number matches a registered account (a contact synced
        // after the last link sweep).
        const linked =
          contact?.linkedAmberId ??
          contact?.linked_amber_id ??
          null;
        if (linked && String(linked) !== String(me)) {
          otherAmberId = String(linked);
        } else {
          const phones = contact
            ? [
                ...(Array.isArray(contact.phoneNumbers) ? contact.phoneNumbers : []),
                contact.phone,
              ].filter(Boolean)
            : [];
          const user = phones.length
            ? await resolveContactAmberUser(me, phones).catch(() => null)
            : null;
          if (!user?.amberId) {
            request.log?.info?.(
              `DM_OPEN_NOT_ON_AMBER owner=${me} contact=${body.contactId} ` +
                `linked=${linked ?? "none"} phones=${phones.length}`,
            );
            return reply.code(409).send({
              error: "not_on_amber",
              message: "They are not on Amber yet.",
              invite: { name: contact?.name ?? null, phone: contact?.phone ?? phones[0] ?? null },
            });
          }
          otherAmberId = user.amberId;
        }
      }
      if (!otherAmberId) {
        return reply.code(400).send({ error: "recipient_required" });
      }
      if (await isBlockedBetween(me, otherAmberId)) {
        return reply.code(403).send({ error: "blocked" });
      }
      const thread = await getOrCreateThread(me, otherAmberId);
      if (!thread) return reply.code(400).send({ error: "cannot_open" });
      return { threadId: thread.id, otherAmberId: thread.otherAmberId };
    },
  );

  // ── Messages ──────────────────────────────────────────────────────────────
  app.get(
    "/v1/me/dms/:id/messages",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const me = await resolveMe(request, reply);
      if (!me) return;
      const threadId = idParam(request, reply);
      if (!threadId) return;
      if (!(await requireThread(threadId, me, reply))) return;
      const messages = await listMessages(threadId, me, {
        limit: Number(request.query?.limit) || 40,
        before: request.query?.before ?? null,
      }).catch(() => []);
      return { messages };
    },
  );

  app.post(
    "/v1/me/dms/:id/messages",
    {
      preHandler: [requireAuth],
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      schema: {
        body: {
          type: "object",
          required: ["body"],
          properties: { body: { type: "string", minLength: 1, maxLength: 4000 } },
        },
      },
    },
    async (request, reply) => {
      const me = await resolveMe(request, reply);
      if (!me) return;
      const threadId = idParam(request, reply);
      if (!threadId) return;
      const other = await requireThread(threadId, me, reply);
      if (!other) return;
      // Checked at SEND time, not only at open time: someone can block you while
      // your thread is on screen, and the composer has no way to know.
      if (await isBlockedBetween(me, other)) {
        return reply.code(403).send({ error: "blocked" });
      }
      const message = await insertTextMessage(threadId, me, request.body?.body);
      if (!message) return reply.code(400).send({ error: "send_failed" });
      // The sender's own read mark advances to their own message, or their unread
      // count would include what they just said.
      void markRead(threadId, me, message.id).catch(() => {});
      void _push(notify, other, me, threadId, message, request.log);
      // BOTH INSTANCES LEARN FROM IT. "If me and Maggie are talking in a direct
      // chat, then that information should feed our Amber instances of each
      // other." One row per side per hour of conversation, each against that
      // owner's own card for the other person — see
      // db/interaction-observations.js. Fire-and-forget: it must not be able to
      // fail a send, and the sender is holding a phone.
      void observeDmMessage({
        senderAmberId: me,
        recipientAmberId: other,
        text: message.body,
        log: request.log,
      }).catch(() => {});
      return { message };
    },
  );

  // ── Search + export ───────────────────────────────────────────────────────
  app.get("/v1/me/dms/:id/search", { preHandler: [requireAuth] }, async (request, reply) => {
    const me = await resolveMe(request, reply);
    if (!me) return;
    const threadId = idParam(request, reply);
    if (!threadId) return;
    if (!(await requireThread(threadId, me, reply))) return;
    const q = String(request.query?.q ?? "");
    const messages = await searchThread(threadId, me, q, { limit: 50 }).catch(() => []);
    return { query: q.trim(), messages };
  });

  app.get("/v1/me/dms/:id/export", { preHandler: [requireAuth] }, async (request, reply) => {
    const me = await resolveMe(request, reply);
    if (!me) return;
    const threadId = idParam(request, reply);
    if (!threadId) return;
    if (!(await requireThread(threadId, me, reply))) return;
    const messages = await exportThread(threadId, me);
    if (!messages) return reply.code(404).send({ error: "thread_not_found" });
    return { threadId: String(threadId), count: messages.length, messages };
  });

  // ── Read receipts, delete, block ──────────────────────────────────────────
  app.post(
    "/v1/me/dms/:id/read",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["messageId"],
          properties: { messageId: { type: "string", maxLength: 32 } },
        },
      },
    },
    async (request, reply) => {
      const me = await resolveMe(request, reply);
      if (!me) return;
      const threadId = idParam(request, reply);
      if (!threadId) return;
      const ok = await markRead(threadId, me, request.body?.messageId);
      return { ok };
    },
  );

  app.delete("/v1/me/dms/:id", { preHandler: [requireAuth] }, async (request, reply) => {
    const me = await resolveMe(request, reply);
    if (!me) return;
    const threadId = idParam(request, reply);
    if (!threadId) return;
    const ok = await clearThreadForMe(threadId, me);
    if (!ok) return reply.code(404).send({ error: "thread_not_found" });
    // `cleared`, not `deleted`: the other person still has their copy, and the
    // client's copy should say so rather than imply a mutual wipe.
    return { ok: true, cleared: true };
  });

  app.post(
    "/v1/me/dms/:id/block",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          properties: { blocked: { type: "boolean" } },
        },
      },
    },
    async (request, reply) => {
      const me = await resolveMe(request, reply);
      if (!me) return;
      const threadId = idParam(request, reply);
      if (!threadId) return;
      const other = await requireThread(threadId, me, reply);
      if (!other) return;
      const blocked = request.body?.blocked !== false;
      const ok = await setBlock(me, other, blocked);
      if (!ok) return reply.code(400).send({ error: "block_failed" });
      return { ok: true, blocked };
    },
  );

  // ── Pins ──────────────────────────────────────────────────────────────────
  //
  // A shared bookmark on the thread: what people pin in a chat is the voice memo
  // or the one line with the address in it, and in a thread months long the only
  // way back to it was scrolling. Membership of the thread is the permission,
  // not authorship of the message -- you pin what THEY said at least as often.
  app.post(
    "/v1/me/dms/messages/:messageId/pin",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          properties: { pinned: { type: "boolean" } },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const me = await resolveMe(request, reply);
      if (!me) return;
      const messageId = idParam(request, reply, "messageId");
      if (!messageId) return;
      const pinned = request.body?.pinned !== false;
      const message = await setMessagePinned(messageId, me, pinned);
      // One answer for "no such message" and "not your thread", on purpose.
      if (!message) return reply.code(404).send({ error: "message_not_found" });
      return { message, pinned };
    },
  );

  app.get(
    "/v1/me/dms/:id/pinned",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const me = await resolveMe(request, reply);
      if (!me) return;
      const threadId = idParam(request, reply);
      if (!threadId) return;
      if (!(await requireThread(threadId, me, reply))) return;
      const messages = await listPinnedMessages(threadId, me, { limit: 30 });
      return { messages };
    },
  );

  // ── Reactions ─────────────────────────────────────────────────────────────
  app.post(
    "/v1/me/dms/messages/:messageId/reaction",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          properties: {
            kind: { type: ["string", "null"], enum: [...DM_REACTION_KINDS, null] },
          },
        },
      },
    },
    async (request, reply) => {
      const me = await resolveMe(request, reply);
      if (!me) return;
      const messageId = idParam(request, reply, "messageId");
      if (!messageId) return;
      const kind = request.body?.kind ?? null;
      const reactions = await setReaction(messageId, me, kind);
      if (!reactions) return reply.code(404).send({ error: "message_not_found" });
      return { reactions };
    },
  );

  // ── Voice: reserve, upload straight to GCS, finalize, play ────────────────
  app.post(
    "/v1/me/dms/:id/voice/upload-url",
    { preHandler: [requireAuth], config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const me = await resolveMe(request, reply);
      if (!me) return;
      const threadId = idParam(request, reply);
      if (!threadId) return;
      const other = await requireThread(threadId, me, reply);
      if (!other) return;
      if (await isBlockedBetween(me, other)) {
        return reply.code(403).send({ error: "blocked" });
      }
      if (!gcsConfigured()) {
        return reply.code(503).send({ error: "storage_unconfigured" });
      }
      const reserved = await reserveVoiceMessage(threadId, me, {
        contentType: request.body?.contentType,
      });
      if (!reserved) return reply.code(400).send({ error: "reserve_failed" });
      const uploadUrl = signGcsUrl({
        objectName: reserved.storageKey,
        method: "PUT",
        contentType: reserved.contentType,
        expiresSeconds: UPLOAD_TTL_SECONDS,
      });
      if (!uploadUrl) return reply.code(503).send({ error: "sign_failed" });
      return {
        messageId: reserved.messageId,
        uploadUrl,
        contentType: reserved.contentType,
        expiresIn: UPLOAD_TTL_SECONDS,
        maxBytes: DM_MAX_AUDIO_BYTES,
        maxDurationMs: DM_MAX_AUDIO_MS,
      };
    },
  );

  app.post(
    "/v1/me/dms/voice/:messageId",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          properties: {
            durationMs: { type: "number" },
            peaks: { type: "array", items: { type: "number" }, maxItems: 400 },
            transcript: { type: "string", maxLength: 4000 },
          },
        },
      },
    },
    async (request, reply) => {
      const me = await resolveMe(request, reply);
      if (!me) return;
      const messageId = idParam(request, reply, "messageId");
      if (!messageId) return;
      // NEVER TRUST THE CLIENT FOR THE SIZE. Ask the bucket what actually
      // landed; a client that says "0 bytes" or "12MB" is not evidence.
      //
      // The key comes from _reservedKey, not audioKeyFor: at this point the row
      // is still 'pending' by definition, and audioKeyFor deliberately only
      // serves 'ready' rows. _reservedKey is scoped to sender_amber_id, so a
      // caller can only finalize a clip they themselves reserved.
      const key = await _reservedKey(messageId, me).catch(() => null);
      if (!key) return reply.code(404).send({ error: "message_not_found" });
      let stat = null;
      try {
        stat = await statGcsObject(key);
      } catch {
        stat = null;
      }
      const byteSize = Number(stat?.size) || 0;
      if (byteSize <= 0) {
        return reply.code(409).send({ error: "no_object", message: "Upload did not land." });
      }
      if (byteSize > DM_MAX_AUDIO_BYTES) {
        return reply.code(413).send({ error: "too_large" });
      }
      const message = await finalizeVoiceMessage(messageId, me, {
        durationMs: request.body?.durationMs,
        byteSize,
        peaks: request.body?.peaks,
        transcript: request.body?.transcript,
      });
      if (!message) return reply.code(404).send({ error: "message_not_found" });
      // _pushVoice resolves the thread and the counterparty itself, because the
      // shaped message deliberately does not carry the thread id.
      void _pushVoice(notify, me, message, request.log);
      return { message };
    },
  );

  app.get(
    "/v1/me/dms/voice/:messageId",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const me = await resolveMe(request, reply);
      if (!me) return;
      const messageId = idParam(request, reply, "messageId");
      if (!messageId) return;
      if (!gcsConfigured()) {
        return reply.code(503).send({ error: "storage_unconfigured" });
      }
      const meta = await audioKeyFor(messageId, me);
      if (!meta) return reply.code(404).send({ error: "audio_not_found" });
      const playbackUrl = signGcsUrl({
        objectName: meta.storageKey,
        method: "GET",
        expiresSeconds: PLAYBACK_TTL_SECONDS,
      });
      if (!playbackUrl) return reply.code(503).send({ error: "sign_failed" });
      return {
        playbackUrl,
        expiresIn: PLAYBACK_TTL_SECONDS,
        contentType: meta.contentType,
        durationMs: meta.durationMs,
        byteSize: meta.byteSize,
        peaks: meta.peaks,
      };
    },
  );
}

/** The reserved object key for a message the caller sent but has not finalized. */
async function _reservedKey(messageId, me) {
  const { query } = await import("../db/sql.js");
  const { rows } = await query(
    `SELECT storage_key FROM dm_messages
      WHERE id = $1 AND sender_amber_id = $2::uuid AND kind = 'voice'`,
    [messageId, me],
  );
  return rows[0]?.storage_key ?? null;
}

/**
 * Push for a text message. Fire-and-forget everywhere: a notification that fails
 * must never fail the send, because the message IS delivered — the recipient just
 * finds it a moment later instead of immediately.
 */
async function _push(notify, otherAmberId, me, threadId, message, log) {
  try {
    const { getUserProfileByAmberId } = await import("../db/store.js");
    const profile = await getUserProfileByAmberId(me).catch(() => null);
    const name = profile?.displayName || profile?.name || "Someone";
    // TWO WRONG KEYS, AND THE PUSH NEVER LEFT THE BUILDING.
    //
    // `amberIds` is not notifyAmberUsers's parameter -- it is `ownerIds` -- so
    // the recipient list arrived as [undefined], was filtered to empty, and the
    // function returned before sending anything. Every DM notification in the
    // app has been silently dropped at this line. And `data.kind` is not what
    // the tap handler reads either: destinationForNotification switches on
    // `data.type`, so even a delivered one would have opened Home rather than
    // the thread it was about.
    await notify({
      ownerIds: [otherAmberId],
      title: name,
      body: _preview(message, name),
      data: { type: "dm", threadId: String(threadId), messageId: String(message.id) },
      // So "mute Sagar" silences his messages too, and so a recipient who has
      // turned direct messages off in Settings stops getting them.
      fromAmberId: me,
      log,
    });
  } catch (err) {
    log?.warn?.({ err: err?.message }, "[dms] push failed");
  }
}

async function _pushVoice(notify, me, message, log) {
  try {
    const { query } = await import("../db/sql.js");
    const { rows } = await query(
      `SELECT CASE WHEN t.a_amber_id = $2::uuid THEN t.b_amber_id ELSE t.a_amber_id END AS other,
              t.id AS thread_id
         FROM dm_messages m JOIN dm_threads t ON t.id = m.thread_id
        WHERE m.id = $1`,
      [message.id, me],
    );
    const other = rows[0]?.other ? String(rows[0].other) : null;
    if (!other) return;
    await _push(notify, other, me, String(rows[0].thread_id), message, log);
  } catch (err) {
    log?.warn?.({ err: err?.message }, "[dms] voice push failed");
  }
}
