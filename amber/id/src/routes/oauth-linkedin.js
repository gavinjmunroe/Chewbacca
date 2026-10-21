/**
 * LinkedIn OAuth routes.
 *
 *   GET    /v1/oauth/linkedin/init       Privy-gated. Returns { authorize_url }.
 *   GET    /v1/oauth/linkedin/callback   Public (LinkedIn redirects here).
 *                                        Exchanges code, writes tokens, then
 *                                        302s the browser back to the frontend.
 *   DELETE /v1/oauth/linkedin            Privy-gated. Revokes + clears secrets.
 *
 * Per the Phase 1 plan, this file is mounted by a follow-up commit to
 * src/index.js that wires `registerLinkedinOauth(app)` alongside the other
 * platform-specific OAuth registrars - avoids 8 tabs racing on index.js.
 */

import { requireAuth } from "../lib/auth-session.js";
import { consumePending } from "../oauth/state.js";
import { configCheck } from "../oauth/lib/env-check.js";
import { buildAuthorizeUrl } from "../oauth/linkedin/init.js";
import {
  exchangeCode,
  storeTokens,
  revokeToken,
} from "../oauth/linkedin/callback.js";
import { deleteSecrets, getSecret, setSecrets } from "../db/secrets.js";
import { scrapeAndIndexConnections } from "../oauth/linkedin/scrape-connections.js";
import { webBaseUrl } from "../oauth/lib/public-url.js";

const VOYAGER_PROBE_URL = "https://www.linkedin.com/voyager/api/me";
const VOYAGER_CONNECTIONS_URL =
  "https://www.linkedin.com/voyager/api/relationships/dash/connections?count=1&q=search&start=0";
const VOYAGER_TIMEOUT_MS = 10000;

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/**
 * Build the header set Voyager expects. LinkedIn's edge gateway is picky:
 * a missing csrf-token returns 401, missing x-li-* tracking headers
 * sometimes returns 999, and a non-browser User-Agent invites rate limiting.
 *
 * The Chrome extension posts the raw JSESSIONID without surrounding quotes
 * (because that's how the cookie shows up in chrome.cookies.get). LinkedIn
 * stores it WITH quotes in the browser. Both work in the Cookie header but
 * the csrf-token header must be the unquoted ajax: form.
 */
function buildVoyagerHeaders(liAt, jsessionidRaw) {
  const unquoted = jsessionidRaw.replace(/^"|"$/g, "");
  const csrf = unquoted.startsWith("ajax:") ? unquoted : `ajax:${unquoted}`;
  const cookieValue = `li_at=${liAt}; JSESSIONID="${csrf}"`;
  return {
    cookie: cookieValue,
    "csrf-token": csrf,
    "x-restli-protocol-version": "2.0.0",
    accept: "application/vnd.linkedin.normalized+json+2.1",
    "accept-language": "en-US,en;q=0.9",
    "user-agent": BROWSER_USER_AGENT,
    "x-li-lang": "en_US",
    "x-li-track":
      '{"clientVersion":"1.13.0","mpVersion":"1.13.0","osName":"web","timezoneOffset":-7,"timezone":"America/Los_Angeles","deviceFormFactor":"DESKTOP","mpName":"voyager-web"}',
  };
}

/**
 * Surface the real reason undici's fetch died. Node's fetch wraps everything
 * in a generic 'fetch failed' string; the actionable detail lives on
 * err.cause (a SystemError or a TLS error with a code like ENOTFOUND,
 * ECONNREFUSED, UND_ERR_SOCKET, CERT_HAS_EXPIRED, etc).
 */
function describeFetchError(err) {
  if (!err) return { message: "unknown" };
  const cause = err.cause || {};
  return {
    message: err.message || String(err),
    causeMessage: cause.message,
    causeCode: cause.code,
    causeErrno: cause.errno,
    causeName: cause.name,
  };
}

/**
 * Probe LinkedIn's Voyager /me endpoint with the candidate cookies. Returns
 * { ok: true } when LinkedIn recognizes the session, or { ok: false, status }
 * when LinkedIn rejects (401 / 403 / 999 / etc). Used to validate cookies
 * BEFORE persisting them so the secrets bag never holds a dead session.
 */
async function probeVoyagerCookies(liAt, jsessionidRaw, log) {
  const headers = buildVoyagerHeaders(liAt, jsessionidRaw);
  let res;
  try {
    res = await fetch(VOYAGER_PROBE_URL, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(VOYAGER_TIMEOUT_MS),
    });
  } catch (err) {
    const detail = describeFetchError(err);
    if (log) {
      log.warn(
        { ...detail, url: VOYAGER_PROBE_URL },
        "[voyager:probe] fetch failed",
      );
    }
    return { ok: false, status: 0, networkError: detail };
  }
  if (res.status === 401 || res.status === 403 || res.status === 999) {
    return { ok: false, status: res.status };
  }
  if (!res.ok) {
    return { ok: false, status: res.status };
  }
  return { ok: true, status: res.status };
}

/**
 * Pull the user's total connection count by hitting the connections list
 * endpoint with count=1 and reading the paging.total field. Cheap, single
 * round-trip, gives the popup a real number to show. Returns null on any
 * failure (we still return ok to the extension; the worker can backfill).
 */
async function fetchConnectionsCount(liAt, jsessionidRaw, log) {
  const headers = buildVoyagerHeaders(liAt, jsessionidRaw);
  let res;
  try {
    res = await fetch(VOYAGER_CONNECTIONS_URL, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(VOYAGER_TIMEOUT_MS),
    });
  } catch (err) {
    const detail = describeFetchError(err);
    if (log) {
      log.warn(
        { ...detail, url: VOYAGER_CONNECTIONS_URL },
        "[voyager:connections] fetch failed",
      );
    }
    return null;
  }
  if (!res.ok) {
    if (log) {
      log.warn(
        { status: res.status },
        "[voyager:connections] non-200 response",
      );
    }
    return null;
  }
  let data;
  try {
    data = await res.json();
  } catch (err) {
    if (log)
      log.warn({ err: err.message }, "[voyager:connections] json parse failed");
    return null;
  }
  // LinkedIn's paginated responses surface the total in different shapes
  // depending on the decoration. Try the common ones in order.
  const total =
    data?.paging?.total ??
    data?.data?.paging?.total ??
    data?.metadata?.totalResultCount ??
    null;
  if (typeof total === "number") return total;
  return null;
}

/**
 * WAS: write a linkedin_sync_jobs document to Firestore for a Voyager scraper.
 *
 * The scraper that was meant to consume this queue does not exist -- nothing has
 * ever read the collection. Firestore is gone; the queue goes with it. The
 * caller's contract is unchanged, so the OAuth callback still succeeds and simply
 * reports that nothing was enqueued.
 */
async function enqueueLinkedinSyncJob() {
  return { enqueued: false, reason: "sync_queue_removed" };
}

const LINKEDIN_SECRET_KEYS = [
  "LINKEDIN_OAUTH_ACCESS",
  "LINKEDIN_OAUTH_REFRESH",
  "LINKEDIN_OAUTH_EXPIRES_AT",
  "LINKEDIN_OAUTH_REFRESH_EXPIRES_AT",
  "LINKEDIN_OAUTH_SCOPES",
  "LINKEDIN_OAUTH_CONNECTED_AT",
];

function frontendUrl() {
  const base = (webBaseUrl() || "").replace(/\/+$/, "");
  if (!base) {
    throw new Error("MEDHA_FRONTEND_URL is required for OAuth callbacks");
  }
  return base;
}

function buildReturnUrl(returnTo, query) {
  const base = frontendUrl();
  const path = returnTo && returnTo.startsWith("/") ? returnTo : "/connect";
  const qs = new URLSearchParams(query).toString();
  return `${base}${path}${qs ? `?${qs}` : ""}`;
}

export function registerLinkedinOauth(app) {
  app.get(
    "/v1/oauth/linkedin/init",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const did = request.privyUser?.userId;
      if (!did) {
        return reply
          .code(401)
          .send({ error: "unauthorized", code: "missing_user" });
      }
      const check = configCheck("linkedin");
      if (!check.configured) {
        return reply.code(503).send({
          error: "platform_not_configured",
          platform: "linkedin",
          missing_config: check.missing_config,
        });
      }
      const returnTo =
        typeof request.query?.return_to === "string"
          ? request.query.return_to
          : "/connect";
      try {
        const { url } = await buildAuthorizeUrl(did, { returnTo });
        return { authorize_url: url };
      } catch (err) {
        request.log.error({ msg: err.message }, "[oauth:linkedin] init failed");
        return reply
          .code(500)
          .send({ error: "init_failed", message: err.message });
      }
    },
  );

  app.get("/v1/oauth/linkedin/callback", async (request, reply) => {
    const {
      code,
      state,
      error,
      error_description: errorDescription,
    } = request.query || {};

    if (error) {
      request.log.warn(
        { error, errorDescription },
        "[oauth:linkedin] user denied or provider error",
      );
      return reply.redirect(
        buildReturnUrl("/connect", {
          linkedin: "failed",
          reason: error,
        }),
      );
    }

    if (!code || !state) {
      return reply.redirect(
        buildReturnUrl("/connect", {
          linkedin: "failed",
          reason: "missing_code_or_state",
        }),
      );
    }

    let pending;
    try {
      pending = await consumePending(state);
    } catch (err) {
      request.log.error(
        { msg: err.message },
        "[oauth:linkedin] consumePending threw",
      );
      return reply.redirect(
        buildReturnUrl("/connect", {
          linkedin: "failed",
          reason: "state_error",
        }),
      );
    }

    if (!pending || pending.platform !== "linkedin") {
      return reply.redirect(
        buildReturnUrl("/connect", {
          linkedin: "failed",
          reason: "invalid_state",
        }),
      );
    }

    try {
      const tokens = await exchangeCode(code);
      await storeTokens(pending.did, tokens);
    } catch (err) {
      request.log.error(
        { msg: err.message, status: err.status, payload: err.payload },
        "[oauth:linkedin] token exchange or storage failed",
      );
      return reply.redirect(
        buildReturnUrl(pending.returnTo || "/connect", {
          linkedin: "failed",
          reason: "token_exchange_failed",
        }),
      );
    }

    return reply.redirect(
      buildReturnUrl(pending.returnTo || "/connect", {
        linkedin: "connected",
      }),
    );
  });

  // POST /v1/oauth/linkedin/cookies
  //
  // The Amber LinkedIn Chrome extension posts the user's browser session
  // cookies here. LinkedIn's official OAuth APIs do not expose first-degree
  // connections, so the only path to that data is authenticating as the
  // user with their li_at + JSESSIONID cookies against the Voyager
  // endpoints. This route is the cookie-mode counterpart to the OAuth
  // flow above; both write to the same secrets bag and both surface as
  // 'LinkedIn connected' on /connect.
  //
  // Auth: Bearer <amber-jwt> via requireAuth (same gate as the rest of
  // /v1/oauth/linkedin/*).
  // Body: { li_at: string, jsessionid: string }
  // 200:  { ok: true, connections_synced?: number }
  // 401:  unauthorized
  // 400:  { error: "invalid_body", message }
  // 502:  { error: "linkedin_rejected", message } (LinkedIn rejected the cookies)
  // 500:  { error: "internal", message }
  app.post(
    "/v1/oauth/linkedin/cookies",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const did = request.privyUser?.userId;
      if (!did) {
        return reply
          .code(401)
          .send({ error: "unauthorized", code: "missing_user" });
      }

      const body = request.body || {};
      const liAt = typeof body.li_at === "string" ? body.li_at.trim() : "";
      const jsessionid =
        typeof body.jsessionid === "string" ? body.jsessionid.trim() : "";
      if (!liAt) {
        return reply.code(400).send({
          error: "invalid_body",
          message: "li_at is required and must be a non-empty string",
        });
      }
      if (!jsessionid) {
        return reply.code(400).send({
          error: "invalid_body",
          message: "jsessionid is required and must be a non-empty string",
        });
      }

      // Validate the cookies BEFORE persisting. Hits LinkedIn's Voyager
      // /me endpoint with the candidate session; LinkedIn rejects bad
      // cookies with 401 / 403 / 999. We surface that as 502
      // linkedin_rejected with the documented user-visible message so
      // the extension's error-surfacing path lights up cleanly. A
      // network failure on the probe is NOT treated as rejection — we
      // persist the cookies and let the future sync worker discover the
      // outage from its side, so a temporary blip doesn't lose a
      // working session.
      const probe = await probeVoyagerCookies(liAt, jsessionid, request.log);
      if (!probe.ok && probe.status > 0) {
        request.log.warn(
          { did, status: probe.status },
          "[oauth:linkedin/cookies] LinkedIn rejected the session",
        );
        return reply.code(502).send({
          error: "linkedin_rejected",
          message:
            "LinkedIn rejected the session. Re-login in your browser and re-sync.",
        });
      }
      if (!probe.ok) {
        request.log.warn(
          { did, networkError: probe.networkError },
          "[oauth:linkedin/cookies] Voyager probe network failure — persisting cookies anyway",
        );
      }

      // If the probe worked, pull the user's real connection count in the
      // same request so the popup gets a real number instead of "Sync
      // queued." Best-effort: a failure here doesn't fail the request
      // (the future worker will backfill).
      let connectionsCount = null;
      if (probe.ok) {
        connectionsCount = await fetchConnectionsCount(
          liAt,
          jsessionid,
          request.log,
        );
        if (connectionsCount !== null) {
          request.log.info(
            { did, count: connectionsCount },
            "[oauth:linkedin/cookies] connection count fetched",
          );
        }
      }

      // Persist to the per-tenant secrets bag. LINKEDIN_OAUTH_REFRESH is
      // set to the 'cookie-mode' sentinel so the /v1/me/connections
      // probe (presenceKey = LINKEDIN_OAUTH_REFRESH) sees LinkedIn as
      // connected even though no OAuth refresh token exists.
      try {
        const secretsToWrite = {
          LINKEDIN_COOKIE_LI_AT: liAt,
          LINKEDIN_COOKIE_JSESSIONID: jsessionid,
          LINKEDIN_COOKIE_UPDATED_AT: new Date().toISOString(),
          LINKEDIN_OAUTH_REFRESH: "cookie-mode",
        };
        if (connectionsCount !== null) {
          secretsToWrite.LINKEDIN_CONNECTIONS_COUNT = String(connectionsCount);
          secretsToWrite.LINKEDIN_CONNECTIONS_COUNT_AT =
            new Date().toISOString();
        }
        await setSecrets(did, secretsToWrite, {
          updatedBy: "oauth-linkedin-cookies",
        });
      } catch (err) {
        request.log.error(
          { msg: err.message },
          "[oauth:linkedin/cookies] secrets bag write failed",
        );
        return reply
          .code(500)
          .send({ error: "internal", message: "Failed to persist cookies" });
      }

      // Enqueue a Firestore job for the future Voyager scraper to
      // consume. Best-effort: a failure to enqueue does NOT fail the
      // request because the cookies are already persisted and a cron
      // could still scan LINKEDIN_COOKIE_UPDATED_AT to backfill. The
      // job doc is the explicit handoff the spec asked for.
      const job = await enqueueLinkedinSyncJob(did);
      if (!job.enqueued) {
        request.log.warn(
          { did, err: job.error },
          "[oauth:linkedin/cookies] sync job enqueue failed (cookies still saved)",
        );
      }

      // Fire-and-forget: full paginated scrape of every connection,
      // persisted to Firestore + embedded into Pinecone so the user can
      // semantically search ("who in my contacts goes to school at
      // Stanford"). The HTTP response has already been computed; we
      // return it after queuing the async work. Errors are logged, never
      // thrown — the connections_synced count in the response is the
      // user's total per Voyager paging, not what the scrape actually
      // persisted (which is logged separately).
      scrapeAndIndexConnections(did, liAt, jsessionid, request.log).catch(
        (err) => {
          request.log.error(
            { did, msg: err?.message || String(err) },
            "[oauth:linkedin/cookies] background scrape threw",
          );
        },
      );

      // Return the real connection count when we have one. The extension
      // shows "Synced N connections" when connections_synced is a number,
      // and "Sync queued" when it's null/absent.
      const response = { ok: true };
      if (connectionsCount !== null) {
        response.connections_synced = connectionsCount;
      }
      return response;
    },
  );

  app.delete(
    "/v1/oauth/linkedin",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const did = request.privyUser?.userId;
      if (!did) {
        return reply
          .code(401)
          .send({ error: "unauthorized", code: "missing_user" });
      }
      let revokeResult = { ok: true, skipped: true };
      try {
        const accessToken = await getSecret(did, "LINKEDIN_OAUTH_ACCESS");
        if (accessToken) {
          revokeResult = await revokeToken(accessToken);
        }
      } catch (err) {
        request.log.warn(
          { msg: err.message },
          "[oauth:linkedin] revoke best-effort failed",
        );
        revokeResult = { ok: false, error: err.message };
      }
      try {
        await deleteSecrets(did, LINKEDIN_SECRET_KEYS);
      } catch (err) {
        request.log.error(
          { msg: err.message },
          "[oauth:linkedin] delete secrets failed",
        );
        return reply
          .code(500)
          .send({ error: "disconnect_failed", message: err.message });
      }
      return { ok: true, revoked: revokeResult };
    },
  );
}
