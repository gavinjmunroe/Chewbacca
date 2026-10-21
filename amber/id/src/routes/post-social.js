/**
 * ANSWERING A POST IN THE NETWORK FEED.
 *
 *   PUT    /v1/me/connect/feed/:postId/reaction   { kind | null } → { reactions }
 *   GET    /v1/me/connect/feed/:postId/reactions              → { reactors }
 *   GET    /v1/me/connect/feed/:postId/comments               → { comments }
 *   POST   /v1/me/connect/feed/:postId/comments   { text }    → { comment }
 *   DELETE /v1/me/connect/feed/comments/:id                   → { deleted }
 *   POST   /v1/me/connect/feed/comments/audio/upload-url      → { mediaId, uploadUrl }
 *   POST   /v1/me/connect/feed/comments/audio                 → { transcript }
 *   GET    /v1/me/connect/feed/comments/:id/audio             → { playbackUrl, peaks }
 *
 * The feed has been readable and inert. A feed you cannot answer is a
 * broadcast, and the point of this one is that it is people you actually know.
 *
 * PUT rather than POST for a reaction, because it is idempotent: there is one
 * reaction per person per post and setting it twice is the same as setting it
 * once. `kind: null` clears it, which is the same operation with a different
 * value rather than a second endpoint.
 *
 * EVERY WRITE RE-CHECKS VISIBILITY in the store, against the connection graph,
 * rather than trusting that the post came out of a feed query. A post id is a
 * small integer and anybody can type the next one.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import {
  deleteGcsObject,
  gcsConfigured,
  signGcsUrl,
  statGcsObject,
} from "../lib/gcs-signing.js";
import { transcribeWithOpenAI } from "./voice.js";
import { resolveAmberIdByPhone as defaultResolveAmberIdByPhone } from "../db/store.js";
import {
  COMMENT_MAX,
  addPostComment,
  commentAudioForPlayback,
  discardCommentAudio,
  markCommentAudioReady,
  readPendingCommentAudio,
  reserveCommentAudio,
  deletePostComment,
  isReactionKind,
  listPostComments,
  REACTION_NOT_ACCEPTED,
  listPostReactors,
  reactToPost,
} from "../db/post-social.js";

export function registerPostSocialRoutes(app, deps = {}) {
  const requireAuth = deps.requireAuth || defaultRequireAuth;
  const resolveAmberIdByPhone = deps.resolveAmberIdByPhone || defaultResolveAmberIdByPhone;
  const react = deps.reactToPost || reactToPost;
  const listComments = deps.listPostComments || listPostComments;
  const addComment = deps.addPostComment || addPostComment;
  const removeComment = deps.deletePostComment || deletePostComment;
  const reactors = deps.listPostReactors || listPostReactors;
  const reserveAudio = deps.reserveCommentAudio || reserveCommentAudio;
  const readPendingAudio = deps.readPendingCommentAudio || readPendingCommentAudio;
  const markAudioReady = deps.markCommentAudioReady || markCommentAudioReady;
  const discardAudio = deps.discardCommentAudio || discardCommentAudio;
  const playbackFor = deps.commentAudioForPlayback || commentAudioForPlayback;
  const transcribe = deps.transcribeWithOpenAI || transcribeWithOpenAI;
  const sign = deps.signGcsUrl || signGcsUrl;
  const stat = deps.statGcsObject || statGcsObject;
  const removeObject = deps.deleteGcsObject || deleteGcsObject;
  const storageReady = deps.gcsConfigured || gcsConfigured;

  async function resolveOwner(request, reply) {
    if (!request.privyUser?.userId) {
      reply.code(401).send({ error: "no_user", message: "Auth required" });
      return null;
    }
    const phone = request.privyUser?.phone;
    if (!phone) {
      reply.code(400).send({ error: "no_phone_on_session", message: "Session carries no phone." });
      return null;
    }
    const amberId = await resolveAmberIdByPhone(phone).catch(() => null);
    if (!amberId) {
      reply
        .code(400)
        .send({ error: "could_not_resolve_owner", message: "Could not resolve owner." });
      return null;
    }
    return amberId;
  }

  app.put(
    "/v1/me/connect/feed/:postId/reaction",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const me = await resolveOwner(request, reply);
      if (!me) return;
      const kind = request.body?.kind ?? null;
      if (kind !== null && !isReactionKind(kind)) {
        return reply
          .code(400)
          .send({ error: "bad_kind", message: "Not a reaction Amber knows." });
      }
      const reactions = await react(me, request.params?.postId, kind);
      if (reactions === REACTION_NOT_ACCEPTED) {
        /**
         * NOT A 404. The post is fine and the person is allowed; the SERVER is
         * behind its own client. 503 says "try later" and the message names the
         * cause, so this reaches somebody as a deploy step rather than as
         * "reactions are broken".
         */
        return reply.code(503).send({
          error: "reaction_kind_unavailable",
          message: "That reaction is not available yet. The server is still catching up.",
        });
      }
      /**
       * NULL FROM THE STORE IS "you cannot see that post", and it answers 404
       * rather than 403 on purpose: telling somebody a post exists but is not
       * theirs to react to is telling them it exists.
       */
      if (!reactions) {
        return reply.code(404).send({ error: "not_found", message: "No such post." });
      }
      return { reactions };
    },
  );

  /**
   * WHO REACTED, for the long press on the reaction row.
   *
   * A read of its own rather than a field on the feed: every card needs the
   * counts, one card at a time needs the names, and shipping every reactor with
   * every page would make a busy feed pay for a gesture nobody performs on most
   * posts.
   */
  app.get(
    "/v1/me/connect/feed/:postId/reactions",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const me = await resolveOwner(request, reply);
      if (!me) return;
      const rows = await reactors(me, request.params?.postId);
      if (rows === null) {
        return reply.code(404).send({ error: "not_found", message: "No such post." });
      }
      return { reactors: rows };
    },
  );

  app.get(
    "/v1/me/connect/feed/:postId/comments",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const me = await resolveOwner(request, reply);
      if (!me) return;
      const comments = await listComments(me, request.params?.postId);
      if (comments === null) {
        return reply.code(404).send({ error: "not_found", message: "No such post." });
      }
      return { comments };
    },
  );

  app.post(
    "/v1/me/connect/feed/:postId/comments",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const me = await resolveOwner(request, reply);
      if (!me) return;
      const text = request.body?.text;
      const mediaId = request.body?.mediaId ?? null;
      const words = typeof text === "string" ? text.trim() : "";
      // A voice comment may carry no words at all -- see addPostComment. What is
      // never a comment is neither words nor a clip.
      if (words.length === 0 && !mediaId) {
        return reply.code(400).send({ error: "empty", message: "A comment needs something in it." });
      }
      if (words.length > COMMENT_MAX) {
        return reply
          .code(400)
          .send({ error: "too_long", message: `Keep it under ${COMMENT_MAX} characters.` });
      }
      const comment = await addComment(me, request.params?.postId, words, { mediaId });
      if (!comment) {
        return reply.code(404).send({ error: "not_found", message: "No such post." });
      }
      return { comment };
    },
  );

  // ── VOICE COMMENTS ────────────────────────────────────────────────────────
  //
  // "There should be a little voice thing next to it, like a waveform, where I
  //  can leave a voice comment, which should be transcribed and shown with the
  //  voice."
  //
  // Three steps, the same three the note-audio flow has used since migration
  // 017, and for the same reasons:
  //
  //   1. reserve   the server names the object and hands back a signed PUT. A
  //                client that supplies its own key can point the server at
  //                somebody else's audio, so it never gets to.
  //   2. finalize  the server asks the BUCKET what actually landed -- a client
  //                that lies about a 200MB file, or PUTs HTML with an audio
  //                content type, is caught here and the object is removed --
  //                then transcribes it.
  //   3. post      the comment is written with the transcript as its text and
  //                the clip attached, so it is searchable, readable in a
  //                notification, and counted exactly like a typed one.

  const AUDIO_TYPE = "audio/m4a";
  const UPLOAD_TTL = 120;
  const PLAY_TTL = 300;
  const MAX_CLIP_BYTES = 12 * 1024 * 1024;
  const MAX_CLIP_MS = 3 * 60 * 1000;

  app.post(
    "/v1/me/connect/feed/comments/audio/upload-url",
    { preHandler: [requireAuth], config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const me = await resolveOwner(request, reply);
      if (!me) return;
      if (!storageReady()) {
        return reply.code(503).send({
          error: "audio_storage_unconfigured",
          message: "Voice comments are not configured on this server.",
        });
      }
      const reserved = await reserveAudio(me);
      if (!reserved) {
        return reply
          .code(503)
          .send({ error: "reserve_failed", message: "Could not start that recording." });
      }
      return {
        mediaId: reserved.mediaId,
        uploadUrl: sign({
          objectName: reserved.storageKey,
          method: "PUT",
          expiresSeconds: UPLOAD_TTL,
          contentType: AUDIO_TYPE,
        }),
        contentType: AUDIO_TYPE,
        expiresIn: UPLOAD_TTL,
        maxBytes: MAX_CLIP_BYTES,
        maxDurationMs: MAX_CLIP_MS,
      };
    },
  );

  /**
   * THE PATH MATCHES THE SHAPE lib/noteMedia.ts's uploadAudioTo already expects
   * -- a ticket at `${base}/upload-url` and a finalize at `${base}` -- so the
   * client reuses the three-leg helper that has been doing this since note audio
   * shipped instead of carrying a second copy of "PUT the bytes and call it
   * done". The mediaId therefore travels in the body rather than the path.
   */
  app.post(
    "/v1/me/connect/feed/comments/audio",
    { preHandler: [requireAuth], config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const me = await resolveOwner(request, reply);
      if (!me) return;
      const mediaId = request.body?.mediaId;
      const row = mediaId ? await readPendingAudio(me, mediaId) : null;
      if (!row) {
        return reply
          .code(409)
          .send({ error: "no_pending_upload", message: "Ask for an upload URL first." });
      }

      // NEVER TRUST THE CLIENT FOR THE SIZE. Ask the bucket.
      let info;
      try {
        info = await stat(row.storage_key);
      } catch {
        return reply
          .code(502)
          .send({ error: "storage_unreachable", message: "Could not verify the upload." });
      }
      if (!info.exists) {
        await discardAudio(me, mediaId);
        return reply
          .code(409)
          .send({ error: "upload_missing", message: "That recording never finished uploading." });
      }
      if (info.size > MAX_CLIP_BYTES) {
        await removeObject(row.storage_key);
        await discardAudio(me, mediaId);
        return reply.code(413).send({ error: "clip_too_large", message: "That recording is too long." });
      }

      const body = request.body || {};
      await markAudioReady(me, mediaId, {
        durationMs: Math.min(Number(body.durationMs) || 0, MAX_CLIP_MS),
        byteSize: info.size,
        peaks: Array.isArray(body.peaks) ? body.peaks : [],
      });

      /**
       * TRANSCRIBED HERE, NOT ON THE PHONE, and best-effort.
       *
       * On the server because the transcript is what makes a voice comment
       * searchable and readable by everybody else -- a phone-side transcript
       * would be whatever that phone's OS produced, and would be missing
       * entirely for anybody whose OS declined.
       *
       * BEST-EFFORT because a failed transcription must not lose the recording.
       * "" is a real answer: the clip still posts, the waveform still plays, and
       * the comment simply has no words under it -- which is also what a
       * two-second laugh produces.
       */
      let transcript = "";
      try {
        const url = sign({
          objectName: row.storage_key,
          method: "GET",
          expiresSeconds: PLAY_TTL,
        });
        const res = await fetch(url);
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          const out = await transcribe({
            audioBase64: buf.toString("base64"),
            mimeType: AUDIO_TYPE,
          });
          transcript = typeof out === "string" ? out.trim() : (out?.text ?? "").trim();
        }
      } catch (e) {
        request.log?.warn?.({ err: String(e?.message || e) }, "[voice-comment] transcription failed");
      }

      return { mediaId, byteSize: info.size, transcript: transcript.slice(0, COMMENT_MAX) };
    },
  );

  /**
   * A short-lived URL to play one comment's clip.
   *
   * GATED ON SEEING THE POST, not on owning the clip: a voice comment is FOR the
   * thread, and the person listening is almost never the person who recorded
   * it. Minted per play rather than carried in the comment list, because the URL
   * is the capability and a list can sit in a cache for an hour.
   */
  app.get(
    "/v1/me/connect/feed/comments/:commentId/audio",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const me = await resolveOwner(request, reply);
      if (!me) return;
      const clip = await playbackFor(me, request.params?.commentId);
      if (!clip) {
        return reply.code(404).send({ error: "not_found", message: "No such recording." });
      }
      return {
        playbackUrl: sign({
          objectName: clip.storageKey,
          method: "GET",
          expiresSeconds: PLAY_TTL,
        }),
        expiresIn: PLAY_TTL,
        durationMs: clip.durationMs,
        peaks: clip.peaks,
        contentType: clip.contentType,
      };
    },
  );

  app.delete(
    "/v1/me/connect/feed/comments/:commentId",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const me = await resolveOwner(request, reply);
      if (!me) return;
      const deleted = await removeComment(me, request.params?.commentId);
      if (!deleted) {
        // Yours to delete or it does not exist, and from here those are the
        // same answer.
        return reply.code(404).send({ error: "not_found", message: "No such comment." });
      }
      return { deleted: true };
    },
  );
}
