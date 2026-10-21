/**
 * Railway OAuth 2.0 routes (PKCE / S256).
 *
 *   GET    /v1/oauth/railway/init       auth'd; returns { authorize_url }
 *   GET    /v1/oauth/railway/callback   public; Railway redirects here
 *   DELETE /v1/oauth/railway            auth'd; clears RAILWAY_OAUTH_* keys
 *
 * Replaces the earlier PAT-paste integration (POST
 * /v1/me/railway/connect) that shipped in #95. Railway DOES have a
 * public OAuth Apps program -- the docs at
 * https://docs.railway.com/integrations/oauth and the OIDC discovery
 * document at https://backboard.railway.com/oauth/.well-known/
 * openid-configuration. This switches to the proper flow.
 */

import { requireAuth } from "../lib/auth-session.js";
import { consumePending } from "../oauth/state.js";
import { configCheck } from "../oauth/lib/env-check.js";
import { buildAuthorizeUrl } from "../oauth/railway/init.js";
import {
  exchangeCode,
  fetchUserinfo,
  storeTokens,
  clearTokens,
} from "../oauth/railway/callback.js";
import { webBaseUrl } from "../oauth/lib/public-url.js";

function frontendBase() {
  return (webBaseUrl() || "").replace(/\/+$/, "");
}

/**
 * Coerce a possibly-relative returnTo into an absolute URL on the
 * MEDHA_FRONTEND_URL host. Same defensive pattern as the GitHub
 * callback fix (#93) -- frontend sends `/connect` as a relative path
 * and `reply.redirect` would otherwise resolve it against medha-id
 * and 404.
 */
function absolutizeReturnTo(returnTo) {
  if (returnTo && /^https?:\/\//i.test(returnTo)) return returnTo;
  const base = frontendBase();
  if (!base) return null;
  const path = returnTo
    ? returnTo.startsWith("/")
      ? returnTo
      : `/${returnTo}`
    : "/connect";
  return `${base}${path}`;
}

function failureRedirect(reply, reason, returnTo) {
  const target = absolutizeReturnTo(returnTo);
  if (!target) {
    return reply.code(400).send({ error: "railway_oauth_failed", reason });
  }
  const sep = target.includes("?") ? "&" : "?";
  return reply.redirect(
    `${target}${sep}railway=failed&reason=${encodeURIComponent(reason)}`,
  );
}

function successRedirect(reply, returnTo) {
  const target = absolutizeReturnTo(returnTo);
  if (!target) {
    return reply.send({ ok: true, railway: "connected" });
  }
  const sep = target.includes("?") ? "&" : "?";
  let final = target;
  if (!/[?&]railway=/.test(final)) {
    final = `${final}${sep}railway=connected`;
  }
  return reply.redirect(final);
}

function userDid(request) {
  return request.privyUser?.userId || null;
}

export function registerRailwayOauthRoutes(app) {
  app.get(
    "/v1/oauth/railway/init",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const did = userDid(request);
      if (!did) {
        return reply
          .code(401)
          .send({ error: "no_user", message: "Auth required" });
      }
      const check = configCheck("railway");
      if (!check.configured) {
        return reply.code(503).send({
          error: "platform_not_configured",
          platform: "railway",
          missing_config: check.missing_config,
        });
      }
      const returnTo =
        typeof request.query?.return_to === "string"
          ? request.query.return_to
          : undefined;
      try {
        const { url, state } = await buildAuthorizeUrl(did, { returnTo });
        return { authorize_url: url, state };
      } catch (err) {
        request.log.error({ err }, "railway oauth init failed");
        return reply
          .code(500)
          .send({ error: "railway_oauth_init_failed", message: err.message });
      }
    },
  );

  app.get("/v1/oauth/railway/callback", async (request, reply) => {
    const q = request.query || {};
    const code = typeof q.code === "string" ? q.code : null;
    const state = typeof q.state === "string" ? q.state : null;
    const railwayError = typeof q.error === "string" ? q.error : null;

    // Resolve pending state before branching so failure paths still
    // honor the user's return_to. The pending doc carries the PKCE
    // code_verifier in its `extra` field -- that's what redeems the
    // auth code on Railway's side.
    let pending = null;
    if (state) {
      try {
        pending = await consumePending(state);
      } catch (err) {
        request.log.error(
          { err: err.message },
          "railway oauth state consume failed",
        );
      }
    }
    const returnTo = pending?.returnTo || null;

    if (railwayError) {
      return failureRedirect(reply, railwayError, returnTo);
    }
    if (!code || !state) {
      return failureRedirect(reply, "missing_params", returnTo);
    }
    if (!pending || pending.platform !== "railway") {
      return failureRedirect(reply, "invalid_state", returnTo);
    }
    const codeVerifier = pending.extra?.codeVerifier;
    if (!codeVerifier) {
      return failureRedirect(reply, "missing_code_verifier", returnTo);
    }

    try {
      const tokens = await exchangeCode(code, codeVerifier);
      const userinfo = await fetchUserinfo(tokens.access_token);
      await storeTokens(pending.did, tokens, userinfo, {
        updatedBy: "oauth-railway-callback",
      });
      return successRedirect(reply, pending.returnTo);
    } catch (err) {
      request.log.error({ err }, "railway oauth callback failed");
      const reason = err.message.startsWith("token_exchange_failed:")
        ? err.message.split(":").slice(1).join(":")
        : "exchange_failed";
      return failureRedirect(reply, reason, returnTo);
    }
  });

  app.delete(
    "/v1/oauth/railway",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const did = userDid(request);
      if (!did) {
        return reply
          .code(401)
          .send({ error: "no_user", message: "Auth required" });
      }
      try {
        await clearTokens(did);
        return { ok: true };
      } catch (err) {
        request.log.error({ err }, "railway oauth disconnect failed");
        return reply.code(500).send({
          error: "railway_oauth_disconnect_failed",
          message: err.message,
        });
      }
    },
  );
}
