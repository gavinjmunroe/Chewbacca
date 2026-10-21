/**
 * Google OAuth routes.
 *
 *   GET    /v1/oauth/google/init      authorize URL (JWT-gated)
 *   GET    /v1/oauth/google/callback  Google redirect target (public)
 *   DELETE /v1/oauth/google           revoke + clear secrets (JWT-gated)
 *
 * Tab 1.1 owns the pending-oauth state store (src/oauth/state.js); this
 * file imports from there for state mint + redeem. The mount line in
 * src/index.js is added by Caleb in a single batch after all Wave 1
 * Phase 1 routes ship, per PHASE_1_AUTH.md.
 */

import { requireAuth } from "../lib/auth-session.js";
import { consumePending } from "../oauth/state.js";
import { configCheck } from "../oauth/lib/env-check.js";
import { buildAuthorizeUrl } from "../oauth/google/init.js";
import {
  exchangeCode,
  storeTokens,
  revokeAndClear,
} from "../oauth/google/callback.js";
import { scrapeAndIndexGoogleContacts } from "../oauth/google/scrape-contacts.js";
import { getSecret } from "../db/secrets.js";
import { isAppReturnTo, appReturnUrl } from "../lib/oauth-redirect.js";
import { webBaseUrl } from "../oauth/lib/public-url.js";

function frontendBase() {
  return webBaseUrl();
}

function safeReturnTo(p) {
  if (!p || typeof p !== "string") return "/connect";
  // iOS app deep link: let the app's own scheme through so the callback can
  // return the user to the app instead of the web /connect page.
  if (isAppReturnTo(p)) return p;
  // Open-redirect guard: only allow same-origin paths starting with a single
  // slash, never a scheme or protocol-relative URL.
  if (!p.startsWith("/") || p.startsWith("//")) return "/connect";
  return p;
}

function callbackRedirect({ returnTo, status, reason }) {
  // App-initiated flow: deep-link back into the iOS app so the in-app auth
  // session closes and the app shows the connection state.
  if (isAppReturnTo(returnTo)) {
    return appReturnUrl(returnTo, { platform: "google", status, reason });
  }
  const base = frontendBase();
  const params = new URLSearchParams({ google: status });
  if (reason) params.set("reason", reason);
  /*
   * MERGE THE QUERY, DO NOT STAPLE A SECOND ONE ON.
   *
   * This appended "?google=connected" unconditionally, so a return path that
   * already carried one -- "/org?tab=knowledge" -- came back as
   * "/org?tab=knowledge?google=connected". The browser reads that as a single
   * parameter named tab whose value is "knowledge?google=connected", which
   * matches no tab, so the app fell back to its default and somebody who
   * connected their mailbox from the Knowledge screen was returned to
   * Circles, with nothing on screen to say the connection had worked.
   */
  const path = safeReturnTo(returnTo);
  const join = path.includes("?") ? "&" : "?";
  return `${base}${path}${join}${params.toString()}`;
}

function userDid(request) {
  return request.privyUser?.userId || null;
}

export function registerGoogleOauthRoutes(app) {
  app.get(
    "/v1/oauth/google/init",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const did = userDid(request);
      if (!did) {
        return reply
          .code(401)
          .send({ error: "missing_did", code: "missing_did" });
      }

      const check = configCheck("google");
      if (!check.configured) {
        return reply.code(503).send({
          error: "platform_not_configured",
          platform: "google",
          missing_config: check.missing_config,
        });
      }

      const returnTo = safeReturnTo(request.query?.return_to);
      try {
        const { url } = await buildAuthorizeUrl(did, {
          returnTo,
          purpose:
            request.query?.purpose === "calendar"
              ? "calendar"
              : request.query?.purpose === "relationships"
                ? "relationships"
                : undefined,
        });
        return { authorize_url: url };
      } catch (err) {
        request.log.error({ err: err.message }, "google_oauth_init_failed");
        return reply.code(500).send({
          error: "init_failed",
          code: err.message,
        });
      }
    },
  );

  app.get("/v1/oauth/google/callback", async (request, reply) => {
    const q = request.query || {};
    const state = typeof q.state === "string" ? q.state : null;

    // Always resolve returnTo before any failure path so the user lands
    // somewhere sensible on the frontend even if state is unrecoverable.
    let pending = null;
    if (state) {
      try {
        pending = await consumePending(state);
      } catch (err) {
        request.log.error(
          { err: err.message },
          "google_oauth_state_consume_failed",
        );
      }
    }
    const returnTo = pending?.returnTo || "/connect";

    if (q.error) {
      return reply.redirect(
        callbackRedirect({
          returnTo,
          status: "failed",
          reason: String(q.error),
        }),
      );
    }
    if (!state || !pending) {
      return reply.redirect(
        callbackRedirect({
          returnTo,
          status: "failed",
          reason: "invalid_state",
        }),
      );
    }
    if (pending.platform !== "google") {
      return reply.redirect(
        callbackRedirect({
          returnTo,
          status: "failed",
          reason: "platform_mismatch",
        }),
      );
    }
    const code = typeof q.code === "string" ? q.code : null;
    if (!code) {
      return reply.redirect(
        callbackRedirect({
          returnTo,
          status: "failed",
          reason: "missing_code",
        }),
      );
    }

    try {
      const tokens = await exchangeCode(code);
      await storeTokens(pending.did, tokens, {
        updatedBy: "oauth-google-callback",
      });
      // Fire-and-forget People API pull so the user's Google contacts
      // start flowing into the unified people graph the moment they
      // finish the consent dance. The scraper skips itself when the
      // contacts.readonly scope isn't in the grant, so users who only
      // approved Calendar / Gmail / Drive are unaffected.
      scrapeAndIndexGoogleContacts(pending.did, request.log).catch((err) => {
        request.log.error(
          { did: pending.did, msg: err?.message || String(err) },
          "[oauth:google] on-connect contacts scrape threw",
        );
      });
      return reply.redirect(
        callbackRedirect({ returnTo, status: "connected" }),
      );
    } catch (err) {
      request.log.error(
        { err: err.message, did: pending.did },
        "google_oauth_callback_failed",
      );
      const reason = err.message.startsWith("token_exchange_failed:")
        ? err.message.split(":").slice(1).join(":")
        : "exchange_failed";
      return reply.redirect(
        callbackRedirect({ returnTo, status: "failed", reason }),
      );
    }
  });

  // POST /v1/oauth/google/sync-contacts
  //
  // Trigger a People API contact pull for the authenticated user. Returns
  // 200 immediately and kicks off the scrape in the background; the
  // response carries no row counts because the work is async. Subsequent
  // calls re-pull from scratch and idempotently overwrite the same
  // Firestore + Pinecone rows via the externalId = `google:<resourceName>`
  // pattern, so the user can hit this endpoint freely to refresh.
  //
  // 200: { ok: true, queued: true }
  // 401: missing_did
  // 503: platform_not_configured
  app.post(
    "/v1/oauth/google/sync-contacts",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const did = userDid(request);
      if (!did) {
        return reply
          .code(401)
          .send({ error: "missing_did", code: "missing_did" });
      }

      const check = configCheck("google");
      if (!check.configured) {
        return reply.code(503).send({
          error: "platform_not_configured",
          platform: "google",
          missing_config: check.missing_config,
        });
      }

      scrapeAndIndexGoogleContacts(did, request.log).catch((err) => {
        request.log.error(
          { did, msg: err?.message || String(err) },
          "[oauth:google/sync-contacts] background scrape threw",
        );
      });

      return { ok: true, queued: true };
    },
  );

  app.delete(
    "/v1/oauth/google",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const did = userDid(request);
      if (!did) {
        return reply
          .code(401)
          .send({ error: "missing_did", code: "missing_did" });
      }
      try {
        const refreshToken = await getSecret(did, "GCAL_OAUTH_REFRESH");
        await revokeAndClear(did, { refreshToken });
        return { ok: true };
      } catch (err) {
        request.log.error(
          { err: err.message, did },
          "google_oauth_revoke_failed",
        );
        return reply.code(500).send({
          error: "revoke_failed",
          code: err.message,
        });
      }
    },
  );
}
