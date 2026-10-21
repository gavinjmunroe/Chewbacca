/**
 * Microsoft OAuth routes (Outlook + Teams).
 *
 *   GET    /v1/oauth/microsoft/init        Privy-gated, returns { authorize_url }
 *   GET    /v1/oauth/microsoft/callback    public, Microsoft hits this directly
 *   DELETE /v1/oauth/microsoft             Privy-gated, clears the stored tokens
 *
 * Tokens land in the caller's secrets bag under MS_OAUTH_*. medha-platform
 * uses MS_OAUTH_REFRESH to mint fresh access tokens on demand for Graph
 * calls (Calendars.ReadWrite, Mail.Send, etc.) the same way the existing
 * google-oauth.js helper does.
 */

import { requireAuth } from "../lib/auth-session.js";
import { configCheck } from "../oauth/lib/env-check.js";
import { buildAuthorizeUrl } from "../oauth/microsoft/init.js";
import {
  exchangeCode,
  storeTokens,
  clearTokens,
} from "../oauth/microsoft/callback.js";
import { consumePending } from "../oauth/state.js";
import { isAppReturnTo, appReturnUrl } from "../lib/oauth-redirect.js";
import { webBaseUrl } from "../oauth/lib/public-url.js";

const PLATFORM = "microsoft";

function frontendBase() {
  const raw = webBaseUrl();
  if (!raw) throw new Error("missing_env:MEDHA_FRONTEND_URL");
  return raw.replace(/\/+$/, "");
}

function frontendRedirect(reply, qs) {
  const base = frontendBase();
  const params = new URLSearchParams(qs).toString();
  return reply.redirect(`${base}/connect?${params}`);
}

function requirePrivyDid(request, reply) {
  const did = request.privyUser?.userId;
  if (!did) {
    reply.code(401).send({ error: "no_user", message: "Auth required" });
    return null;
  }
  return did;
}

export function registerMicrosoftOauth(app) {
  app.get(
    "/v1/oauth/microsoft/init",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const did = requirePrivyDid(request, reply);
      if (!did) return;

      const check = configCheck("microsoft");
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
          : null;

      try {
        const { url, state } = await buildAuthorizeUrl(did, { returnTo });
        return { authorize_url: url, state, platform: PLATFORM };
      } catch (err) {
        request.log?.error?.({ err }, "microsoft_oauth_init_failed");
        reply.code(500);
        return { error: "init_failed", message: err.message };
      }
    },
  );

  app.get("/v1/oauth/microsoft/callback", async (request, reply) => {
    const { code, state, error, error_description } = request.query || {};

    if (error) {
      request.log?.warn?.(
        { error, error_description },
        "microsoft_oauth_user_declined",
      );
      return frontendRedirect(reply, {
        microsoft: "failed",
        reason: String(error),
      });
    }

    if (!code || !state) {
      return frontendRedirect(reply, {
        microsoft: "failed",
        reason: "missing_code_or_state",
      });
    }

    const pending = await consumePending(String(state));
    if (!pending || pending.platform !== PLATFORM) {
      return frontendRedirect(reply, {
        microsoft: "failed",
        reason: "invalid_state",
      });
    }

    try {
      const tokens = await exchangeCode(String(code));
      await storeTokens(pending.did, tokens);
    } catch (err) {
      request.log?.error?.({ err }, "microsoft_oauth_callback_failed");
      if (isAppReturnTo(pending.returnTo)) {
        return reply.redirect(
          appReturnUrl(pending.returnTo, {
            platform: PLATFORM,
            status: "failed",
            reason: err.code || "exchange_failed",
          }),
        );
      }
      return frontendRedirect(reply, {
        microsoft: "failed",
        reason: err.code || "exchange_failed",
      });
    }

    // App-initiated flow: deep-link back into the iOS app on success.
    if (isAppReturnTo(pending.returnTo)) {
      return reply.redirect(
        appReturnUrl(pending.returnTo, {
          platform: PLATFORM,
          status: "connected",
        }),
      );
    }
    if (pending.returnTo && /^https?:\/\//.test(pending.returnTo)) {
      const sep = pending.returnTo.includes("?") ? "&" : "?";
      return reply.redirect(`${pending.returnTo}${sep}microsoft=connected`);
    }
    return frontendRedirect(reply, { microsoft: "connected" });
  });

  app.delete(
    "/v1/oauth/microsoft",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const did = requirePrivyDid(request, reply);
      if (!did) return;
      try {
        const result = await clearTokens(did);
        return { ok: true, ...result };
      } catch (err) {
        request.log?.error?.({ err }, "microsoft_oauth_disconnect_failed");
        reply.code(500);
        return { error: "disconnect_failed", message: err.message };
      }
    },
  );
}
