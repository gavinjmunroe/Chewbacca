/**
 * Shared Google OAuth2 helper for Gmail, Drive, Docs, Sheets, GCal.
 *
 * Reads per-tenant secrets:
 *   <SERVICE>_OAUTH_REFRESH    — refresh token (durable)
 *   <SERVICE>_OAUTH_ACCESS     — current access token (cache)
 *   <SERVICE>_OAUTH_EXPIRES_AT — ISO 8601 expiry of access token; matches
 *                                medha-id's OAuth callback write format.
 *                                <SERVICE>_OAUTH_EXPIRES (unix-ms string)
 *                                is still read as a legacy fallback so
 *                                tokens this helper refreshed before the
 *                                alignment keep working.
 *
 * Falls back to GCAL_OAUTH_* when no service-specific secrets exist,
 * since Calendar OAuth is often granted with broad Google scopes.
 *
 * Org-level client credentials come from env:
 *   GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
 */

import { getSecret } from "../secrets.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

// Seconds before expiry to proactively refresh
const REFRESH_BUFFER_SEC = 120;

/**
 * Parse an expires value that may be either an ISO 8601 string
 * (medha-id/callback format) or a unix-ms number-as-string (this helper's
 * pre-alignment write format). Returns 0 on anything unparseable so the
 * cached-token check falls through to a refresh.
 */
function parseExpiresMs(value) {
  if (!value || typeof value !== "string") return 0;
  const trimmed = value.trim();
  if (!trimmed) return 0;
  if (/^\d+$/.test(trimmed)) {
    const ms = Number(trimmed);
    return Number.isFinite(ms) ? ms : 0;
  }
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Returns a valid access token for the given service.
 *
 * @param {object} tenant  - tenant object with .did
 * @param {string} service - one of 'gmail','drive','docs','sheets','gcal' or null
 * @returns {Promise<string>} access token
 */
export async function getGoogleAccessToken(tenant, service = null) {
  const prefix = service ? service.toUpperCase() : "GCAL";

  // Resolve refresh token — service-specific first, then GCAL fallback
  const refreshToken = await resolveSecret(tenant, prefix, "OAUTH_REFRESH");
  if (!refreshToken) {
    const err = new Error(
      `No Google refresh token found for service=${service ?? "gcal"}. ` +
        `Store ${prefix}_OAUTH_REFRESH (or GCAL_OAUTH_REFRESH) in tenant secrets.`,
    );
    err.code = "missing-credentials";
    throw err;
  }

  // Check cached access token. Prefer the new EXPIRES_AT key (matches
  // medha-id's OAuth callback), fall back to the legacy EXPIRES key that
  // this helper used to write before the alignment.
  const [cachedAccess, cachedExpiresAt, legacyExpires] = await Promise.all([
    resolveSecret(tenant, prefix, "OAUTH_ACCESS"),
    resolveSecret(tenant, prefix, "OAUTH_EXPIRES_AT"),
    resolveSecret(tenant, prefix, "OAUTH_EXPIRES"),
  ]);

  const nowSec = Date.now() / 1000;
  const expiresMs =
    parseExpiresMs(cachedExpiresAt) || parseExpiresMs(legacyExpires);
  const expiresSec = expiresMs / 1000;

  if (cachedAccess && expiresSec - nowSec > REFRESH_BUFFER_SEC) {
    return cachedAccess;
  }

  // Refresh
  const clientId =
    process.env.GOOGLE_CLIENT_ID ?? process.env.GCAL_CLIENT_ID ?? "";
  const clientSecret =
    process.env.GOOGLE_CLIENT_SECRET ?? process.env.GCAL_CLIENT_SECRET ?? "";

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
      `Google token refresh failed (${res.status}): ${text}`,
    );
    err.code = "refresh-failed";
    throw err;
  }

  const data = await res.json();
  const newAccess = data.access_token;
  const newExpiresMs = Date.now() + (data.expires_in ?? 3600) * 1000;

  // Fire-and-forget cache update (non-blocking; best-effort)
  cacheTokens(tenant, prefix, newAccess, newExpiresMs).catch(() => {});

  return newAccess;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Try service-specific secret key; fall back to GCAL variant.
 */
async function resolveSecret(tenant, prefix, suffix) {
  const key = `${prefix}_${suffix}`;
  const val = await getSecret(tenant, key).catch(() => null);
  if (val) return val;

  // Fall back to GCAL if the prefix isn't already GCAL
  if (prefix !== "GCAL") {
    return getSecret(tenant, `GCAL_${suffix}`).catch(() => null);
  }
  return null;
}

/**
 * Persist refreshed tokens back to amber-id secrets (best-effort). Writes
 * the ISO-formatted EXPIRES_AT key so the bag stays consistent with
 * medha-id's OAuth callback; the legacy unix-ms EXPIRES key drains as
 * access tokens cycle.
 */
async function cacheTokens(tenant, prefix, access, expiresMs) {
  const did = tenant?.did;
  if (!did) return;

  const apiKey = process.env.AMBER_ID_API_KEY ?? "";
  const base = "https://amber-id-production.up.railway.app/v1/secrets";
  const enc = encodeURIComponent(did);
  const expiresAtIso = new Date(expiresMs).toISOString();

  await Promise.all([
    fetch(`${base}/${enc}/${prefix}_OAUTH_ACCESS`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({ value: access }),
    }),
    fetch(`${base}/${enc}/${prefix}_OAUTH_EXPIRES_AT`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({ value: expiresAtIso }),
    }),
  ]);
}
