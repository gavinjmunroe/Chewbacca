/**
 * Twitter OAuth 2.0 callback: exchange the authorization code for an
 * access_token / refresh_token pair and persist them in the user's
 * encrypted secrets bag.
 *
 * Secrets-bag keys written here:
 *
 *   TWITTER_OAUTH_REFRESH      long-lived refresh token (offline.access)
 *   TWITTER_OAUTH_ACCESS       current access token (~2h lifetime)
 *   TWITTER_OAUTH_EXPIRES_AT   ISO timestamp when access token expires
 *   TWITTER_OAUTH_SCOPES       space-delimited scopes Twitter actually granted
 *   TWITTER_OAUTH_TOKEN_TYPE   typically "bearer"
 *
 * Twitter's confidential-client flows require HTTP Basic auth on the token
 * endpoint (client_id:client_secret). Public-client flows do not. We use
 * the confidential variant because TWITTER_OAUTH_CLIENT_SECRET is set in
 * Railway env — flipping to public clients would just mean dropping the
 * Authorization header.
 */

import { setSecrets } from "../../db/secrets.js";
import { TWITTER_TOKEN_URL, TWITTER_REVOKE_URL } from "./scopes.js";
import { publicBaseUrl } from "../lib/public-url.js";

const TWITTER_USERS_ME_URL = "https://api.x.com/2/users/me";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var: ${name}`);
  return v;
}

/**
 * POST to Twitter's token endpoint and return the parsed token response.
 * Throws on non-2xx with a sanitized error message (no client_secret).
 */
export async function exchangeCode(code, codeVerifier) {
  if (!code || typeof code !== "string") {
    throw new Error("code is required");
  }
  if (!codeVerifier || typeof codeVerifier !== "string") {
    throw new Error("codeVerifier is required");
  }

  const clientId = requireEnv("TWITTER_OAUTH_CLIENT_ID");
  const clientSecret = requireEnv("TWITTER_OAUTH_CLIENT_SECRET");
  const publicUrl = publicBaseUrl();
  const redirectUri = `${publicUrl}/v1/oauth/twitter/callback`;

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64",
  );

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
    client_id: clientId,
  });

  const res = await fetch(TWITTER_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
      Accept: "application/json",
    },
    body: body.toString(),
    // Fail fast on a stalled Twitter token endpoint; an AbortError propagates
    // to the callback route's try/catch, which redirects to failure.
    signal: AbortSignal.timeout(
      Number(process.env.TWITTER_OAUTH_TIMEOUT_MS) || 10000,
    ),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `twitter token exchange failed: ${res.status} ${text.slice(0, 200)}`,
    );
  }

  const json = await res.json();
  if (!json.access_token) {
    throw new Error("twitter token response missing access_token");
  }
  return json;
}

/**
 * Best-effort call to /2/users/me to fetch the connected account's @handle
 * and numeric user_id. Returns null on any failure: the handle is a
 * UX nice-to-have for "Connected as @foo", and the user_id is an
 * optimization (most v2 write endpoints want the numeric id, so caching
 * it once at OAuth time saves a round-trip on every tool call). Never
 * blocks token persistence.
 */
async function fetchUserIdentity(accessToken) {
  if (!accessToken) return null;
  try {
    const res = await fetch(TWITTER_USERS_ME_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(
        Number(process.env.TWITTER_OAUTH_TIMEOUT_MS) || 10000,
      ),
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const data = json?.data;
    if (!data) return null;
    const username = typeof data.username === "string" ? data.username : null;
    const userId = typeof data.id === "string" ? data.id : null;
    if (!username && !userId) return null;
    return {
      handle: username ? `@${username}` : null,
      userId,
    };
  } catch {
    return null;
  }
}

/**
 * Persist tokens in the per-user secrets bag. The secret store handles
 * AES-256-GCM encryption before the values touch Firestore.
 */
export async function storeTokens(did, tokens, { updatedBy } = {}) {
  if (!did) throw new Error("did is required");
  if (!tokens || typeof tokens !== "object") {
    throw new Error("tokens object is required");
  }

  const expiresInSec = Number(tokens.expires_in);
  const expiresAt =
    Number.isFinite(expiresInSec) && expiresInSec > 0
      ? new Date(Date.now() + expiresInSec * 1000).toISOString()
      : null;

  const identity = await fetchUserIdentity(tokens.access_token);

  const record = {
    TWITTER_OAUTH_ACCESS: tokens.access_token,
    TWITTER_OAUTH_REFRESH: tokens.refresh_token || null,
    TWITTER_OAUTH_EXPIRES_AT: expiresAt,
    TWITTER_OAUTH_SCOPES: tokens.scope || null,
    TWITTER_OAUTH_TOKEN_TYPE: tokens.token_type || null,
    TWITTER_OAUTH_HANDLE: identity?.handle ?? null,
    TWITTER_OAUTH_USER_ID: identity?.userId ?? null,
    // OAuth client credentials mirrored so refresh / revoke flows (which
    // need them for the HTTP Basic header) don't depend on process.env
    // resolving on every host that reads the bag.
    TWITTER_OAUTH_CLIENT_ID: process.env.TWITTER_OAUTH_CLIENT_ID || null,
    TWITTER_OAUTH_CLIENT_SECRET:
      process.env.TWITTER_OAUTH_CLIENT_SECRET || null,
  };

  return setSecrets(did, record, { updatedBy: updatedBy || "oauth-twitter" });
}

/**
 * Best-effort revoke of a Twitter access or refresh token. Failures here
 * shouldn't block the DELETE route from clearing the local secrets, so
 * the caller wraps this in try/catch.
 */
export async function revokeToken(token, tokenTypeHint = "access_token") {
  if (!token) return { ok: false, reason: "no_token" };

  const clientId = requireEnv("TWITTER_OAUTH_CLIENT_ID");
  const clientSecret = requireEnv("TWITTER_OAUTH_CLIENT_SECRET");
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64",
  );

  const body = new URLSearchParams({
    token,
    token_type_hint: tokenTypeHint,
    client_id: clientId,
  });

  const res = await fetch(TWITTER_REVOKE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
      Accept: "application/json",
    },
    body: body.toString(),
    signal: AbortSignal.timeout(
      Number(process.env.TWITTER_OAUTH_TIMEOUT_MS) || 10000,
    ),
  });

  return { ok: res.ok, status: res.status };
}
