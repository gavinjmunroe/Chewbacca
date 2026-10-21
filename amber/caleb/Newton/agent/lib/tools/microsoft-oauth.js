/**
 * Shared Microsoft OAuth2 helper for Outlook, MS Calendar, OneDrive, Teams.
 *
 * Reads per-tenant secrets:
 *   <SERVICE>_OAUTH_REFRESH  refresh token (durable)
 *   <SERVICE>_OAUTH_ACCESS   current access token (cache)
 *   <SERVICE>_OAUTH_EXPIRES  epoch-ms expiry of access token
 *
 * Falls back to MS_OAUTH_* when no service-specific secret exists. medha-id's
 * /v1/oauth/microsoft/callback writes a single MS_OAUTH_REFRESH per user; the
 * service-prefixed keys exist so a future per-surface disconnect can override
 * a specific tool's view of the connection without dropping the others.
 *
 * Org-level client credentials come from env:
 *   MS_OAUTH_CLIENT_ID / MS_OAUTH_CLIENT_SECRET
 */

import { getSecret } from "../secrets.js";

const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

// Seconds before expiry to proactively refresh.
const REFRESH_BUFFER_SEC = 120;

/**
 * Returns a valid access token for the given Microsoft Graph surface.
 *
 * @param {object} tenant   tenant object with a Privy DID, person_id, or phone
 *                          (identity bridge in secrets.js handles the lookup).
 * @param {string} service  one of 'outlook' | 'mscal' | 'onedrive' | 'teams',
 *                          or null to read straight from MS_OAUTH_*.
 * @returns {Promise<string>} access token
 */
export async function getMicrosoftAccessToken(tenant, service = null) {
  const prefix = service ? service.toUpperCase() : "MS";

  const refreshToken = await resolveSecret(tenant, prefix, "OAUTH_REFRESH");
  if (!refreshToken) {
    const err = new Error(
      `No Microsoft refresh token found for service=${service ?? "ms"}. ` +
        `Store ${prefix}_OAUTH_REFRESH (or MS_OAUTH_REFRESH) in tenant secrets.`,
    );
    err.code = "missing-credentials";
    throw err;
  }

  const [cachedAccess, cachedExpires] = await Promise.all([
    resolveSecret(tenant, prefix, "OAUTH_ACCESS"),
    resolveSecret(tenant, prefix, "OAUTH_EXPIRES"),
  ]);

  const nowSec = Date.now() / 1000;
  const expiresSec = cachedExpires ? Number(cachedExpires) / 1000 : 0;

  if (cachedAccess && expiresSec - nowSec > REFRESH_BUFFER_SEC) {
    return cachedAccess;
  }

  const clientId =
    process.env.MS_OAUTH_CLIENT_ID ?? process.env.MICROSOFT_CLIENT_ID ?? "";
  const clientSecret =
    process.env.MS_OAUTH_CLIENT_SECRET ??
    process.env.MICROSOFT_CLIENT_SECRET ??
    "";

  if (!clientId || !clientSecret) {
    const err = new Error(
      "Missing Microsoft OAuth client credentials. Set MS_OAUTH_CLIENT_ID + " +
        "MS_OAUTH_CLIENT_SECRET on the medha-platform service.",
    );
    err.code = "missing-credentials";
    throw err;
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(
      `Microsoft token refresh failed (${res.status}): ${text}`,
    );
    err.code = "refresh-failed";
    throw err;
  }

  const data = await res.json();
  const newAccess = data.access_token;
  if (!newAccess) {
    const err = new Error("Microsoft token refresh returned no access_token");
    err.code = "refresh-failed";
    throw err;
  }
  const newExpires = Date.now() + (data.expires_in ?? 3600) * 1000;

  cacheTokens(tenant, prefix, newAccess, newExpires).catch(() => {});

  return newAccess;
}

/**
 * Service-specific secret first, fall back to the shared MS_ namespace.
 */
async function resolveSecret(tenant, prefix, suffix) {
  const key = `${prefix}_${suffix}`;
  const val = await getSecret(tenant, key).catch(() => null);
  if (val) return val;
  if (prefix !== "MS") {
    return getSecret(tenant, `MS_${suffix}`).catch(() => null);
  }
  return null;
}

/**
 * Persist the refreshed access token + expiry back to medha-id so every
 * agent replica picks up the fresh value on its next request. Writes go to
 * the SHARED MS_ namespace so all four surfaces see the same cached token;
 * otherwise four parallel refreshes would race after each Graph 401.
 */
async function cacheTokens(tenant, prefix, access, expiresMs) {
  void prefix;
  const did = tenant?.privyDid || tenant?.amberId || tenant?.id || tenant?.did;
  if (!did) return;

  const apiKey = process.env.AMBER_ID_API_KEY ?? "";
  if (!apiKey) return;
  const base = "https://amber-id-production.up.railway.app/v1/secrets";
  const enc = encodeURIComponent(did);

  await Promise.all([
    fetch(`${base}/${enc}/MS_OAUTH_ACCESS`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ value: access }),
    }),
    fetch(`${base}/${enc}/MS_OAUTH_EXPIRES`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ value: String(expiresMs) }),
    }),
  ]);
}
