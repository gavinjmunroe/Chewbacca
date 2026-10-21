/**
 * Voice-note MEDIA: the audio itself, tapback reactions, and comments.
 *
 *   POST   /v1/me/notes/:id/audio/upload-url   owner mints a signed PUT
 *   POST   /v1/me/notes/:id/audio              owner finalizes (server verifies the object)
 *   DELETE /v1/me/notes/:id/audio              owner removes the clip
 *
 *   POST   /v1/me/notes/:id/messages/:messageId/audio/upload-url
 *   POST   /v1/me/notes/:id/messages/:messageId/audio
 *   GET    /v1/me/notes/:id/messages/:messageId/audio   owner's own playback
 *   DELETE /v1/me/notes/:id/messages/:messageId/audio
 *
 *   GET    /v1/notes/:ownerId/:id/audio        signed, short-lived playback URL
 *   GET    /v1/notes/:ownerId/:id/messages/:messageId/audio
 *   GET    /v1/notes/:ownerId/:id/reactions
 *   PUT    /v1/notes/:ownerId/:id/reactions    { kind } — one per person, upsert
 *   DELETE /v1/notes/:ownerId/:id/reactions
 *   GET    /v1/notes/:ownerId/:id/comments
 *   POST   /v1/notes/:ownerId/:id/comments     { body }
 *   DELETE /v1/notes/:ownerId/:id/comments/:commentId
 *
 * `:id` is the conversation_id (TEXT). `:ownerId` is the note owner's amber_id
 * (UUID) — it names WHOSE note this is, and grants nothing by itself.
 *
 * AUTHORIZATION. The /v1/me/* routes require ownership of the note. Every
 * /v1/notes/* route calls canViewNote() first, which resolves the caller's live
 * reach (network connection / contact share / current circle membership) in SQL.
 * A caller who is not in the circle gets 404 — not 403 — so the endpoint cannot
 * be used to probe whether a given note exists.
 */

import {
  MAX_AUDIO_BYTES,
  MAX_DURATION_MS,
  AUDIO_CONTENT_TYPE,
  REACTION_KINDS,
  addComment,
  canViewNote,
  clearReaction,
  deleteAudio,
  deleteComment,
  getAudioRow,
  isReactionKind,
  listComments,
  listReactions,
  markAudioReady,
  ownerOwnsNote,
  reserveAudioUpload,
  setReaction,
  reserveMessageAudioUpload,
  getMessageAudioRow,
  markMessageAudioReady,
  deleteMessageAudio,
} from "../db/note-media-store.js";
import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import { resolveAmberIdByPhone } from "../db/store.js";
import {
  deleteGcsObject,
  gcsConfigured,
  signGcsUrl,
  statGcsObject,
} from "../lib/gcs-signing.js";

// How long a signed URL lives. Short by design: the URL IS the capability, so its
// lifetime is the window in which a leaked link works. Long enough to start
// playback on a slow connection, short enough to be worthless if it leaks.
const PLAYBACK_TTL_SECONDS = 300;
const UPLOAD_TTL_SECONDS = 600;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveViewer(request, reply) {
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
  return { amberId, phone };
}

function conversationIdOf(request, reply) {
  const id = String(request.params?.id || "").trim();
  if (!id || id.length > 200) {
    reply.code(400).send({ error: "note_required", message: "A note id is required." });
    return null;
  }
  return id;
}

/** Validate the owner id BEFORE it reaches a ::uuid cast, which would 500 on junk. */
function ownerIdOf(request, reply) {
  const raw = String(request.params?.ownerId || "").trim();
  if (!UUID_RE.test(raw)) {
    reply.code(400).send({ error: "invalid_owner", message: "Malformed note owner." });
    return null;
  }
  return raw;
}

/**
 * Resolve the caller AND their right to see this note in one step. Returns null
 * having already replied, so every handler below is a straight line.
 */
async function resolveViewerForNote(request, reply) {
  const viewer = await resolveViewer(request, reply);
  if (!viewer) return null;
  const ownerId = ownerIdOf(request, reply);
  if (!ownerId) return null;
  const conversationId = conversationIdOf(request, reply);
  if (!conversationId) return null;
  const allowed = await canViewNote(viewer.amberId, viewer.phone, ownerId, conversationId).catch(
    () => false,
  );
  if (!allowed) {
    // 404, not 403: a 403 would confirm the note exists to someone with no
    // business knowing that.
    reply.code(404).send({ error: "note_not_found", message: "No such note." });
    return null;
  }
  return { ...viewer, ownerId, conversationId };
}

export function registerNoteMediaRoutes(app, deps = {}) {
  const requireAuth = deps.requireAuth || defaultRequireAuth;

  // ── Owner: attach audio ─────────────────────────────────────────────────────

  app.post(
    "/v1/me/notes/:id/audio/upload-url",
    { preHandler: [requireAuth], config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const viewer = await resolveViewer(request, reply);
      if (!viewer) return;
      const conversationId = conversationIdOf(request, reply);
      if (!conversationId) return;
      if (!gcsConfigured()) {
        return reply.code(503).send({
          error: "audio_storage_unconfigured",
          message: "Voice-note audio storage is not configured on this server.",
        });
      }
      if (!(await ownerOwnsNote(viewer.amberId, conversationId))) {
        return reply.code(404).send({ error: "note_not_found", message: "No such note." });
      }
      // The key is minted and persisted HERE. Finalize reads it back from the
      // row, so the client never names an object and cannot point the server at
      // someone else's.
      const storageKey = await reserveAudioUpload(viewer.amberId, conversationId);
      const uploadUrl = signGcsUrl({
        objectName: storageKey,
        method: "PUT",
        expiresSeconds: UPLOAD_TTL_SECONDS,
        contentType: AUDIO_CONTENT_TYPE,
      });
      return {
        uploadUrl,
        contentType: AUDIO_CONTENT_TYPE,
        expiresIn: UPLOAD_TTL_SECONDS,
        maxBytes: MAX_AUDIO_BYTES,
        maxDurationMs: MAX_DURATION_MS,
      };
    },
  );

  app.post(
    "/v1/me/notes/:id/audio",
    {
      preHandler: [requireAuth],
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        body: {
          type: "object",
          properties: {
            durationMs: { type: "integer", minimum: 0, maximum: MAX_DURATION_MS },
            // The sender's own waveform, so every listener sees the same shape.
            peaks: { type: "array", maxItems: 512, items: { type: "integer" } },
          },
        },
      },
    },
    async (request, reply) => {
      const viewer = await resolveViewer(request, reply);
      if (!viewer) return;
      const conversationId = conversationIdOf(request, reply);
      if (!conversationId) return;

      const row = await getAudioRow(viewer.amberId, conversationId);
      if (!row) {
        return reply
          .code(409)
          .send({ error: "no_pending_upload", message: "Ask for an upload URL first." });
      }

      // NEVER TRUST THE CLIENT FOR THE SIZE OR THE TYPE. Ask the bucket what is
      // actually there. A client that lies about a 200MB file, or PUTs HTML with
      // an audio content type, is caught here and the object is removed.
      let stat;
      try {
        stat = await statGcsObject(row.storage_key);
      } catch (e) {
        request.log?.error?.({ err: e?.message }, "[note-media] stat failed");
        return reply
          .code(502)
          .send({ error: "storage_unreachable", message: "Could not verify the upload." });
      }
      if (!stat.exists) {
        return reply
          .code(409)
          .send({ error: "upload_missing", message: "That clip never finished uploading." });
      }
      if (stat.size > MAX_AUDIO_BYTES) {
        await deleteGcsObject(row.storage_key);
        await deleteAudio(viewer.amberId, conversationId);
        return reply
          .code(413)
          .send({ error: "clip_too_large", message: "That voice note is too long." });
      }

      const body = request.body || {};
      await markAudioReady(viewer.amberId, conversationId, {
        durationMs: body.durationMs ?? 0,
        byteSize: stat.size,
        peaks: body.peaks ?? [],
      });
      request.log?.info?.(
        { ownerId: viewer.amberId, conversationId, bytes: stat.size },
        "[note-media] audio ready",
      );
      return { ok: true, byteSize: stat.size };
    },
  );

  app.delete(
    "/v1/me/notes/:id/audio",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const viewer = await resolveViewer(request, reply);
      if (!viewer) return;
      const conversationId = conversationIdOf(request, reply);
      if (!conversationId) return;
      const row = await getAudioRow(viewer.amberId, conversationId);
      if (row?.storage_key) await deleteGcsObject(row.storage_key);
      await deleteAudio(viewer.amberId, conversationId);
      return { ok: true };
    },
  );

  // ── Owner: attach audio to ONE MESSAGE of a note ───────────────────────────
  //
  // A spoken follow-up inside an expanded card. The transcript becomes the
  // message; this is where its recording goes. Same three legs, same server
  // ownership of the key and the verified size -- the note-level endpoints
  // above could not be reused because media_assets holds one live row per
  // conversation, so attaching a follow-up's clip there replaced the clip the
  // card itself plays.
  const messageIdOf = (request, reply) => {
    const raw = String(request.params?.messageId || "").trim();
    // Digits only, and bounded: this reaches a ::bigint cast, and "abc" or a
    // 40-digit number would be a 500 rather than a 400.
    if (!/^[0-9]{1,18}$/.test(raw) || raw === "0") {
      reply.code(400).send({ error: "invalid_message", message: "Malformed message id." });
      return null;
    }
    return raw;
  };

  app.post(
    "/v1/me/notes/:id/messages/:messageId/audio/upload-url",
    { preHandler: [requireAuth], config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const viewer = await resolveViewer(request, reply);
      if (!viewer) return;
      const conversationId = conversationIdOf(request, reply);
      if (!conversationId) return;
      const messageId = messageIdOf(request, reply);
      if (!messageId) return;
      if (!gcsConfigured()) {
        return reply.code(503).send({
          error: "audio_storage_unconfigured",
          message: "Voice-note audio storage is not configured on this server.",
        });
      }
      // reserveMessageAudioUpload checks that the message is this owner's AND in
      // this thread, in SQL, so a guessed bigserial reserves nothing. A null
      // back from it is indistinguishable from "no such note" on purpose.
      const storageKey = await reserveMessageAudioUpload(
        viewer.amberId,
        conversationId,
        messageId,
      );
      if (!storageKey) {
        return reply
          .code(404)
          .send({ error: "message_not_found", message: "No such message." });
      }
      const uploadUrl = signGcsUrl({
        objectName: storageKey,
        method: "PUT",
        expiresSeconds: UPLOAD_TTL_SECONDS,
        contentType: AUDIO_CONTENT_TYPE,
      });
      return {
        uploadUrl,
        contentType: AUDIO_CONTENT_TYPE,
        expiresIn: UPLOAD_TTL_SECONDS,
        maxBytes: MAX_AUDIO_BYTES,
        maxDurationMs: MAX_DURATION_MS,
      };
    },
  );

  app.post(
    "/v1/me/notes/:id/messages/:messageId/audio",
    {
      preHandler: [requireAuth],
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        body: {
          type: "object",
          properties: {
            durationMs: { type: "integer", minimum: 0, maximum: MAX_DURATION_MS },
            peaks: { type: "array", maxItems: 512, items: { type: "integer" } },
          },
        },
      },
    },
    async (request, reply) => {
      const viewer = await resolveViewer(request, reply);
      if (!viewer) return;
      const conversationId = conversationIdOf(request, reply);
      if (!conversationId) return;
      const messageId = messageIdOf(request, reply);
      if (!messageId) return;

      const row = await getMessageAudioRow(viewer.amberId, conversationId, messageId);
      if (!row) {
        return reply
          .code(409)
          .send({ error: "no_pending_upload", message: "Ask for an upload URL first." });
      }

      // NEVER TRUST THE CLIENT FOR THE SIZE OR THE TYPE -- ask the bucket, same
      // as the note-level finalize.
      let stat;
      try {
        stat = await statGcsObject(row.storage_key);
      } catch (e) {
        request.log?.error?.({ err: e?.message }, "[note-media] message stat failed");
        return reply
          .code(502)
          .send({ error: "storage_unreachable", message: "Could not verify the upload." });
      }
      if (!stat.exists) {
        return reply
          .code(409)
          .send({ error: "upload_missing", message: "That clip never finished uploading." });
      }
      if (stat.size > MAX_AUDIO_BYTES) {
        await deleteGcsObject(row.storage_key);
        await deleteMessageAudio(viewer.amberId, conversationId, messageId);
        return reply
          .code(413)
          .send({ error: "clip_too_large", message: "That voice note is too long." });
      }

      const body = request.body || {};
      await markMessageAudioReady(viewer.amberId, conversationId, messageId, {
        durationMs: body.durationMs ?? 0,
        byteSize: stat.size,
        peaks: body.peaks ?? [],
      });
      request.log?.info?.(
        { ownerId: viewer.amberId, conversationId, messageId, bytes: stat.size },
        "[note-media] message audio ready",
      );
      return { ok: true, byteSize: stat.size };
    },
  );

  app.get(
    "/v1/me/notes/:id/messages/:messageId/audio",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      // THE OWNER'S OWN PLAYBACK, and it exists so the app does not need to know
      // its own amber id to play back a clip in its own thread. The /v1/notes/
      // route below is for a note somebody SHARED, where naming whose note it is
      // is the point; here the caller is the owner by construction, which is a
      // narrower check rather than a looser one.
      const viewer = await resolveViewer(request, reply);
      if (!viewer) return;
      const conversationId = conversationIdOf(request, reply);
      if (!conversationId) return;
      const messageId = messageIdOf(request, reply);
      if (!messageId) return;
      const row = await getMessageAudioRow(viewer.amberId, conversationId, messageId);
      if (!row || row.status !== "ready") {
        return reply
          .code(404)
          .send({ error: "no_audio", message: "That message has no audio." });
      }
      if (!gcsConfigured()) {
        return reply.code(503).send({
          error: "audio_storage_unconfigured",
          message: "Voice-note audio storage is not configured on this server.",
        });
      }
      const playbackUrl = signGcsUrl({
        objectName: row.storage_key,
        method: "GET",
        expiresSeconds: PLAYBACK_TTL_SECONDS,
      });
      return {
        playbackUrl,
        expiresIn: PLAYBACK_TTL_SECONDS,
        contentType: row.content_type,
        durationMs: Number(row.duration_ms) || 0,
        byteSize: Number(row.byte_size) || 0,
        peaks: (row.peaks ?? []).map((p) => Number(p) || 0),
      };
    },
  );

  app.delete(
    "/v1/me/notes/:id/messages/:messageId/audio",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const viewer = await resolveViewer(request, reply);
      if (!viewer) return;
      const conversationId = conversationIdOf(request, reply);
      if (!conversationId) return;
      const messageId = messageIdOf(request, reply);
      if (!messageId) return;
      const row = await getMessageAudioRow(viewer.amberId, conversationId, messageId);
      if (row?.storage_key) await deleteGcsObject(row.storage_key);
      await deleteMessageAudio(viewer.amberId, conversationId, messageId);
      return { ok: true };
    },
  );

  // ── Viewer: playback ────────────────────────────────────────────────────────

  app.get(
    "/v1/notes/:ownerId/:id/audio",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const ctx = await resolveViewerForNote(request, reply);
      if (!ctx) return;
      const row = await getAudioRow(ctx.ownerId, ctx.conversationId);
      if (!row || row.status !== "ready") {
        return reply
          .code(404)
          .send({ error: "no_audio", message: "This note has no audio yet." });
      }
      if (!gcsConfigured()) {
        return reply.code(503).send({
          error: "audio_storage_unconfigured",
          message: "Voice-note audio storage is not configured on this server.",
        });
      }
      // Signed AFTER the membership check, and only for this listener, for the
      // next few minutes.
      const playbackUrl = signGcsUrl({
        objectName: row.storage_key,
        method: "GET",
        expiresSeconds: PLAYBACK_TTL_SECONDS,
      });
      return {
        playbackUrl,
        expiresIn: PLAYBACK_TTL_SECONDS,
        contentType: row.content_type,
        durationMs: Number(row.duration_ms) || 0,
        byteSize: Number(row.byte_size) || 0,
        peaks: (row.peaks ?? []).map((p) => Number(p) || 0),
      };
    },
  );

  app.get(
    "/v1/notes/:ownerId/:id/messages/:messageId/audio",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      // SAME REACH CHECK AS THE NOTE. A clip inside a note is readable by
      // exactly the people who can read the note, and by nobody else -- so this
      // goes through resolveViewerForNote rather than inventing a second rule.
      const ctx = await resolveViewerForNote(request, reply);
      if (!ctx) return;
      const messageId = messageIdOf(request, reply);
      if (!messageId) return;
      const row = await getMessageAudioRow(ctx.ownerId, ctx.conversationId, messageId);
      if (!row || row.status !== "ready") {
        return reply
          .code(404)
          .send({ error: "no_audio", message: "That message has no audio." });
      }
      if (!gcsConfigured()) {
        return reply.code(503).send({
          error: "audio_storage_unconfigured",
          message: "Voice-note audio storage is not configured on this server.",
        });
      }
      const playbackUrl = signGcsUrl({
        objectName: row.storage_key,
        method: "GET",
        expiresSeconds: PLAYBACK_TTL_SECONDS,
      });
      return {
        playbackUrl,
        expiresIn: PLAYBACK_TTL_SECONDS,
        contentType: row.content_type,
        durationMs: Number(row.duration_ms) || 0,
        byteSize: Number(row.byte_size) || 0,
        peaks: (row.peaks ?? []).map((p) => Number(p) || 0),
      };
    },
  );

  // ── Viewer: reactions ───────────────────────────────────────────────────────

  app.get(
    "/v1/notes/:ownerId/:id/reactions",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const ctx = await resolveViewerForNote(request, reply);
      if (!ctx) return;
      return await listReactions(ctx.ownerId, ctx.conversationId, ctx.amberId);
    },
  );

  app.put(
    "/v1/notes/:ownerId/:id/reactions",
    {
      preHandler: [requireAuth],
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      schema: {
        body: {
          type: "object",
          required: ["kind"],
          properties: { kind: { type: "string", enum: REACTION_KINDS } },
        },
      },
    },
    async (request, reply) => {
      const ctx = await resolveViewerForNote(request, reply);
      if (!ctx) return;
      const kind = request.body?.kind;
      if (!isReactionKind(kind)) {
        return reply.code(400).send({ error: "bad_reaction", message: "Unknown reaction." });
      }
      await setReaction(ctx.ownerId, ctx.conversationId, ctx.amberId, kind);
      return await listReactions(ctx.ownerId, ctx.conversationId, ctx.amberId);
    },
  );

  app.delete(
    "/v1/notes/:ownerId/:id/reactions",
    { preHandler: [requireAuth], config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const ctx = await resolveViewerForNote(request, reply);
      if (!ctx) return;
      await clearReaction(ctx.ownerId, ctx.conversationId, ctx.amberId);
      return await listReactions(ctx.ownerId, ctx.conversationId, ctx.amberId);
    },
  );

  // ── Viewer: comments ────────────────────────────────────────────────────────

  app.get(
    "/v1/notes/:ownerId/:id/comments",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const ctx = await resolveViewerForNote(request, reply);
      if (!ctx) return;
      const comments = await listComments(ctx.ownerId, ctx.conversationId);
      return { comments };
    },
  );

  app.post(
    "/v1/notes/:ownerId/:id/comments",
    {
      preHandler: [requireAuth],
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        body: {
          type: "object",
          required: ["body"],
          properties: { body: { type: "string", minLength: 1, maxLength: 1000 } },
        },
      },
    },
    async (request, reply) => {
      const ctx = await resolveViewerForNote(request, reply);
      if (!ctx) return;
      const created = await addComment(
        ctx.ownerId,
        ctx.conversationId,
        ctx.amberId,
        request.body?.body,
      );
      if (!created) {
        return reply.code(400).send({ error: "empty_comment", message: "Write something first." });
      }
      const comments = await listComments(ctx.ownerId, ctx.conversationId);
      return { ok: true, id: created.id, comments };
    },
  );

  app.delete(
    "/v1/notes/:ownerId/:id/comments/:commentId",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const ctx = await resolveViewerForNote(request, reply);
      if (!ctx) return;
      const commentId = String(request.params?.commentId || "").trim();
      if (!/^\d+$/.test(commentId)) {
        return reply.code(400).send({ error: "bad_comment_id", message: "Malformed comment id." });
      }
      // Author or note owner only — enforced inside the UPDATE's WHERE clause.
      const removed = await deleteComment(
        ctx.ownerId,
        ctx.conversationId,
        commentId,
        ctx.amberId,
      );
      if (!removed) {
        return reply
          .code(404)
          .send({ error: "comment_not_found", message: "That comment is already gone." });
      }
      const comments = await listComments(ctx.ownerId, ctx.conversationId);
      return { ok: true, comments };
    },
  );
}
