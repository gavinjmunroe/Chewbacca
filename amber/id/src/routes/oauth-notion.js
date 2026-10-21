/**
 * Notion OAuth routes.
 *
 *   GET    /v1/oauth/notion/init       (Privy auth) — returns { authorize_url }
 *   GET    /v1/oauth/notion/callback   (public)     — Notion redirects here
 *   DELETE /v1/oauth/notion            (Privy auth) — disconnect
 *
 * Mount via registerNotionOauthRoutes(app) from src/index.js. Mount lines for
 * all Wave-1 OAuth route groups are added together in a single follow-up
 * commit (per the Phase 1 plan) to avoid 8 parallel tabs colliding on
 * src/index.js.
 */

import { requireAuth } from "../lib/auth-session.js";
import { consumePending } from "../oauth/state.js";
import { configCheck } from "../oauth/lib/env-check.js";
import { buildAuthorizeUrl } from "../oauth/notion/init.js";
import {
  exchangeCode,
  storeTokens,
  clearTokens,
} from "../oauth/notion/callback.js";
import { isAppReturnTo, appReturnUrl } from "../lib/oauth-redirect.js";
import { webBaseUrl } from "../oauth/lib/public-url.js";

function frontendBase() {
  const raw = webBaseUrl();
  if (!raw) {
    throw new Error("missing_env:MEDHA_FRONTEND_URL");
  }
  return raw.replace(/\/+$/, "");
}

function buildReturnUrl(returnTo, query) {
  // App-initiated flow: deep-link back into the iOS app. notion success/failure
  // both route through here, so this covers both. query.notion holds the status.
  if (isAppReturnTo(returnTo)) {
    return appReturnUrl(returnTo, {
      platform: "notion",
      status: query?.notion || "connected",
      reason: query?.reason,
    });
  }
  const base = frontendBase();
  const path = returnTo && typeof returnTo === "string" ? returnTo : "/connect";
  const safePath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${base}${safePath}`);
  for (const [key, value] of Object.entries(query)) {
    if (value != null) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function requirePrivyDid(request, reply) {
  const did = request.privyUser?.userId;
  if (!did) {
    reply.code(401).send({ error: "no_user", message: "Auth required" });
    return null;
  }
  return did;
}

export function registerNotionOauthRoutes(app) {
  /**
   * Start the OAuth dance. The caller is the authenticated medha-frontend
   * user; we generate a state token bound to their DID, persist it, and
   * return the authorize URL for the browser to redirect to.
   */
  app.get(
    "/v1/oauth/notion/init",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const did = requirePrivyDid(request, reply);
      if (!did) return;

      const check = configCheck("notion");
      if (!check.configured) {
        return reply.code(503).send({
          error: "platform_not_configured",
          platform: "notion",
          missing_config: check.missing_config,
        });
      }

      const returnTo =
        typeof request.query?.return_to === "string"
          ? request.query.return_to
          : undefined;

      try {
        const { url } = await buildAuthorizeUrl(did, returnTo);
        return { authorize_url: url };
      } catch (err) {
        request.log?.error?.({ err }, "notion_oauth_init_failed");
        return reply
          .code(500)
          .send({ error: "init_failed", message: err.message });
      }
    },
  );

  /**
   * Notion redirects here after the user consents (or denies). This route is
   * public because Notion calls it directly from the user's browser — auth
   * is enforced via the state token, which is HMAC-signed and one-shot.
   */
  app.get("/v1/oauth/notion/callback", async (request, reply) => {
    const code =
      typeof request.query?.code === "string" ? request.query.code : null;
    const state =
      typeof request.query?.state === "string" ? request.query.state : null;
    const errorParam =
      typeof request.query?.error === "string" ? request.query.error : null;

    if (errorParam) {
      const pending = state ? await consumePending(state) : null;
      return reply.redirect(
        buildReturnUrl(pending?.returnTo, {
          notion: "failed",
          reason: errorParam,
        }),
      );
    }

    if (!code || !state) {
      return reply.redirect(
        buildReturnUrl(null, {
          notion: "failed",
          reason: "missing_code_or_state",
        }),
      );
    }

    const pending = await consumePending(state);
    if (!pending || pending.platform !== "notion") {
      return reply.redirect(
        buildReturnUrl(null, {
          notion: "failed",
          reason: "invalid_state",
        }),
      );
    }

    try {
      const tokens = await exchangeCode(code);
      await storeTokens(pending.did, tokens);
      return reply.redirect(
        buildReturnUrl(pending.returnTo, { notion: "connected" }),
      );
    } catch (err) {
      request.log?.error?.({ err }, "notion_oauth_callback_failed");
      const reason = (err.message || "exchange_failed").slice(0, 120);
      return reply.redirect(
        buildReturnUrl(pending.returnTo, {
          notion: "failed",
          reason,
        }),
      );
    }
  });

  /**
   * Disconnect — drops our copy of the tokens. Notion does not expose a
   * server-side revoke endpoint; the user must also remove the integration
   * from inside their Notion workspace if they want to fully sever access.
   */
  app.delete(
    "/v1/oauth/notion",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const did = requirePrivyDid(request, reply);
      if (!did) return;

      try {
        await clearTokens(did);
        return { ok: true };
      } catch (err) {
        request.log?.error?.({ err }, "notion_oauth_disconnect_failed");
        return reply
          .code(500)
          .send({ error: "disconnect_failed", message: err.message });
      }
    },
  );
}
