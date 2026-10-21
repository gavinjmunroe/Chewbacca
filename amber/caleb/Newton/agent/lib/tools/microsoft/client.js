/**
 * microsoft/client.js: Microsoft Graph REST API wrapper with OAuth2 token
 * management. Shared by every Microsoft surface (Outlook, Calendar, OneDrive,
 * Teams) so they all converge on the same refresh path and the same
 * structured error code on auth failure.
 *
 * On a 401 from Graph, or when the refresh token is missing entirely, throws
 * an error with `code: "microsoft_oauth_required"` so tool dispatchers can
 * render a reconnect link verbatim. Parallel to gcal/client.js's
 * `calendar_oauth_required`.
 */

import { getMicrosoftAccessToken } from "../microsoft-oauth.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

/**
 * Make an authenticated request to Microsoft Graph.
 *
 * @param {object} opts
 * @param {object} opts.tenant   tenant object (or any object whose DID resolves
 *                               via secrets.js's identity bridge).
 * @param {string} opts.service  one of 'outlook' | 'mscal' | 'onedrive' | 'teams'.
 * @param {string} opts.method   GET | POST | PUT | PATCH | DELETE
 * @param {string} opts.path     path AFTER /v1.0 (e.g. "/me/messages")
 * @param {object} [opts.query]  optional query string params (object → URLSearchParams)
 * @param {object} [opts.body]   optional JSON request body
 * @returns {Promise<{ok: boolean, status: number, data: any, error?: string}>}
 */
export async function graphRequest({
  tenant,
  service,
  method,
  path,
  query,
  body,
}) {
  let accessToken;
  try {
    accessToken = await getMicrosoftAccessToken(tenant, service);
  } catch (err) {
    throw Object.assign(new Error("microsoft_oauth_required"), {
      code: "microsoft_oauth_required",
      cause: err,
    });
  }

  if (!accessToken) {
    throw Object.assign(new Error("microsoft_oauth_required"), {
      code: "microsoft_oauth_required",
      cause: new Error("no access token resolved"),
    });
  }

  let url = `${GRAPH_BASE}${path}`;
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

  if (res.status === 401) {
    // Cached access token rejected even though our local expiry said it was
    // valid. Most often: scope changed, user revoked in their MS account,
    // or refresh token rotated. Surface as oauth_required so the user sees
    // the reconnect link instead of a raw Graph error.
    throw Object.assign(new Error("microsoft_oauth_required"), {
      code: "microsoft_oauth_required",
      cause: new Error(data?.error?.message || "graph returned 401"),
    });
  }

  if (!res.ok) {
    const errMsg =
      data?.error?.message ||
      (typeof data?.error === "string" ? data.error : null) ||
      `HTTP ${res.status}`;
    return { ok: false, status: res.status, data, error: errMsg };
  }

  return { ok: true, status: res.status, data };
}
