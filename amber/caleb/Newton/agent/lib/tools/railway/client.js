/**
 * railway/client.js — Railway GraphQL client backed by per-tenant OAuth.
 *
 * Auth model (OAuth 2.0 + PKCE):
 *   1. User runs the /connect flow at medha-frontend; medha-id's
 *      /v1/oauth/railway/init redirects them to Railway, which
 *      redirects back to /v1/oauth/railway/callback after consent.
 *   2. The callback exchanges the code (with the PKCE verifier) for
 *      an access_token + refresh_token + id_token bundle, persisted
 *      into the secrets bag as RAILWAY_OAUTH_*.
 *   3. This client reads RAILWAY_OAUTH_REFRESH on every call, lazily
 *      refreshes the access token when it's close to expiring, and
 *      writes the new access_token + expires_at back to amber-id so
 *      every agent instance picks them up on the next request.
 *
 * Access tokens last ~1 hour; refresh tokens are long-lived (granted
 * via offline_access scope). Per CLAUDE.md, we never fall back to env
 * for per-user state. If the tenant has no refresh token, callers get
 * a NOT_CONNECTED payload the agent surfaces verbatim.
 */

import { getSecret } from "../../secrets.js";
import { AMBER_ID_API_URL, AMBER_ID_API_KEY } from "../../constants.js";

const RAILWAY_GRAPHQL = "https://backboard.railway.com/graphql/v2";
const RAILWAY_TOKEN_URL = "https://backboard.railway.com/oauth/token";

// Refresh the access token if it expires within this many ms. 5 min is
// enough cushion that an in-flight request won't 401 mid-flight.
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

function frontendBase() {
  const raw = process.env.MEDHA_FRONTEND_URL || "";
  if (raw) return raw.replace(/\/+$/, "");
  return "https://www.justarock.ai";
}

export function connectPageUrl() {
  return `${frontendBase()}/connect`;
}

export function buildNotConnected() {
  const url = connectPageUrl();
  return {
    error: "railway_not_connected",
    suggestConnect: true,
    connect_url: url,
    message: `Railway isn't connected to your medha-id yet. Connect it here and ask me again: ${url}`,
  };
}

function tenantDid(tenant) {
  if (!tenant) return null;
  if (typeof tenant === "string") return tenant;
  return tenant.privyDid || tenant.amberId || tenant.id || null;
}

/**
 * Write a refreshed token back to amber-id so every agent instance
 * picks it up. Best-effort: a write failure does not block the
 * current request (the access token in memory is still valid for the
 * remainder of its hour).
 */
async function setSecret(tenant, key, value) {
  const did = tenantDid(tenant);
  if (!did || !AMBER_ID_API_URL || !AMBER_ID_API_KEY) return;
  try {
    await fetch(
      `${AMBER_ID_API_URL}/v1/secrets/${encodeURIComponent(did)}/${encodeURIComponent(key)}`,
      {
        method: "PUT",
        headers: {
          "x-api-key": AMBER_ID_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ value }),
        signal: AbortSignal.timeout(5000),
      },
    );
  } catch (err) {
    console.warn(`[railway] setSecret ${key} failed:`, err?.message);
  }
}

/**
 * Resolve client_id + client_secret. Unlike per-tenant Google (which
 * lets each tenant bring their own client app), Railway is a
 * single-org-level OAuth app; both creds live in env on
 * medha-platform. Set with `railway variables --service
 * medha-platform --set RAILWAY_OAUTH_CLIENT_ID=... --set
 * RAILWAY_OAUTH_CLIENT_SECRET=...`.
 */
function getClientCreds() {
  const clientId = process.env.RAILWAY_OAUTH_CLIENT_ID;
  const clientSecret = process.env.RAILWAY_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "missing-credentials: RAILWAY_OAUTH_CLIENT_ID + " +
        "RAILWAY_OAUTH_CLIENT_SECRET must be set on medha-platform",
    );
  }
  return { clientId, clientSecret };
}

/**
 * Refresh the access token using the per-tenant refresh token and the
 * org-level OAuth client credentials. Writes the new access token +
 * expires_at back to the bag so concurrent agent instances see them.
 * Returns the new access token, or null if the refresh fails (e.g.
 * the user revoked the connection on Railway's side).
 */
async function refreshAccessToken(tenant, refreshToken) {
  let creds;
  try {
    creds = getClientCreds();
  } catch (err) {
    console.warn("[railway] refresh skipped:", err.message);
    return null;
  }

  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString(
    "base64",
  );
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  let json;
  try {
    const res = await fetch(RAILWAY_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
        Accept: "application/json",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("[railway] refresh failed:", res.status, text.slice(0, 200));
      return null;
    }
    json = await res.json();
  } catch (err) {
    console.warn("[railway] refresh threw:", err?.message);
    return null;
  }

  if (!json?.access_token) return null;

  const expiresInSec = Number(json.expires_in);
  const expiresAt =
    Number.isFinite(expiresInSec) && expiresInSec > 0
      ? new Date(Date.now() + expiresInSec * 1000).toISOString()
      : null;

  // Persist the new access token + expiry. If Railway rotated the
  // refresh token (the spec allows it), persist the new one too.
  await Promise.all([
    setSecret(tenant, "RAILWAY_OAUTH_ACCESS", json.access_token),
    expiresAt
      ? setSecret(tenant, "RAILWAY_OAUTH_EXPIRES_AT", expiresAt)
      : Promise.resolve(),
    json.refresh_token && json.refresh_token !== refreshToken
      ? setSecret(tenant, "RAILWAY_OAUTH_REFRESH", json.refresh_token)
      : Promise.resolve(),
  ]);

  return json.access_token;
}

/**
 * Resolve a fresh access token for a tenant. Reads the cached access
 * token first, refreshes when within REFRESH_BUFFER_MS of expiry.
 * Returns { token, email } when present; null when not connected.
 *
 * Access-only fallback: Railway's OAuth app currently drops the
 * offline_access scope from the granted set even when init.js
 * requests it, so refresh_token is null in the bag. If the cached
 * access token is still valid we use it directly. Once Railway's
 * OAuth app is reconfigured to actually grant offline_access, the
 * normal refresh path takes over and this branch goes quiet.
 */
export async function resolveRailwayAuth(tenant) {
  if (!tenant) return null;

  const [refresh, cachedAccess, expiresAt, email] = await Promise.all([
    getSecret(tenant, "RAILWAY_OAUTH_REFRESH").catch(() => null),
    getSecret(tenant, "RAILWAY_OAUTH_ACCESS").catch(() => null),
    getSecret(tenant, "RAILWAY_OAUTH_EXPIRES_AT").catch(() => null),
    getSecret(tenant, "RAILWAY_OAUTH_ACCOUNT_EMAIL").catch(() => null),
  ]);

  const expiresAtMs = expiresAt ? Date.parse(expiresAt) : 0;
  const accessStillValid =
    cachedAccess && expiresAtMs > Date.now() + REFRESH_BUFFER_MS;

  if (accessStillValid) {
    return { token: cachedAccess, email: email || null };
  }

  if (refresh) {
    const fresh = await refreshAccessToken(tenant, refresh);
    if (fresh) return { token: fresh, email: email || null };
  }

  return null;
}

/**
 * Run a Railway GraphQL operation on behalf of a tenant. Throws a
 * `railway_not_connected` error (with the NOT_CONNECTED payload
 * attached) when the tenant has no refresh token or the refresh
 * fails. Other errors surface Railway's GraphQL `errors` array on
 * `err.railwayErrors`.
 */
export async function railwayQuery(
  tenant,
  query,
  variables = {},
  { operationName, timeoutMs = 20_000 } = {},
) {
  const auth = await resolveRailwayAuth(tenant);
  if (!auth) {
    const notConnected = buildNotConnected();
    const err = new Error(notConnected.message);
    err.code = "railway_not_connected";
    err.notConnected = notConnected;
    throw err;
  }

  const res = await fetch(RAILWAY_GRAPHQL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables,
      ...(operationName ? { operationName } : {}),
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(
      `railway_api_${res.status}:${text.slice(0, 200) || "unknown"}`,
    );
    err.code = `railway_api_${res.status}`;
    err.status = res.status;
    throw err;
  }

  const body = await res.json().catch(() => ({}));

  if (Array.isArray(body.errors) && body.errors.length > 0) {
    const first = body.errors[0];
    const err = new Error(`railway_graphql:${first?.message || "unknown"}`);
    err.code = "railway_graphql";
    err.railwayErrors = body.errors;
    throw err;
  }

  return body.data;
}

export const __test__ = { RAILWAY_GRAPHQL, RAILWAY_TOKEN_URL, frontendBase };
