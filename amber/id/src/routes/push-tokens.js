/**
 * POST /v1/me/push-token  — Privy auth. iOS app (and later Android) call
 * this from the onboarding "notifications" step after the user grants
 * permission. Idempotent on (did, token) so a re-registration just bumps
 * updatedAt.
 *
 * Body: { token: string, platform: "ios" | "android" }
 * 200:  { ok: true }
 * 400:  validation error
 * 401:  missing/invalid auth
 */

import { requireAuth } from "../lib/auth-session.js";
import { upsertPushToken } from "../db/push-tokens.js";
import { notifyPendingCircleInvites } from "../lib/circle-invite-notify.js";

function requirePrivyDid(request, reply) {
  const privyDid = request.privyUser?.userId;
  if (!privyDid) {
    reply.code(401).send({ error: "no_user", message: "Auth required" });
    return null;
  }
  return privyDid;
}

export function registerPushTokenRoutes(app) {
  app.post(
    "/v1/me/push-token",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const privyDid = requirePrivyDid(request, reply);
      if (!privyDid) return;

      const body = request.body || {};
      const token = typeof body.token === "string" ? body.token.trim() : "";
      const platform = typeof body.platform === "string" ? body.platform : "";

      if (!token) {
        return reply
          .code(400)
          .send({ error: "missing_token", message: "token is required" });
      }
      if (platform !== "ios" && platform !== "android") {
        return reply.code(400).send({
          error: "invalid_platform",
          message: 'platform must be "ios" or "android"',
        });
      }

      try {
        // upsertPushToken can return { ok: false, reason } WITHOUT throwing -- an
        // unresolved Privy DID stores nothing. Returning ok:true regardless meant a
        // device looked fully registered on both sides while its token was never
        // written, and the only symptom was "no registered devices" in the notify
        // logs forever. Report what actually happened.
        const res = await upsertPushToken(privyDid, { token, platform });
        if (res && res.ok === false) {
          request.log.warn({ reason: res.reason }, "[push-token] not stored");
          return reply
            .code(409)
            .send({ ok: false, error: res.reason || "not_stored", message: "Could not register this device." });
        }
        // WHAT WAS WAITING FOR THEM. Somebody who was put in a circle before they
        // had Amber is already resolved to it by the time they get here (signup
        // links every contact card carrying their verified number), and until now
        // nobody told them. This is the first moment there is a device to tell.
        //
        // Detached: registering a device must not wait on a push, and it must not
        // fail because one bounced. Idempotent by circle_invites.notified_at, so
        // a re-registration on the next launch does not tell them twice.
        if (res?.ownerId) {
          void notifyPendingCircleInvites(app, res.ownerId, {
            log: request.log,
          }).catch(() => {});
        }
        return { ok: true };
      } catch (err) {
        request.log.error(
          { err: { message: err?.message, code: err?.code } },
          "[push-token] upsert failed",
        );
        return reply
          .code(500)
          .send({
            error: "internal",
            message: "Could not register push token",
          });
      }
    },
  );
}
