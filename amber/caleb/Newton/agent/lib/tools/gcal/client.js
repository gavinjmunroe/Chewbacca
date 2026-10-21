/**
 * gcal/client.js — Google Calendar REST API client with OAuth2 token management.
 *
 * Token lifecycle:
 *   - access token stored as GCAL_OAUTH_ACCESS
 *   - expiry stored as GCAL_OAUTH_EXPIRES_AT (ISO 8601 string; matches the
 *     key + format that medha-id's OAuth callback writes). For backward
 *     compatibility with tokens this agent refreshed before the alignment,
 *     the legacy GCAL_OAUTH_EXPIRES (unix ms string) is still read as a
 *     fallback. Writes only land on GCAL_OAUTH_EXPIRES_AT going forward,
 *     so the legacy key naturally drains as access tokens cycle.
 *   - refresh token stored as GCAL_OAUTH_REFRESH (never expires)
 *   - client_id/secret from per-tenant GCAL_OAUTH_CLIENT_ID / GCAL_OAUTH_CLIENT_SECRET,
 *     falling back to org-level env vars. We try the canonical GCAL_* env
 *     names first (the deployed Railway convention), then the legacy
 *     GOOGLE_* names. Both are listed so the resolver can find whichever
 *     the operator set without needing to know which alias is current.
 *
 * All writes go back to amber-id via setSecret() so every agent instance
 * picks up the refreshed tokens on its next request.
 */

import { getSecret } from "../../secrets.js";
import { AMBER_ID_API_URL, AMBER_ID_API_KEY } from "../../constants.js";

const GCAL_BASE = "https://www.googleapis.com/calendar/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

// How many ms before expiry we proactively refresh (5 minutes)
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

// ── Secret helpers ────────────────────────────────────────────────────────────

function tenantDid(tenant) {
  if (!tenant) return null;
  if (typeof tenant === "string") return tenant;
  return tenant.privyDid || tenant.amberId || tenant.id || null;
}

/**
 * Write a secret back to amber-id for the given tenant.
 * Best-effort: logs on failure but never throws.
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
    console.warn(`[gcal] setSecret ${key} failed:`, err?.message);
  }
}

// ── Credential resolution ────────────────────────────────────────────────────

async function getClientCreds(tenant) {
  const [clientId, clientSecret] = await Promise.all([
    getSecret(tenant, "GCAL_OAUTH_CLIENT_ID", {
      fallbackEnv: ["GCAL_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID"],
    }),
    getSecret(tenant, "GCAL_OAUTH_CLIENT_SECRET", {
      fallbackEnv: ["GCAL_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_CLIENT_SECRET"],
    }),
  ]);
  return { clientId, clientSecret };
}

// ── Token management ─────────────────────────────────────────────────────────

/**
 * Parse an expires value that may be either an ISO 8601 string
 * (medha-id/callback format) or a unix-ms number-as-string (this client's
 * pre-alignment write format). Returns 0 on anything unparseable so the
 * cached-token check falls through to a refresh.
 *
 * Exported for tests.
 */
export function parseExpiresMs(value) {
  if (!value) return 0;
  if (typeof value !== "string") return 0;
  const trimmed = value.trim();
  if (!trimmed) return 0;
  // Pure digits → legacy unix-ms format
  if (/^\d+$/.test(trimmed)) {
    const ms = Number(trimmed);
    return Number.isFinite(ms) ? ms : 0;
  }
  // Otherwise assume ISO 8601 — Date.parse returns NaN on garbage
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Returns { accessToken } after refreshing if needed.
 * Returns null if the tenant has no refresh token configured.
 */
export async function resolveAccessToken(tenant) {
  const refreshToken = await getSecret(tenant, "GCAL_OAUTH_REFRESH");
  if (!refreshToken) return null;

  // Check if cached token is still valid. Prefer the new EXPIRES_AT key
  // (matches medha-id's OAuth callback), fall back to the legacy EXPIRES
  // key that this client used to write before the alignment.
  const [cachedAccess, expiresAtStr, legacyExpiresStr] = await Promise.all([
    getSecret(tenant, "GCAL_OAUTH_ACCESS"),
    getSecret(tenant, "GCAL_OAUTH_EXPIRES_AT"),
    getSecret(tenant, "GCAL_OAUTH_EXPIRES"),
  ]);

  const expiresAt =
    parseExpiresMs(expiresAtStr) || parseExpiresMs(legacyExpiresStr);
  if (cachedAccess && expiresAt > Date.now() + REFRESH_BUFFER_MS) {
    return cachedAccess;
  }

  // Token missing or expiring — refresh
  return refreshAccessToken(tenant, refreshToken);
}

async function refreshAccessToken(tenant, refreshToken) {
  const { clientId, clientSecret } = await getClientCreds(tenant);
  if (!clientId || !clientSecret) {
    console.warn("[gcal] Missing OAuth client credentials for token refresh");
    return null;
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  let data;
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.warn("[gcal] Token refresh failed:", res.status, errText);
      return null;
    }
    data = await res.json();
  } catch (err) {
    console.warn("[gcal] Token refresh error:", err?.message);
    return null;
  }

  const { access_token, expires_in } = data;
  if (!access_token) return null;

  // Persist new token — fire-and-forget. Write the ISO-formatted EXPIRES_AT
  // key so the bag stays consistent with medha-id's OAuth callback and the
  // legacy EXPIRES key drains as access tokens cycle.
  const expiresAtIso = new Date(
    Date.now() + (expires_in ?? 3600) * 1000,
  ).toISOString();
  setSecret(tenant, "GCAL_OAUTH_ACCESS", access_token).catch(() => {});
  setSecret(tenant, "GCAL_OAUTH_EXPIRES_AT", expiresAtIso).catch(() => {});

  return access_token;
}

// ── Core HTTP client ─────────────────────────────────────────────────────────

/**
 * Make an authenticated request to the Google Calendar REST API.
 *
 * @param {object} opts
 * @param {object} opts.tenant
 * @param {string} opts.method  GET | POST | PUT | PATCH | DELETE
 * @param {string} opts.path    Relative path after GCAL_BASE (e.g. "/calendars/primary/events")
 * @param {object} [opts.query] URL query params
 * @param {object} [opts.body]  JSON request body
 * @returns {Promise<{ok: boolean, status: number, data: any, error?: string}>}
 */
export async function gcalRequest({ tenant, method, path, query, body }) {
  let accessToken;
  try {
    accessToken = await resolveAccessToken(tenant);
  } catch (err) {
    // Surface OAuth refresh failures (refresh token rejected, client creds
    // missing, network blip on the refresh round-trip) as the structured
    // calendar_oauth_required code so upstream handlers can render a
    // user-facing reconnect URL. Mirrors the missing-credentials throw
    // from lib/tools/google-oauth.js — both failure modes funnel here.
    throw Object.assign(new Error("calendar_oauth_required"), {
      code: "calendar_oauth_required",
      cause: err,
    });
  }

  if (!accessToken) {
    // resolveAccessToken returns null when the tenant has no refresh token
    // stored at all. Throw the same structured error so client callers can
    // distinguish "needs OAuth" from generic API failures. Upstream
    // provisioner / tools handlers translate this into a friendly
    // reconnect message.
    throw Object.assign(new Error("calendar_oauth_required"), {
      code: "calendar_oauth_required",
      cause: new Error("no refresh token for tenant"),
    });
  }

  let url = `${GCAL_BASE}${path}`;
  if (query && Object.keys(query).length > 0) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) params.set(k, String(v));
    }
    url += `?${params.toString()}`;
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return { ok: false, status: 0, data: null, error: err.message };
  }

  let data = null;
  if (res.status !== 204) {
    data = await res.json().catch(() => null);
  }

  if (!res.ok) {
    const errMsg = data?.error?.message || data?.error || `HTTP ${res.status}`;
    return { ok: false, status: res.status, data, error: errMsg };
  }

  return { ok: true, status: res.status, data };
}

// ── Calendar-specific helpers ────────────────────────────────────────────────

/** List all calendars the user has access to. */
export async function listCalendarList(tenant) {
  return gcalRequest({
    tenant,
    method: "GET",
    path: "/users/me/calendarList",
    query: { maxResults: 250 },
  });
}

/** Insert a new secondary calendar. */
export async function insertCalendar(tenant, summary) {
  return gcalRequest({
    tenant,
    method: "POST",
    path: "/calendars",
    body: { summary },
  });
}

/** List events on a calendar. */
export async function listEvents(tenant, calendarId, query = {}) {
  return gcalRequest({
    tenant,
    method: "GET",
    path: `/calendars/${encodeURIComponent(calendarId)}/events`,
    query,
  });
}

/** Get a single event. */
export async function getEvent(tenant, calendarId, eventId) {
  return gcalRequest({
    tenant,
    method: "GET",
    path: `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
  });
}

/** Insert an event on a calendar. */
export async function insertEvent(tenant, calendarId, eventBody) {
  return gcalRequest({
    tenant,
    method: "POST",
    path: `/calendars/${encodeURIComponent(calendarId)}/events`,
    body: eventBody,
  });
}

/** Patch an event (partial update). */
export async function patchEvent(tenant, calendarId, eventId, patch) {
  return gcalRequest({
    tenant,
    method: "PATCH",
    path: `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    body: patch,
  });
}

/** Delete an event. */
export async function deleteEvent(tenant, calendarId, eventId) {
  return gcalRequest({
    tenant,
    method: "DELETE",
    path: `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
  });
}

/** Query freebusy for a set of calendars over a time window. */
export async function queryFreebusy(tenant, calendarIds, timeMin, timeMax) {
  return gcalRequest({
    tenant,
    method: "POST",
    path: "/freeBusy",
    body: {
      timeMin,
      timeMax,
      items: calendarIds.map((id) => ({ id })),
    },
  });
}
