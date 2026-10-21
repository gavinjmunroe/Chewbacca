/**
 * Twitter (X) OAuth 2.0 routes.
 *
 *   GET    /v1/oauth/twitter/init       authed: returns { authorize_url }
 *   GET    /v1/oauth/twitter/callback   public: Twitter redirects here
 *   DELETE /v1/oauth/twitter            authed: clears the secrets bag keys
 *
 * Phase 1 deferred-mount convention: the entry point `src/index.js` is NOT
 * edited from this tab. Caleb adds a single follow-up commit that imports
 * `registerTwitterOauthRoutes` and mounts it alongside the other Phase 1
 * OAuth route groups. This avoids 8 tabs racing on the same file.
 */

import { requireAuth } from "../lib/auth-session.js";
import { configCheck } from "../oauth/lib/env-check.js";
import { buildAuthorizeUrl } from "../oauth/twitter/init.js";
import {
  exchangeCode,
  storeTokens,
  revokeToken,
} from "../oauth/twitter/callback.js";
import { scrapeAndIndexTwitterFollowing } from "../oauth/twitter/scrape-following.js";
import { consumePending } from "../oauth/state.js";
import { getSecret, deleteSecrets } from "../db/secrets.js";
import { isAppReturnTo, appReturnUrl } from "../lib/oauth-redirect.js";
import { webBaseUrl } from "../oauth/lib/public-url.js";

const PLATFORM = "twitter";
const SECRET_KEYS = [
  "TWITTER_OAUTH_ACCESS",
  "TWITTER_OAUTH_REFRESH",
  "TWITTER_OAUTH_EXPIRES_AT",
  "TWITTER_OAUTH_SCOPES",
  "TWITTER_OAUTH_TOKEN_TYPE",
];

function frontendUrl() {
  const base = webBaseUrl() || "";
  return base.replace(/\/+$/, "");
}

function failureRedirect(reply, reason) {
  const url = `${frontendUrl()}/connect?twitter=failed&reason=${encodeURIComponent(reason)}`;
  return reply.redirect(url, 302);
}

export function registerTwitterOauthRoutes(app) {
  app.get(
    "/v1/oauth/twitter/init",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const did = request.privyUser?.userId;
      if (!did) {
        reply.code(401);
        return { error: "unauthenticated" };
      }
      const check = configCheck("twitter");
      if (!check.configured) {
        return reply.code(503).send({
          error: "platform_not_configured",
          platform: PLATFORM,
          missing_config: check.missing_config,
        });
      }
      const returnTo =
        typeof request.query?.return_to === "string"
          ? request.query.return_to
          : "/connect";
      try {
        const { url } = await buildAuthorizeUrl(did, returnTo);
        return { authorize_url: url };
      } catch (err) {
        request.log.error({ err: err.message }, "twitter oauth init failed");
        reply.code(500);
        return { error: "init_failed", detail: err.message };
      }
    },
  );

  app.get("/v1/oauth/twitter/callback", async (request, reply) => {
    const code =
      typeof request.query?.code === "string" ? request.query.code : null;
    const state =
      typeof request.query?.state === "string" ? request.query.state : null;
    const oauthError =
      typeof request.query?.error === "string" ? request.query.error : null;

    if (oauthError) {
      return failureRedirect(reply, oauthError);
    }
    if (!code || !state) {
      return failureRedirect(reply, "missing_code_or_state");
    }

    let pending;
    try {
      pending = await consumePending(state);
    } catch (err) {
      request.log.error({ err: err.message }, "twitter consumePending threw");
      return failureRedirect(reply, "state_lookup_failed");
    }
    if (!pending) {
      return failureRedirect(reply, "invalid_or_expired_state");
    }
    if (pending.platform !== PLATFORM) {
      return failureRedirect(reply, "platform_mismatch");
    }

    const codeVerifier = pending.extra?.codeVerifier;
    if (!codeVerifier) {
      return failureRedirect(reply, "missing_pkce_verifier");
    }

    let tokens;
    try {
      tokens = await exchangeCode(code, codeVerifier);
    } catch (err) {
      request.log.error({ err: err.message }, "twitter token exchange failed");
      return failureRedirect(reply, "token_exchange_failed");
    }

    try {
      await storeTokens(pending.did, tokens, { updatedBy: "oauth-twitter" });
    } catch (err) {
      request.log.error({ err: err.message }, "twitter storeTokens failed");
      return failureRedirect(reply, "store_tokens_failed");
    }

    // Fire-and-forget: pull every follow into Firestore + Pinecone so the
    // user's people graph is populated before they ever ask Medha about it.
    // We don't await: the user's browser shouldn't have to wait for the
    // first sync (which can hit ~2000 follows) before the redirect.
    scrapeAndIndexTwitterFollowing(pending.did, request.log).catch((err) => {
      request.log.error(
        { did: pending.did, msg: err?.message || String(err) },
        "[oauth:twitter/callback] background following sync threw",
      );
    });

    // App-initiated flow: deep-link back into the iOS app on success.
    if (isAppReturnTo(pending.returnTo)) {
      return reply.redirect(
        appReturnUrl(pending.returnTo, {
          platform: PLATFORM,
          status: "connected",
        }),
        302,
      );
    }
    const returnTo = pending.returnTo || "/connect";
    const sep = returnTo.includes("?") ? "&" : "?";
    const successUrl = `${frontendUrl()}${returnTo}${sep}twitter=connected`;
    return reply.redirect(successUrl, 302);
  });

  // POST /v1/oauth/twitter/sync-following
  //
  // Privy-gated. Pulls the connected user's X "following" list into the
  // unified contact graph. Returns immediately with { ok: true } and runs
  // the scrape fire-and-forget so the popup doesn't sit on a multi-minute
  // request while the X API paginates.
  //
  // Re-syncing is safe and cheap: each follow is keyed by X user id, so
  // subsequent runs overwrite existing rows rather than duplicating.
  // Pagination state persists across runs via TWITTER_FOLLOWING_PAGINATION_TOKEN
  // in the secrets bag, so a sync that 429s mid-flight resumes from the
  // same cursor on the next call instead of restarting at page 0.
  app.post(
    "/v1/oauth/twitter/sync-following",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const did = request.privyUser?.userId;
      if (!did) {
        reply.code(401);
        return { error: "unauthenticated" };
      }
      scrapeAndIndexTwitterFollowing(did, request.log).catch((err) => {
        request.log.error(
          { did, msg: err?.message || String(err) },
          "[oauth:twitter/sync-following] background sync threw",
        );
      });
      return { ok: true };
    },
  );

  app.delete(
    "/v1/oauth/twitter",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const did = request.privyUser?.userId;
      if (!did) {
        reply.code(401);
        return { error: "unauthenticated" };
      }

      try {
        const refresh = await getSecret(did, "TWITTER_OAUTH_REFRESH");
        const access = await getSecret(did, "TWITTER_OAUTH_ACCESS");

        if (refresh) {
          try {
            await revokeToken(refresh, "refresh_token");
          } catch (err) {
            request.log.warn(
              { err: err.message },
              "twitter refresh-token revoke failed (continuing)",
            );
          }
        }
        if (access) {
          try {
            await revokeToken(access, "access_token");
          } catch (err) {
            request.log.warn(
              { err: err.message },
              "twitter access-token revoke failed (continuing)",
            );
          }
        }

        await deleteSecrets(did, SECRET_KEYS);
        return { ok: true, disconnected: PLATFORM };
      } catch (err) {
        request.log.error({ err: err.message }, "twitter disconnect failed");
        reply.code(500);
        return { error: "disconnect_failed", detail: err.message };
      }
    },
  );
}
