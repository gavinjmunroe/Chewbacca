/**
 * Railway OAuth 2.0 callback: exchange the authorization code (plus
 * the PKCE code_verifier we stashed at init time) for an access /
 * refresh token pair, hydrate the connected workspace identity from
 * /oauth/me, and persist everything into the per-tenant secrets bag.
 *
 * Secrets-bag keys written here:
 *
 *   RAILWAY_OAUTH_REFRESH         long-lived refresh token (offline_access).
 *                                 The presence key for the connection in
 *                                 connections.js -- agent tools use it to
 *                                 re-mint access tokens.
 *   RAILWAY_OAUTH_ACCESS          current access token (~1h lifetime)
 *   RAILWAY_OAUTH_EXPIRES_AT      ISO timestamp when access token expires
 *   RAILWAY_OAUTH_SCOPES          space-delimited scopes Railway actually
 *                                 granted (may differ from what we asked
 *                                 if the user de-checked any on consent)
 *   RAILWAY_OAUTH_TOKEN_TYPE      always "Bearer"
 *   RAILWAY_OAUTH_ID_TOKEN        ID token from the openid scope (claims
 *                                 mirror what /oauth/me returns; kept for
 *                                 future audit / sub-binding)
 *   RAILWAY_OAUTH_ACCOUNT_SUB     Railway user uuid from id_token `sub`
 *   RAILWAY_OAUTH_ACCOUNT_EMAIL   email claim (Connected as ... label)
 *   RAILWAY_OAUTH_ACCOUNT_NAME    display name from /oauth/me
 *   RAILWAY_OAUTH_CONNECTED_AT    ISO timestamp the user connected
 */

import { setSecrets } from "../../db/secrets.js";
import { RAILWAY_TOKEN_URL, RAILWAY_USERINFO_URL } from "./scopes.js";
import { callbackUrl } from "./init.js";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var: ${name}`);
  return v;
}

/**
 * POST to Railway's token endpoint with code + code_verifier to redeem
 * the auth code. Railway accepts both client_secret_basic and
 * client_secret_post per the discovery document; we use basic auth to
 * keep the client_secret out of the body where it would surface in
 * logs if anything ever decided to log request bodies.
 *
 * Returns the parsed token response. Throws with a sanitized message
 * (no secret) on any failure.
 */
export async function exchangeCode(code, codeVerifier) {
  if (!code || typeof code !== "string") {
    throw new Error("code is required");
  }
  if (!codeVerifier || typeof codeVerifier !== "string") {
    throw new Error("code_verifier is required");
  }

  const clientId = requireEnv("RAILWAY_OAUTH_CLIENT_ID");
  const clientSecret = requireEnv("RAILWAY_OAUTH_CLIENT_SECRET");

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: callbackUrl(),
    code_verifier: codeVerifier,
  });

  const res = await fetch(RAILWAY_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
      Accept: "application/json",
    },
    body: body.toString(),
    // Fail fast on a stalled Railway token endpoint; an AbortError propagates
    // to the callback route's try/catch, which redirects to failure.
    signal: AbortSignal.timeout(
      Number(process.env.RAILWAY_OAUTH_TIMEOUT_MS) || 10000,
    ),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = json?.error || `http_${res.status}`;
    const err = new Error(`token_exchange_failed:${reason}`);
    err.railwayError = json;
    throw err;
  }
  if (!json.access_token) {
    throw new Error("token_exchange_failed:missing_access_token");
  }
  if (!json.refresh_token) {
    // offline_access was requested in init.js; if Railway omitted the
    // refresh token, the user de-selected that scope on consent.
    // We still proceed (the access token works for one hour) but flag
    // it so the operator notices the connection will silently break.
    console.warn(
      "[railway-oauth] token response missing refresh_token; " +
        "user likely declined offline_access scope",
    );
  }
  return json;
}

/**
 * Pull the connected account from /oauth/me using the freshly-issued
 * access token. The OIDC userinfo endpoint returns sub/email/name/
 * picture claims. Best-effort: failure here returns nulls so the
 * callback still completes (the agent can still use the token, it
 * just lacks a pretty label on the /connect page).
 */
export async function fetchUserinfo(accessToken) {
  if (!accessToken) return { sub: null, email: null, name: null };
  try {
    const res = await fetch(RAILWAY_USERINFO_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(
        Number(process.env.RAILWAY_OAUTH_TIMEOUT_MS) || 10000,
      ),
    });
    if (!res.ok) return { sub: null, email: null, name: null };
    const json = await res.json().catch(() => ({}));
    return {
      sub: json.sub || null,
      email: json.email || null,
      name: json.name || null,
    };
  } catch {
    return { sub: null, email: null, name: null };
  }
}

/**
 * Persist a Railway token bundle into the secrets bag for a given DID.
 */
export async function storeTokens(did, tokens, userinfo, { updatedBy } = {}) {
  if (!did || typeof did !== "string") {
    throw new Error("did is required to store Railway tokens");
  }
  if (!tokens || typeof tokens !== "object") {
    throw new Error("tokens object is required");
  }

  const expiresInSec = Number(tokens.expires_in);
  const expiresAt =
    Number.isFinite(expiresInSec) && expiresInSec > 0
      ? new Date(Date.now() + expiresInSec * 1000).toISOString()
      : null;

  return setSecrets(
    did,
    {
      RAILWAY_OAUTH_REFRESH: tokens.refresh_token || null,
      RAILWAY_OAUTH_ACCESS: tokens.access_token,
      RAILWAY_OAUTH_EXPIRES_AT: expiresAt,
      RAILWAY_OAUTH_SCOPES: tokens.scope || null,
      RAILWAY_OAUTH_TOKEN_TYPE: tokens.token_type || "Bearer",
      RAILWAY_OAUTH_ID_TOKEN: tokens.id_token || null,
      RAILWAY_OAUTH_ACCOUNT_SUB: userinfo?.sub || null,
      RAILWAY_OAUTH_ACCOUNT_EMAIL: userinfo?.email || null,
      RAILWAY_OAUTH_ACCOUNT_NAME: userinfo?.name || null,
      RAILWAY_OAUTH_CONNECTED_AT: new Date().toISOString(),
      // OAuth client credentials mirrored so refresh flows (which need
      // them for the HTTP Basic header) don't depend on process.env
      // resolving on every host that reads the bag.
      RAILWAY_OAUTH_CLIENT_ID: process.env.RAILWAY_OAUTH_CLIENT_ID || null,
      RAILWAY_OAUTH_CLIENT_SECRET:
        process.env.RAILWAY_OAUTH_CLIENT_SECRET || null,
    },
    { updatedBy: updatedBy || "oauth-railway-callback" },
  );
}

/**
 * Clear all RAILWAY_OAUTH_* keys from the bag. Railway's discovery
 * document does not advertise a revocation_endpoint, so there is no
 * server-side revoke step — disconnecting is local-only. The user
 * can hard-revoke from the Railway dashboard (Workspace settings ->
 * Connected Apps) if they want to invalidate the refresh token on
 * Railway's side too.
 */
export async function clearTokens(did) {
  if (!did || typeof did !== "string") {
    throw new Error("did is required to clear Railway tokens");
  }
  return setSecrets(
    did,
    {
      RAILWAY_OAUTH_REFRESH: null,
      RAILWAY_OAUTH_ACCESS: null,
      RAILWAY_OAUTH_EXPIRES_AT: null,
      RAILWAY_OAUTH_SCOPES: null,
      RAILWAY_OAUTH_TOKEN_TYPE: null,
      RAILWAY_OAUTH_ID_TOKEN: null,
      RAILWAY_OAUTH_ACCOUNT_SUB: null,
      RAILWAY_OAUTH_ACCOUNT_EMAIL: null,
      RAILWAY_OAUTH_ACCOUNT_NAME: null,
      RAILWAY_OAUTH_CONNECTED_AT: null,
      RAILWAY_OAUTH_CLIENT_ID: null,
      RAILWAY_OAUTH_CLIENT_SECRET: null,
    },
    { updatedBy: "oauth-railway-disconnect" },
  );
}

export const __test__ = { RAILWAY_TOKEN_URL, RAILWAY_USERINFO_URL };
