/**
 * GitHub OAuth routes.
 *
 *   GET    /v1/oauth/github/init       auth'd; returns { authorize_url }
 *   GET    /v1/oauth/github/callback   public; GitHub redirects here
 *   DELETE /v1/oauth/github            auth'd; revokes + clears tokens
 *
 * GitHub Classic OAuth Apps with non-expiring tokens — there is no
 * refresh path. One consent grants permanent access until the user
 * disconnects (here) or revokes from
 * github.com/settings/applications.
 */

import { requireAuth } from "../lib/auth-session.js";
import { consumePending } from "../oauth/state.js";
import { configCheck } from "../oauth/lib/env-check.js";
import { buildAuthorizeUrl } from "../oauth/github/init.js";
import {
  exchangeCode,
  fetchProfile,
  fetchPrimaryEmail,
  storeTokens,
  revokeAndClear,
} from "../oauth/github/callback.js";
import { scrapeAndIndexGithubNetwork } from "../oauth/github/scrape-network.js";
import { getSecret } from "../db/secrets.js";
import { webBaseUrl } from "../oauth/lib/public-url.js";

function frontendBase() {
  return (webBaseUrl() || "").replace(/\/+$/, "");
}

/**
 * Coerce a possibly-relative returnTo (the medha-frontend connect page
 * sends `/connect` as a bare path) into an absolute URL on the
 * MEDHA_FRONTEND_URL host. Without this, reply.redirect("/connect")
 * routes against medha-id and 404s, because medha-id has no /connect
 * handler.
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
    return reply.code(400).send({ error: "github_oauth_failed", reason });
  }
  const sep = target.includes("?") ? "&" : "?";
  return reply.redirect(
    `${target}${sep}github=failed&reason=${encodeURIComponent(reason)}`,
  );
}

function successRedirect(reply, returnTo) {
  const target = absolutizeReturnTo(returnTo);
  if (!target) {
    return reply.send({ ok: true, github: "connected" });
  }
  const sep = target.includes("?") ? "&" : "?";
  let final = target;
  if (!/[?&]github=/.test(final)) {
    final = `${final}${sep}github=connected`;
  }
  return reply.redirect(final);
}

function userDid(request) {
  return request.privyUser?.userId || null;
}

export function registerGithubOauthRoutes(app) {
  /**
   * GET /v1/oauth/github/init
   * Auth: Bearer. Returns the GitHub authorize URL the frontend should
   * redirect the browser to.
   */
  app.get(
    "/v1/oauth/github/init",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const did = userDid(request);
      if (!did) {
        return reply
          .code(401)
          .send({ error: "no_user", message: "Auth required" });
      }
      const check = configCheck("github");
      if (!check.configured) {
        return reply.code(503).send({
          error: "platform_not_configured",
          platform: "github",
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
        request.log.error({ err }, "github oauth init failed");
        return reply
          .code(500)
          .send({ error: "github_oauth_init_failed", message: err.message });
      }
    },
  );

  /**
   * GET /v1/oauth/github/callback
   * Public — GitHub redirects here. Verify state, exchange code, fetch
   * profile + primary email, persist, redirect back to medha-frontend.
   */
  app.get("/v1/oauth/github/callback", async (request, reply) => {
    const q = request.query || {};
    const code = typeof q.code === "string" ? q.code : null;
    const state = typeof q.state === "string" ? q.state : null;
    const ghError = typeof q.error === "string" ? q.error : null;

    // Resolve pending state first so failure paths can still land the
    // user on the frontend's /connect (or whatever returnTo they came in
    // with). Without this, early failures redirect to medha-id's /connect
    // and 404 because medha-id has no frontend.
    let pending = null;
    if (state) {
      try {
        pending = await consumePending(state);
      } catch (err) {
        request.log.error(
          { err: err.message },
          "github oauth state consume failed",
        );
      }
    }
    const returnTo = pending?.returnTo || null;

    if (ghError) {
      return failureRedirect(reply, ghError, returnTo);
    }
    if (!code || !state) {
      return failureRedirect(reply, "missing_params", returnTo);
    }
    if (!pending || pending.platform !== "github") {
      return failureRedirect(reply, "invalid_state", returnTo);
    }

    try {
      const tokens = await exchangeCode(code);
      const profile = await fetchProfile(tokens.access_token);
      if (!profile.email) {
        const fallback = await fetchPrimaryEmail(tokens.access_token);
        if (fallback) profile.email = fallback;
      }
      await storeTokens(pending.did, tokens, profile, {
        updatedBy: "oauth-github-callback",
      });
      // Fire-and-forget: pull the user's GitHub followers + following and
      // embed each into the unified people graph. The HTTP redirect comes
      // first; the scrape runs in the background and its result is logged
      // separately. Errors are caught and logged, never thrown, so a
      // scraping problem cannot break the OAuth completion UX.
      scrapeAndIndexGithubNetwork(pending.did, request.log).catch((err) => {
        request.log.error(
          { did: pending.did, msg: err?.message || String(err) },
          "[oauth:github] background network scrape threw",
        );
      });
      return successRedirect(reply, pending.returnTo);
    } catch (err) {
      request.log.error({ err }, "github oauth callback failed");
      const reason = err.message.startsWith("token_exchange_failed:")
        ? err.message.split(":").slice(1).join(":")
        : "exchange_failed";
      return failureRedirect(reply, reason, returnTo);
    }
  });

  /**
   * POST /v1/oauth/github/sync-network
   * Auth: Bearer. Kicks off a fresh followers + following pull and
   * Pinecone embed for the authenticated user. Returns 200 immediately
   * while the scrape runs in the background — the response carries no
   * count because the scrape is asynchronous.
   *
   * Idempotent. Subsequent calls deepen the back-catalog by enriching
   * up to ENRICH_PER_SYNC additional un-enriched logins and refresh the
   * relationship tag on rows whose follower/following status has flipped.
   */
  app.post(
    "/v1/oauth/github/sync-network",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const did = userDid(request);
      if (!did) {
        return reply
          .code(401)
          .send({ error: "no_user", message: "Auth required" });
      }
      const accessToken = await getSecret(did, "GITHUB_OAUTH_ACCESS").catch(
        () => null,
      );
      if (!accessToken) {
        return reply.code(409).send({
          error: "not_connected",
          message: "Connect GitHub before syncing the network.",
        });
      }
      scrapeAndIndexGithubNetwork(did, request.log).catch((err) => {
        request.log.error(
          { did, msg: err?.message || String(err) },
          "[oauth:github/sync-network] background scrape threw",
        );
      });
      return { ok: true, queued: true };
    },
  );

  /**
   * DELETE /v1/oauth/github
   * Auth: Bearer. Revokes the access token on GitHub's side and clears
   * GITHUB_OAUTH_* keys from the caller's secrets bag.
   */
  app.delete(
    "/v1/oauth/github",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const did = userDid(request);
      if (!did) {
        return reply
          .code(401)
          .send({ error: "no_user", message: "Auth required" });
      }
      try {
        const accessToken = await getSecret(did, "GITHUB_OAUTH_ACCESS");
        const result = await revokeAndClear(did, { accessToken });
        return { ok: true, revoked: result.revoked };
      } catch (err) {
        request.log.error({ err }, "github oauth revoke failed");
        return reply.code(500).send({
          error: "github_oauth_revoke_failed",
          message: err.message,
        });
      }
    },
  );
}
