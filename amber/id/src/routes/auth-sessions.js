/**
 * auth-sessions — refresh, sign-out, and the signed-in-devices surface.
 *
 *   POST   /v1/auth/refresh          { refreshToken }  → { token, refreshToken, expiresIn }
 *   POST   /v1/auth/invalidate       (Bearer)          → { ok: true }        sign out this device
 *   POST   /v1/auth/sessions/revoke-all (Bearer)       → { ok: true, revoked }
 *   GET    /v1/auth/sessions         (Bearer)          → { sessions: [...] }
 *   DELETE /v1/auth/sessions/:id     (Bearer)          → { ok: true }
 *
 * The client previously called /v1/auth/refresh and /v1/auth/invalidate and got
 * 404s for both (lib/auth.ts documents them as "parallel work in medha-id").
 * This is that work: the client contract is unchanged, the endpoints now exist.
 *
 * WHY /v1/auth/refresh IS UNAUTHENTICATED (by preHandler)
 * It has to be — the whole point is that the access token has expired. The
 * refresh token in the body IS the credential: 256 bits of CSPRNG entropy,
 * stored only as a sha256 hash, single-use, and rotated on every exchange with
 * replay detection. That is the standard construction. It is rate-limited
 * separately below because it is an unauthenticated endpoint that mints
 * credentials.
 */

import { reviewSessionAllowed } from "../lib/review-account.js";
import { requireAuth } from "../lib/auth-session.js";
import {
  createSession,
  rotateSession,
  revokeSession,
  revokeAllForSubject,
  listSessionsForSubject,
  getSession,
} from "../db/session-store.js";
import { denySession, denyMany } from "../lib/session-denylist.js";
import { signMedhaAccessToken, ACCESS_TTL_SECONDS } from "../lib/medha-jwt.js";

/** Best-effort client IP. Set trustProxy so request.ip is already correct. */
function clientIp(request) {
  return request.ip || null;
}

/**
 * Device metadata the client may send. Advisory only — it labels rows on the
 * "signed-in devices" screen and is NEVER consulted for authorization.
 */
function deviceFrom(body = {}, request) {
  const clamp = (v, n) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null;
  return {
    deviceId: clamp(body.deviceId, 128),
    deviceName: clamp(body.deviceName, 128),
    deviceOs: clamp(body.deviceOs, 64),
    appVersion:
      clamp(body.appVersion, 32) ||
      clamp(request.headers["x-app-version"], 32),
  };
}

/**
 * Shared by every sign-in path (medha-dashboard verify, verify-code-only,
 * mobile-auth otp/verify) so all three mint the same token pair. Exported
 * rather than duplicated: three slightly-different auth implementations is how
 * a hole like the unauthenticated issue-code survives.
 */
export async function issueSessionPair({ personId, phone, request, body = {} }) {
  const { session, refreshToken } = await createSession({
    subjectId: personId,
    phone,
    device: deviceFrom(body, request),
    ip: clientIp(request),
  });
  const access = signMedhaAccessToken({ personId, phone, sid: session.id });
  return {
    token: access.token,
    refreshToken,
    expiresIn: access.expiresIn,
    expiresAt: access.expiresAt,
    sessionId: session.id,
  };
}

export function registerAuthSessionRoutes(app) {
  // ── POST /v1/auth/refresh ─────────────────────────────────────────────────
  app.post(
    "/v1/auth/refresh",
    {
      config: {
        // Tighter than the global limit: unauthenticated and credential-minting.
        // Generous enough that a cold start refreshing several tabs/screens at
        // once is never throttled.
        rateLimit: { max: 30, timeWindow: "1 minute" },
      },
      schema: {
        body: {
          type: "object",
          required: ["refreshToken"],
          properties: {
            refreshToken: { type: "string", minLength: 20, maxLength: 512 },
            deviceId: { type: "string", maxLength: 128 },
            deviceName: { type: "string", maxLength: 128 },
            deviceOs: { type: "string", maxLength: 64 },
            appVersion: { type: "string", maxLength: 32 },
          },
        },
      },
    },
    async (request, reply) => {
      const result = await rotateSession(request.body.refreshToken, {
        ip: clientIp(request),
      });

      if (!result.ok) {
        if (result.reason === "reuse_detected") {
          // The family is already revoked inside rotateSession. Log loudly:
          // this is either a stolen token or a client bug, and both are worth
          // seeing in production.
          request.log.warn(
            { familyId: result.familyId },
            "[auth.refresh] refresh-token reuse detected; family revoked",
          );
        }
        return reply.code(401).send({
          error: "invalid_refresh_token",
          reason: result.reason,
          message: "Your session has ended. Please sign in again.",
        });
      }

      const { session, refreshToken } = result;
      if (!reviewSessionAllowed(session.phone)) {
        await revokeSession(session.id, "review_expired");
        return reply.code(401).send({ error: "invalid_refresh_token" });
      }
      const access = signMedhaAccessToken({
        personId: session.subjectId,
        phone: session.phone,
        sid: session.id,
      });
      return reply.send({
        token: access.token,
        refreshToken,
        expiresIn: access.expiresIn,
        expiresAt: access.expiresAt,
        phone: session.phone,
        person_id: session.subjectId,
      });
    },
  );

  // ── POST /v1/auth/invalidate ──────────────────────────────────────────────
  // Sign out THIS device. The client calls this on sign-out and treats any
  // outcome as success, so this must never be the thing that blocks logout.
  app.post(
    "/v1/auth/invalidate",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const sid = request.privyUser?.sid ?? null;
      if (sid) {
        await revokeSession(sid, "signed_out").catch(() => 0);
        // Immediate effect on this replica; elsewhere the access token expires
        // within ACCESS_TTL_SECONDS and cannot be renewed (refresh row is dead).
        denySession(sid, ACCESS_TTL_SECONDS + 60);
      }
      return reply.send({ ok: true, revoked: sid ? 1 : 0 });
    },
  );

  // ── POST /v1/auth/sessions/revoke-all ─────────────────────────────────────
  // "Log out of all devices". Also the right call after a password/2FA change
  // once those exist.
  app.post(
    "/v1/auth/sessions/revoke-all",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const subjectId = request.privyUser?.userId;
      if (!subjectId) return reply.code(401).send({ error: "no_subject" });
      const live = await listSessionsForSubject(subjectId).catch(() => []);
      const revoked = await revokeAllForSubject(subjectId, "revoke_all").catch(
        () => 0,
      );
      denyMany(
        live.map((s) => s.id),
        ACCESS_TTL_SECONDS + 60,
      );
      return reply.send({ ok: true, revoked });
    },
  );

  // ── GET /v1/auth/sessions ─────────────────────────────────────────────────
  app.get(
    "/v1/auth/sessions",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const subjectId = request.privyUser?.userId;
      if (!subjectId) return reply.code(401).send({ error: "no_subject" });
      const currentSid = request.privyUser?.sid ?? null;
      const sessions = await listSessionsForSubject(subjectId).catch(() => []);
      return reply.send({
        sessions: sessions.map((s) => ({
          id: s.id,
          deviceName: s.deviceName,
          deviceOs: s.deviceOs,
          appVersion: s.appVersion,
          createdAt: s.createdAt,
          lastUsedAt: s.lastUsedAt,
          current: currentSid != null && s.id === currentSid,
        })),
      });
    },
  );

  // ── DELETE /v1/auth/sessions/:id ──────────────────────────────────────────
  app.delete(
    "/v1/auth/sessions/:id",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const subjectId = request.privyUser?.userId;
      if (!subjectId) return reply.code(401).send({ error: "no_subject" });

      // Ownership check: never let one account revoke another's session.
      const target = await getSession(request.params.id).catch(() => null);
      if (!target || String(target.subjectId) !== String(subjectId)) {
        return reply.code(404).send({ error: "session_not_found" });
      }
      await revokeSession(target.id, "revoked_by_user").catch(() => 0);
      denySession(target.id, ACCESS_TTL_SECONDS + 60);
      return reply.send({ ok: true });
    },
  );
}
