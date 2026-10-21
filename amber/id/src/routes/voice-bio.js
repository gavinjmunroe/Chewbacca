/**
 * THE PROFILE VOICE BIO — the clip on your profile, in your own voice.
 *
 *   POST   /v1/me/voice-bio/upload-url    owner mints a signed PUT
 *   POST   /v1/me/voice-bio               owner finalizes (server verifies the object)
 *   GET    /v1/me/voice-bio               owner reads their own, with a playback URL
 *   DELETE /v1/me/voice-bio               owner removes it
 *   GET    /v1/profiles/:amberId/voice-bio  a CONNECTION gets a playback URL
 *
 * Written text on a profile is a bio. A voice clip is the person, and this app
 * is built on the premise that people say more than they type -- so the profile
 * carries one.
 *
 * THE AUDIENCE IS YOUR CONNECTIONS, resolved live from `connections` on every
 * request (db/voice-bio-store.js canHearBio). Not a share row: there is nothing
 * to create when you connect and nothing to forget to revoke when you
 * disconnect, so removing a connection silences the clip on the next request
 * rather than whenever someone remembers to clean up.
 *
 * A caller who is not connected gets 404, not 403 -- the same convention
 * note-media uses -- so the endpoint cannot be used to ask whether a given
 * person has recorded one.
 *
 * The signed URL is the capability, so it is short-lived. Its lifetime is the
 * window in which a leaked link works.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import { resolveAmberIdByPhone } from "../db/store.js";
import {
  BIO_CONTENT_TYPE,
  MAX_BIO_BYTES,
  MAX_BIO_DURATION_MS,
  canHearBio,
  deleteBio,
  getBioRow,
  markBioReady,
  reserveBioUpload,
} from "../db/voice-bio-store.js";
import {
  deleteGcsObject,
  gcsConfigured,
  signGcsUrl,
  statGcsObject,
} from "../lib/gcs-signing.js";

const PLAYBACK_TTL_SECONDS = 300;
const UPLOAD_TTL_SECONDS = 600;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerVoiceBioRoutes(app, deps = {}) {
  const requireAuth = deps.requireAuth || defaultRequireAuth;
  const resolveAmber = deps.resolveAmberIdByPhone || resolveAmberIdByPhone;
  const reserve = deps.reserveBioUpload || reserveBioUpload;
  const getRow = deps.getBioRow || getBioRow;
  const markReady = deps.markBioReady || markBioReady;
  const remove = deps.deleteBio || deleteBio;
  const canHear = deps.canHearBio || canHearBio;
  const configured = deps.gcsConfigured || gcsConfigured;
  const sign = deps.signGcsUrl || signGcsUrl;
  const stat = deps.statGcsObject || statGcsObject;
  const deleteObject = deps.deleteGcsObject || deleteGcsObject;

  async function resolveViewer(request, reply) {
    if (!request.privyUser?.userId) {
      reply.code(401).send({ error: "no_user", message: "Auth required" });
      return null;
    }
    const phone = request.privyUser?.phone;
    const amberId = phone ? await resolveAmber(phone).catch(() => null) : null;
    if (!amberId) {
      reply.code(401).send({ error: "no_amber_id", message: "Account not found" });
      return null;
    }
    return amberId;
  }

  function unconfigured(reply) {
    return reply.code(503).send({
      error: "audio_storage_unconfigured",
      message: "Voice storage is not configured on this server.",
    });
  }

  // What a client gets for a readable clip. `peaks` travels with it so the
  // waveform is the owner's, identical on every listener's screen, rather than
  // each device drawing its own from a stream it has not finished downloading.
  function playable(row, url) {
    return {
      url,
      expiresIn: PLAYBACK_TTL_SECONDS,
      durationMs: row.duration_ms ?? 0,
      peaks: Array.isArray(row.peaks) ? row.peaks : [],
      // WHAT IT SAYS, under the mic. Served with the same reach as the audio --
      // this function is only ever called after canHearBio has said yes, so a
      // transcript is never readable by somebody who may not play the clip.
      transcript: row.transcript ?? null,
      updatedAt: row.updated_at ?? row.created_at ?? null,
    };
  }

  // ── Owner: record ──────────────────────────────────────────────────────
  app.post(
    "/v1/me/voice-bio/upload-url",
    { preHandler: [requireAuth], config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const ownerId = await resolveViewer(request, reply);
      if (!ownerId) return;
      if (!configured()) return unconfigured(reply);
      // The key is minted and persisted HERE. Finalize reads it back off the
      // row, so the client never names an object and cannot point the server at
      // someone else's.
      const storageKey = await reserve(ownerId);
      if (!storageKey) {
        return reply
          .code(500)
          .send({ error: "reserve_failed", message: "Could not start that recording." });
      }
      return {
        uploadUrl: sign({
          objectName: storageKey,
          method: "PUT",
          expiresSeconds: UPLOAD_TTL_SECONDS,
          contentType: BIO_CONTENT_TYPE,
        }),
        contentType: BIO_CONTENT_TYPE,
        expiresIn: UPLOAD_TTL_SECONDS,
        maxBytes: MAX_BIO_BYTES,
        maxDurationMs: MAX_BIO_DURATION_MS,
      };
    },
  );

  app.post(
    "/v1/me/voice-bio",
    {
      preHandler: [requireAuth],
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        body: {
          type: "object",
          properties: {
            durationMs: { type: "integer", minimum: 0, maximum: MAX_BIO_DURATION_MS },
            peaks: { type: "array", maxItems: 512, items: { type: "integer" } },
            transcript: { type: "string", maxLength: 4000 },
          },
        },
      },
    },
    async (request, reply) => {
      const ownerId = await resolveViewer(request, reply);
      if (!ownerId) return;
      const row = await getRow(ownerId);
      if (!row) {
        return reply
          .code(409)
          .send({ error: "no_pending_upload", message: "Ask for an upload URL first." });
      }

      // NEVER TRUST THE CLIENT FOR THE SIZE OR THE TYPE. Ask the bucket what is
      // actually there. A client that lies about a 200MB file, or PUTs HTML
      // under an audio content type, is caught here and the object is removed.
      let info;
      try {
        info = await stat(row.storage_key);
      } catch (e) {
        request.log?.error?.({ err: e?.message }, "[voice-bio] stat failed");
        return reply
          .code(502)
          .send({ error: "storage_unreachable", message: "Could not verify the upload." });
      }
      if (!info.exists) {
        return reply
          .code(409)
          .send({ error: "upload_missing", message: "That clip never finished uploading." });
      }
      if (info.size > MAX_BIO_BYTES) {
        await deleteObject(row.storage_key);
        await remove(ownerId);
        return reply
          .code(413)
          .send({ error: "clip_too_large", message: "That clip is too long." });
      }

      const body = request.body || {};
      await markReady(ownerId, {
        durationMs: body.durationMs ?? 0,
        byteSize: info.size,
        peaks: body.peaks ?? [],
        transcript: body.transcript ?? null,
      });
      request.log?.info?.({ ownerId, bytes: info.size }, "[voice-bio] ready");
      return { ok: true, byteSize: info.size };
    },
  );

  app.get("/v1/me/voice-bio", { preHandler: [requireAuth] }, async (request, reply) => {
    const ownerId = await resolveViewer(request, reply);
    if (!ownerId) return;
    const row = await getRow(ownerId);
    // 200 with bio:null, not a 404. "You have not recorded one" is an ordinary
    // state of a profile the caller certainly owns, and a client that had to
    // treat it as an error would be unable to tell it from a real failure.
    if (!row || row.status !== "ready") return { bio: null };
    if (!configured()) return unconfigured(reply);
    const url = sign({
      objectName: row.storage_key,
      method: "GET",
      expiresSeconds: PLAYBACK_TTL_SECONDS,
    });
    return { bio: playable(row, url) };
  });

  app.delete("/v1/me/voice-bio", { preHandler: [requireAuth] }, async (request, reply) => {
    const ownerId = await resolveViewer(request, reply);
    if (!ownerId) return;
    const row = await getRow(ownerId);
    // The object first, then the row. The other order leaves an orphan object
    // in the bucket that nothing points at and nothing will ever clean up.
    if (row?.storage_key) await deleteObject(row.storage_key).catch(() => {});
    await remove(ownerId);
    return { ok: true };
  });

  // ── A connection: listen ───────────────────────────────────────────────
  app.get(
    "/v1/profiles/:amberId/voice-bio",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const viewerId = await resolveViewer(request, reply);
      if (!viewerId) return;
      const ownerId = String(request.params?.amberId || "").trim().toLowerCase();
      // A malformed id gets the SAME answer as an unconnected one, so the
      // shape of the id is not a way to learn anything either.
      const notFound = () =>
        reply.code(404).send({ error: "no_voice_bio", message: "No voice bio here." });
      if (!UUID_RE.test(ownerId)) return notFound();
      // REACH FIRST, ROW SECOND. Reading the row first and then checking reach
      // is the same answer with a timing difference that says whether the row
      // exists.
      if (!(await canHear(viewerId, ownerId))) return notFound();
      const row = await getRow(ownerId);
      if (!row || row.status !== "ready") return notFound();
      if (!configured()) return unconfigured(reply);
      const url = sign({
        objectName: row.storage_key,
        method: "GET",
        expiresSeconds: PLAYBACK_TTL_SECONDS,
      });
      return { bio: playable(row, url) };
    },
  );
}
