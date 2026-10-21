/**
 * LinkedIn OAuth callback - exchange the auth code for tokens and persist
 * them to the user's per-tenant secrets bag.
 *
 * LinkedIn's token endpoint returns refresh_token only for apps approved
 * for the "Refresh Tokens" product. We store it when present so subsequent
 * access-token refresh calls don't require the user to re-consent. When
 * absent, only the access token + its expiry are stored - downstream
 * callers should treat LINKEDIN_OAUTH_REFRESH=null as "ask the user to
 * reconnect once the access token expires".
 */

import { setSecrets } from "../../db/secrets.js";
import { LINKEDIN_TOKEN_URL, LINKEDIN_REVOKE_URL } from "./scopes.js";
import { getRedirectUri } from "./init.js";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required for LinkedIn OAuth`);
  return v;
}

/**
 * Exchange an authorization code for an access + refresh token.
 *
 * Throws on any non-2xx response so the route handler can surface a
 * `?linkedin=failed&reason=token_exchange_failed` redirect to the frontend.
 */
export async function exchangeCode(code) {
  if (!code || typeof code !== "string") {
    throw new Error("code is required");
  }
  const clientId = requireEnv("LINKEDIN_OAUTH_CLIENT_ID");
  const clientSecret = requireEnv("LINKEDIN_OAUTH_CLIENT_SECRET");
  const redirectUri = getRedirectUri();

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(LINKEDIN_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    // Fail fast on a stalled LinkedIn token endpoint; an AbortError propagates
    // to the callback route's try/catch, which redirects to failure.
    signal: AbortSignal.timeout(
      Number(process.env.LINKEDIN_OAUTH_TIMEOUT_MS) || 10000,
    ),
  });
  const text = await res.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(
      `linkedin token exchange failed: ${res.status} ${payload.error || ""} ${
        payload.error_description || ""
      }`.trim(),
    );
    err.status = res.status;
    err.payload = payload;
    throw err;
  }
  return payload;
}

/**
 * Write LinkedIn tokens into the secrets bag for `did`.
 *
 * Key shape (all stored encrypted by db/secrets.js):
 *   LINKEDIN_OAUTH_ACCESS        access_token
 *   LINKEDIN_OAUTH_REFRESH       refresh_token (or null when not granted)
 *   LINKEDIN_OAUTH_EXPIRES_AT    ISO timestamp of access_token expiry
 *   LINKEDIN_OAUTH_REFRESH_EXPIRES_AT  ISO timestamp of refresh_token expiry
 *   LINKEDIN_OAUTH_SCOPES        space-separated scopes actually granted
 *   LINKEDIN_OAUTH_CONNECTED_AT  ISO timestamp of when the user finished consent
 */
export async function storeTokens(did, tokens) {
  if (!did) throw new Error("did is required");
  if (!tokens || typeof tokens !== "object") {
    throw new Error("tokens object is required");
  }

  const now = Date.now();
  const expiresInMs = Number(tokens.expires_in || 0) * 1000;
  const refreshExpiresInMs =
    Number(tokens.refresh_token_expires_in || 0) * 1000;

  const record = {
    LINKEDIN_OAUTH_ACCESS: tokens.access_token || null,
    LINKEDIN_OAUTH_REFRESH: tokens.refresh_token || null,
    LINKEDIN_OAUTH_EXPIRES_AT: expiresInMs
      ? new Date(now + expiresInMs).toISOString()
      : null,
    LINKEDIN_OAUTH_REFRESH_EXPIRES_AT: refreshExpiresInMs
      ? new Date(now + refreshExpiresInMs).toISOString()
      : null,
    LINKEDIN_OAUTH_SCOPES: tokens.scope || null,
    LINKEDIN_OAUTH_CONNECTED_AT: new Date(now).toISOString(),
    // OAuth client credentials mirrored so refresh / revoke flows don't
    // depend on process.env resolving on every host that reads the bag.
    LINKEDIN_OAUTH_CLIENT_ID: process.env.LINKEDIN_OAUTH_CLIENT_ID || null,
    LINKEDIN_OAUTH_CLIENT_SECRET:
      process.env.LINKEDIN_OAUTH_CLIENT_SECRET || null,
  };

  await setSecrets(did, record, { updatedBy: "oauth:linkedin" });
  return record;
}

/**
 * Revoke a LinkedIn access token. Safe to call even if the token is already
 * invalid - LinkedIn returns 200 in either case. Errors are swallowed because
 * the disconnect flow must succeed locally even if LinkedIn is unreachable;
 * the secrets are still cleared by the caller.
 */
export async function revokeToken(accessToken) {
  if (!accessToken) return { ok: true, skipped: true };
  try {
    const clientId = requireEnv("LINKEDIN_OAUTH_CLIENT_ID");
    const clientSecret = requireEnv("LINKEDIN_OAUTH_CLIENT_SECRET");
    const body = new URLSearchParams({
      token: accessToken,
      client_id: clientId,
      client_secret: clientSecret,
    });
    const res = await fetch(LINKEDIN_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(
        Number(process.env.LINKEDIN_OAUTH_TIMEOUT_MS) || 10000,
      ),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
