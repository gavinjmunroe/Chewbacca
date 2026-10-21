/**
 * Connection-status surface for the medha-frontend /connect page.
 *
 *   GET /v1/me/connections   Privy/amber-id JWT required. Returns one row per
 *                            supported platform with whether it is connected,
 *                            the granted scopes, and any OAuth-health error.
 *
 * Per-platform "connected" state is derived from the per-tenant secrets bag
 * (Firestore `secrets/{did}.keys`). Each OAuth tab in Phase 1 writes a
 * canonical presence key on successful callback. Health metadata
 * (`last_verified_at`, `error`) is read from the `oauth_health` collection
 * that the Wave-2 health-monitor cron populates; if the collection or doc
 * is missing the fields surface as null (not an error).
 *
 * This handler NEVER returns refresh or access tokens. It only echoes the
 * scope list, which is non-sensitive (OAuth scopes are public identifiers).
 *
 * NOTE for the EDIT_AFTER batch: mount with
 *
 *     import { registerConnectionsRoutes } from "./routes/connections.js";
 *     registerConnectionsRoutes(app);
 *
 * after Tabs 1.2 through 1.7 have landed their OAuth routes.
 */

import { requireAuth } from "../lib/auth-session.js";
import { getSecrets, setSecrets } from "../db/secrets.js";
import { collectionName } from "../lib/instance.js";
import { configCheck } from "../oauth/lib/env-check.js";

const HEALTH_COL = "oauth_health";

/**
 * Catalog of platforms surfaced on the /connect page.
 *
 * `presenceKey` is the secrets-bag key whose presence (non-null value) means
 * "connected". Each OAuth tab MUST write this key on a successful callback.
 * If you change a key name in your tab, update this row in the same PR.
 *
 * `scopesKey` is the secrets-bag key holding the space-separated scope list
 * returned by the provider. Null if the platform does not expose a scope list.
 */
const PLATFORMS = [
  {
    id: "google",
    presenceKey: "GCAL_OAUTH_REFRESH",
    scopesKey: "GCAL_OAUTH_SCOPES",
    // Set by the callback after decoding the id_token. Used by the frontend
    // to render "Connected as foo@gmail.com" and by the agent to identify
    // which Google identity is bound to this medha-id.
    accountKey: "GOOGLE_OAUTH_ACCOUNT_EMAIL",
  },
  {
    id: "linkedin",
    presenceKey: "LINKEDIN_OAUTH_REFRESH",
    scopesKey: "LINKEDIN_OAUTH_SCOPES",
    accountKey: "LINKEDIN_OAUTH_ACCOUNT_HANDLE",
  },
  {
    id: "slack",
    // Per-user xoxp token. A legacy admin-only install (only
    // SLACK_WORKSPACE_TOKEN populated) reads as disconnected so the
    // /connect page nudges the user to re-consent and capture their
    // own xoxp — that's what enables agent-acting-as-user actions.
    presenceKey: "SLACK_USER_TOKEN",
    scopesKey: "SLACK_USER_TOKEN_SCOPES",
    // Composed at callback time as "<user real_name> (<workspace name>)".
    accountKey: "SLACK_USER_ACCOUNT_NAME",
  },
  {
    id: "notion",
    presenceKey: "NOTION_OAUTH_ACCESS",
    scopesKey: "NOTION_OAUTH_SCOPES",
    accountKey: "NOTION_OAUTH_WORKSPACE_NAME",
  },
  {
    id: "microsoft",
    presenceKey: "MS_OAUTH_REFRESH",
    scopesKey: "MS_OAUTH_SCOPES",
    accountKey: "MS_OAUTH_ACCOUNT_EMAIL",
  },
  {
    id: "twitter",
    presenceKey: "TWITTER_OAUTH_REFRESH",
    scopesKey: "TWITTER_OAUTH_SCOPES",
    accountKey: "TWITTER_OAUTH_HANDLE",
  },
  {
    id: "github",
    // GitHub Classic OAuth Apps with non-expiring tokens have no refresh
    // token, so presence is keyed off the access token itself.
    presenceKey: "GITHUB_OAUTH_ACCESS",
    scopesKey: "GITHUB_OAUTH_SCOPES",
    accountKey: "GITHUB_OAUTH_ACCOUNT_HANDLE",
  },
  {
    id: "railway",
    // OAuth 2.0 + PKCE flow. Presence keyed on ACCESS rather than
    // REFRESH because Railway's OAuth app currently drops the
    // offline_access scope from the granted set even when requested,
    // so no refresh_token is returned. Using ACCESS makes the /connect
    // card reflect reality (the user just consented and has a working
    // ~1h token). Once offline_access is fixed on the Railway OAuth
    // app side, the agent client will start picking up REFRESH and
    // keep the access token alive without re-prompting.
    presenceKey: "RAILWAY_OAUTH_ACCESS",
    scopesKey: "RAILWAY_OAUTH_SCOPES",
    accountKey: "RAILWAY_OAUTH_ACCOUNT_EMAIL",
  },
];

/**
 * Per-platform required-scope groups. When a user is connected but their
 * granted scope list misses one of these, /connect shows a 'Reconnect for
 * full access' banner driven by needs_scope_upgrade in the response.
 *
 * Each group is satisfied by anyOf scopes. If the user has neither anyOf
 * nor the narrow_alternative, they're a fresh connection that the current
 * init flow already covers — no upgrade banner. Only when they have the
 * narrow alternative AND none of anyOf do we flag the platform.
 */
const REQUIRED_SCOPE_GROUPS = {
  google: [
    {
      label: "full Drive access",
      anyOf: ["https://www.googleapis.com/auth/drive"],
      narrow_alternative: "https://www.googleapis.com/auth/drive.file",
    },
    {
      label: "Gmail send + modify",
      anyOf: ["https://www.googleapis.com/auth/gmail.modify"],
      narrow_alternative: "https://www.googleapis.com/auth/gmail.readonly",
    },
  ],
};

function computeScopeUpgrade(platformId, scopes) {
  const groups = REQUIRED_SCOPE_GROUPS[platformId];
  if (!Array.isArray(groups) || groups.length === 0) {
    return { needs_scope_upgrade: false, missing_required_scopes: [] };
  }
  const granted = new Set(scopes);
  const missing = [];
  for (const g of groups) {
    if (g.anyOf.some((s) => granted.has(s))) continue;
    if (granted.has(g.narrow_alternative)) {
      missing.push({ label: g.label, scopes_needed: g.anyOf });
    }
  }
  return {
    needs_scope_upgrade: missing.length > 0,
    missing_required_scopes: missing,
  };
}

/**
 * Split an OAuth scope blob into an array. Providers return scopes as a
 * space-separated string (Google, LinkedIn, Microsoft, Twitter) or
 * comma-separated (Slack bot scopes). We accept either and strip empties.
 * Returns [] for a missing or unparseable value so the response shape stays
 * stable.
 */
function parseScopes(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw !== "string") return [];
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * WAS: batch-read oauth_health docs out of Firestore.
 *
 * The health collection recorded the last verification error per platform, and
 * the read was already fail-soft -- any error returned {} so a health outage
 * could never block /connect from rendering. Firestore is gone, so it returns {}
 * unconditionally and /connect renders exactly as it did on the failure path it
 * always tolerated. When per-platform health is worth having again it belongs in
 * a table beside `connections`, not in a second datastore.
 */
async function readHealth() {
  return {};
}

/**
 * Self-healing email backfill for users who connected Google BEFORE the
 * callback started decoding id_token (PR #83). When connections.account
 * is empty but a Google refresh token exists, exchange the refresh token
 * for a fresh access token and call Google's userinfo endpoint to read
 * the verified email. Persist as GOOGLE_OAUTH_ACCOUNT_EMAIL so subsequent
 * reads are zero-network. Best-effort: any failure falls through and
 * leaves account=null (the UI just doesn't show the email pill).
 */
async function backfillGoogleEmail(did, bag) {
  const refresh = bag.GCAL_OAUTH_REFRESH;
  if (!refresh) return null;
  if (bag.GOOGLE_OAUTH_ACCOUNT_EMAIL) return bag.GOOGLE_OAUTH_ACCOUNT_EMAIL;

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refresh,
        grant_type: "refresh_token",
      }).toString(),
      signal: AbortSignal.timeout(
        Number(process.env.OAUTH_BACKFILL_TIMEOUT_MS) || 10000,
      ),
    });
    if (!tokenRes.ok) return null;
    const { access_token } = await tokenRes.json();
    if (!access_token) return null;

    const userRes = await fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      {
        headers: { Authorization: `Bearer ${access_token}` },
        signal: AbortSignal.timeout(
          Number(process.env.OAUTH_BACKFILL_TIMEOUT_MS) || 10000,
        ),
      },
    );
    if (!userRes.ok) return null;
    const profile = await userRes.json();
    if (profile.email_verified === false) return null;
    const email = typeof profile.email === "string" ? profile.email : null;
    if (!email) return null;

    // Persist for next read; mirror the same key the callback would have set.
    await setSecrets(
      did,
      {
        GOOGLE_OAUTH_ACCOUNT_EMAIL: email,
        GCAL_OAUTH_ACCOUNT_EMAIL: email,
        GMAIL_OAUTH_ACCOUNT_EMAIL: email,
        GDRIVE_OAUTH_ACCOUNT_EMAIL: email,
      },
      { updatedBy: "connections-backfill" },
    ).catch((err) =>
      console.warn(
        "[connections] email backfill setSecrets failed:",
        err.message,
      ),
    );

    bag.GOOGLE_OAUTH_ACCOUNT_EMAIL = email;
    bag.GCAL_OAUTH_ACCOUNT_EMAIL = email;
    bag.GMAIL_OAUTH_ACCOUNT_EMAIL = email;
    bag.GDRIVE_OAUTH_ACCOUNT_EMAIL = email;
    return email;
  } catch (err) {
    console.warn("[connections] google email backfill failed:", err.message);
    return null;
  }
}

/**
 * Self-healing handle backfill for users who connected Twitter BEFORE the
 * callback started fetching /2/users/me. When connections.account is empty
 * but a Twitter refresh token exists, refresh to a fresh access token and
 * call /2/users/me to read the @handle. Persist as TWITTER_OAUTH_HANDLE
 * so subsequent reads are zero-network. Best-effort: any failure falls
 * through and leaves account=null.
 */
async function backfillTwitterHandle(did, bag) {
  const refresh = bag.TWITTER_OAUTH_REFRESH;
  if (!refresh) return null;
  if (bag.TWITTER_OAUTH_HANDLE) return bag.TWITTER_OAUTH_HANDLE;

  const clientId = process.env.TWITTER_OAUTH_CLIENT_ID;
  const clientSecret = process.env.TWITTER_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  try {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
      "base64",
    );
    const tokenRes = await fetch("https://api.x.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refresh,
        client_id: clientId,
      }).toString(),
      signal: AbortSignal.timeout(
        Number(process.env.OAUTH_BACKFILL_TIMEOUT_MS) || 10000,
      ),
    });
    if (!tokenRes.ok) return null;
    const tokenJson = await tokenRes.json();
    const accessToken = tokenJson?.access_token;
    if (!accessToken) return null;

    const meRes = await fetch("https://api.x.com/2/users/me", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(
        Number(process.env.OAUTH_BACKFILL_TIMEOUT_MS) || 10000,
      ),
    });
    if (!meRes.ok) return null;
    const meJson = await meRes.json().catch(() => null);
    const data = meJson?.data;
    const username = typeof data?.username === "string" ? data.username : null;
    const userId = typeof data?.id === "string" ? data.id : null;
    if (!username) return null;
    const handle = `@${username}`;

    // Token rotation: X may return a new refresh_token on refresh. If it did,
    // persist it alongside the freshly cached access token so the next call
    // doesn't 400 on a rotated/revoked old refresh.
    const persist = {
      TWITTER_OAUTH_HANDLE: handle,
      TWITTER_OAUTH_USER_ID: userId,
      TWITTER_OAUTH_ACCESS: accessToken,
    };
    if (
      Number.isFinite(Number(tokenJson.expires_in)) &&
      tokenJson.expires_in > 0
    ) {
      persist.TWITTER_OAUTH_EXPIRES_AT = new Date(
        Date.now() + tokenJson.expires_in * 1000,
      ).toISOString();
    }
    if (tokenJson.refresh_token && tokenJson.refresh_token !== refresh) {
      persist.TWITTER_OAUTH_REFRESH = tokenJson.refresh_token;
    }

    await setSecrets(did, persist, { updatedBy: "connections-backfill" }).catch(
      (err) =>
        console.warn(
          "[connections] twitter handle backfill setSecrets failed:",
          err.message,
        ),
    );

    bag.TWITTER_OAUTH_HANDLE = handle;
    bag.TWITTER_OAUTH_USER_ID = userId;
    bag.TWITTER_OAUTH_ACCESS = accessToken;
    if (persist.TWITTER_OAUTH_REFRESH) {
      bag.TWITTER_OAUTH_REFRESH = persist.TWITTER_OAUTH_REFRESH;
    }
    return handle;
  } catch (err) {
    console.warn("[connections] twitter handle backfill failed:", err.message);
    return null;
  }
}

export function registerConnectionsRoutes(app) {
  app.get(
    "/v1/me/connections",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const did = request.privyUser?.userId;
      if (!did) {
        return reply
          .code(401)
          .send({ error: "no_user", message: "Auth required" });
      }

      let bag = {};
      try {
        bag = await getSecrets(did);
      } catch (err) {
        // A new user has no secrets doc — that's expected, not an error.
        // Anything else: surface as an empty bag so every platform reports
        // disconnected rather than 500ing the whole /connect page.
        console.warn("[connections] getSecrets failed:", err.message);
      }

      // Self-healing for pre-#83 Google connections that have a refresh
      // token but no account email. One-shot Google userinfo call, then
      // cached forever. Doesn't block the response if it fails.
      await backfillGoogleEmail(did, bag);
      // Same pattern for Twitter: pre-handle-fetch connections backfill
      // their @handle on the next /connect page load.
      await backfillTwitterHandle(did, bag);

      const health = await readHealth(did);

      const platforms = PLATFORMS.map((p) => {
        const connected = bag[p.presenceKey] != null;
        const scopes = connected ? parseScopes(bag[p.scopesKey]) : [];
        const h = health[p.id] || {};
        const cfg = configCheck(p.id);
        const account =
          connected && p.accountKey ? bag[p.accountKey] || null : null;
        // Scope-upgrade detection (P1-H). Existing connected users still
        // hold the OLD narrower scopes (drive.file / gmail.readonly).
        // The /init flow now requests the broader scopes (full drive,
        // gmail.modify) but tokens issued before that don't auto-upgrade
        // — the user has to reconnect. needs_scope_upgrade lets /connect
        // surface a 'Reconnect for full access' nudge per platform
        // instead of silently letting tool calls return empty results.
        const upgrade = connected
          ? computeScopeUpgrade(p.id, scopes)
          : { needs_scope_upgrade: false, missing_required_scopes: [] };
        return {
          platform: p.id,
          configured: cfg.configured,
          missing_config: cfg.missing_config,
          connected,
          // Human-readable identifier for the connected account (e.g.,
          // foo@gmail.com for Google, workspace name for Slack/Notion).
          // Drives the "Connected as <account>" line on /connect and the
          // agent's "you signed in as <account>" recall.
          account,
          scopes,
          needs_scope_upgrade: upgrade.needs_scope_upgrade,
          missing_required_scopes: upgrade.missing_required_scopes,
          connected_at: h.connected_at || null,
          last_verified_at: h.last_verified_at || null,
          error: h.error || null,
        };
      });

      return { platforms };
    },
  );
}
