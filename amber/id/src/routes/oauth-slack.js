/**
 * Slack OAuth routes — workspace admin install.
 *
 *   GET    /v1/oauth/slack/init       — auth'd; returns { authorize_url }
 *   GET    /v1/oauth/slack/callback   — public; Slack redirects here with ?code&state
 *   DELETE /v1/oauth/slack            — auth'd; revokes + clears workspace install
 *
 * Per PHASE_1_AUTH.md the mount line is intentionally deferred. Caleb
 * adds `registerSlackOauthRoutes(app)` to src/index.js in a single
 * follow-up commit once all 7 Phase 1 OAuth tabs have shipped.
 */

import { requireAuth } from "../lib/auth-session.js";
import { consumePending } from "../oauth/state.js";
import { configCheck } from "../oauth/lib/env-check.js";
import { buildAuthorizeUrl } from "../oauth/slack/init.js";
import {
  exchangeCode,
  storeTokens,
  revokeTokens,
} from "../oauth/slack/callback.js";
import { getSecret } from "../db/secrets.js";
import { linkByPersonId } from "../db/slack-links.js";
import { scrapeAndIndexSlackMessages } from "../oauth/slack/scrape-messages.js";
import { isAppReturnTo, appReturnUrl } from "../lib/oauth-redirect.js";
import { webBaseUrl } from "../oauth/lib/public-url.js";

function frontendBase() {
  return (webBaseUrl() || "").replace(/\/+$/, "");
}

/**
 * Resolve a stored returnTo (which may be a same-origin relative path like
 * `/connect`, a full absolute URL, or empty) to an absolute URL on the
 * frontend, with an open-redirect guard.
 *
 *   undefined / empty   → `${frontendBase}/connect`
 *   "/connect"          → `${frontendBase}/connect`
 *   "//evil.com/x"      → `${frontendBase}/connect` (rejected)
 *   "https://x..."      → returned as-is (only allowed for the frontend host)
 *
 * The frontend's PlatformGrid passes `return_to=/connect` (relative path).
 * The old code stored that as-is and `reply.redirect` then resolved it
 * against medha-id's own host, producing a Fastify 404 on /connect.
 * Mirrors the `safeReturnTo` pattern from oauth-google.js.
 */
function resolveFrontendTarget(returnTo) {
  const base = frontendBase();
  if (!base) return null;
  if (returnTo && /^https?:\/\//.test(returnTo)) {
    try {
      const u = new URL(returnTo);
      const baseHost = new URL(base).host;
      if (u.host === baseHost) return returnTo;
    } catch {
      // fall through to default
    }
    return `${base}/connect`;
  }
  if (returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")) {
    return `${base}${returnTo}`;
  }
  return `${base}/connect`;
}

function appendQuery(target, key, value) {
  const sep = target.includes("?") ? "&" : "?";
  return `${target}${sep}${key}=${encodeURIComponent(value)}`;
}

function failureRedirect(reply, reason) {
  const target = resolveFrontendTarget(null);
  if (!target) {
    return reply.code(400).send({ error: "slack_oauth_failed", reason });
  }
  let url = appendQuery(target, "slack", "failed");
  url = appendQuery(url, "reason", reason);
  return reply.redirect(url);
}

function successRedirect(reply, returnTo) {
  // App-initiated flow: deep-link back into the iOS app instead of the web
  // /connect page so the in-app auth session closes on the connection.
  if (isAppReturnTo(returnTo)) {
    return reply.redirect(
      appReturnUrl(returnTo, { platform: "slack", status: "connected" }),
    );
  }
  const target = resolveFrontendTarget(returnTo);
  if (!target) {
    return reply.send({ ok: true, slack: "connected" });
  }
  if (/[?&]slack=/.test(target)) return reply.redirect(target);
  return reply.redirect(appendQuery(target, "slack", "connected"));
}

export function registerSlackOauthRoutes(app) {
  /**
   * GET /v1/oauth/slack/init
   * Auth: Bearer (amber-id JWT or Privy). Returns the Slack authorize URL
   * the frontend should redirect the browser to.
   */
  app.get(
    "/v1/oauth/slack/init",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const did = request.privyUser?.userId;
      if (!did) {
        return reply
          .code(401)
          .send({ error: "no_user", message: "Auth required" });
      }
      const check = configCheck("slack");
      if (!check.configured) {
        return reply.code(503).send({
          error: "platform_not_configured",
          platform: "slack",
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
        request.log.error({ err }, "slack oauth init failed");
        return reply
          .code(500)
          .send({ error: "slack_oauth_init_failed", message: err.message });
      }
    },
  );

  /**
   * GET /v1/oauth/slack/callback
   * Public — Slack redirects here directly. Verify state, exchange code,
   * persist tokens, redirect browser back to medha-frontend.
   */
  app.get("/v1/oauth/slack/callback", async (request, reply) => {
    const code =
      typeof request.query?.code === "string" ? request.query.code : null;
    const state =
      typeof request.query?.state === "string" ? request.query.state : null;
    const slackError =
      typeof request.query?.error === "string" ? request.query.error : null;

    if (slackError) {
      return failureRedirect(reply, slackError);
    }
    if (!code || !state) {
      return failureRedirect(reply, "missing_params");
    }

    const pending = await consumePending(state);
    if (!pending || pending.platform !== "slack") {
      return failureRedirect(reply, "invalid_state");
    }

    try {
      const tokens = await exchangeCode(code);
      await storeTokens(pending.did, tokens);

      // Write the slack-links record so the agent's inbound Slack
      // envelope's Option A lookupLink finds this user on their very
      // first DM (no manual auto-bind curl, no Option C ceremony).
      // Best-effort: a failure here doesn't fail the OAuth completion.
      const teamId = tokens?.team?.id;
      const slackUserId = tokens?.authed_user?.id;
      if (teamId && slackUserId) {
        try {
          await linkByPersonId(teamId, slackUserId, pending.did, "oauth");
        } catch (linkErr) {
          request.log.warn(
            { err: linkErr },
            "slack oauth: link write failed (token storage already succeeded)",
          );
        }
      }

      // Fire-and-forget: walk the user's recent Slack history and embed
      // every real message into their Pinecone namespace so Medha can
      // semantically recall "what did we discuss in #design last week?".
      // The browser is already redirecting; we never block on this.
      // Errors are logged, never thrown.
      scrapeAndIndexSlackMessages(pending.did, request.log).catch((err) => {
        request.log.error(
          { did: pending.did, msg: err?.message || String(err) },
          "[oauth:slack] background scrape threw",
        );
      });

      return successRedirect(reply, pending.returnTo);
    } catch (err) {
      request.log.error({ err }, "slack oauth callback failed");
      return failureRedirect(reply, "exchange_failed");
    }
  });

  /**
   * POST /v1/oauth/slack/sync
   *
   * Auth: Bearer. Triggers a fresh walk of the caller's Slack history,
   * embedding every real message into their Pinecone namespace. Mirrors
   * the fire-and-forget scrape that runs at OAuth callback time so the
   * user can re-sync without re-consenting.
   *
   * Returns immediately with { ok: true }; the actual work runs async.
   * Requires SLACK_USER_TOKEN in the secrets bag (set by a prior OAuth
   * completion); returns 409 not_connected when missing so the
   * frontend can prompt re-connect instead of silently no-oping.
   */
  app.post(
    "/v1/oauth/slack/sync",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const did = request.privyUser?.userId;
      if (!did) {
        return reply
          .code(401)
          .send({ error: "no_user", message: "Auth required" });
      }
      const token = await getSecret(did, "SLACK_USER_TOKEN");
      if (!token) {
        return reply.code(409).send({
          error: "not_connected",
          message: "Connect Slack before syncing messages",
        });
      }
      scrapeAndIndexSlackMessages(did, request.log).catch((err) => {
        request.log.error(
          { did, msg: err?.message || String(err) },
          "[oauth:slack/sync] background scrape threw",
        );
      });
      return { ok: true, queued: true };
    },
  );

  /**
   * DELETE /v1/oauth/slack
   * Auth: Bearer. Revokes the bot token on Slack's side and clears
   * SLACK_WORKSPACE_* keys from the caller's secrets bag.
   */
  app.delete(
    "/v1/oauth/slack",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const did = request.privyUser?.userId;
      if (!did) {
        return reply
          .code(401)
          .send({ error: "no_user", message: "Auth required" });
      }
      try {
        // Revoke both the workspace bot token AND the per-user xoxp
        // token. revokeTokens accepts an array and best-efforts each.
        const [workspaceToken, userToken] = await Promise.all([
          getSecret(did, "SLACK_WORKSPACE_TOKEN"),
          getSecret(did, "SLACK_USER_TOKEN"),
        ]);
        const result = await revokeTokens(did, [workspaceToken, userToken]);
        return { ok: true, revoked: result.revoked };
      } catch (err) {
        request.log.error({ err }, "slack oauth revoke failed");
        return reply
          .code(500)
          .send({ error: "slack_oauth_revoke_failed", message: err.message });
      }
    },
  );
}
