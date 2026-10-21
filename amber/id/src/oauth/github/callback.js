/**
 * GitHub OAuth callback: exchange `code` for an access token, hydrate the
 * connected-account label from /user + /user/emails, and persist into the
 * per-tenant secrets bag.
 *
 * Classic OAuth Apps with "Expire user authorization tokens" disabled
 * never issue refresh tokens — the access token is the only credential
 * and lives until the user revokes. So the secrets shape diverges from
 * the Google/Microsoft pattern: no GITHUB_OAUTH_REFRESH, no
 * GITHUB_OAUTH_EXPIRES_AT. Downstream tools must accept the access token
 * as a long-lived bearer.
 *
 * Account label is the user's GitHub login (`@calebnewtonusc`), stored as
 * GITHUB_OAUTH_ACCOUNT_HANDLE. Email is best-effort: GitHub returns null
 * on /user if the user keeps their email private, so we fall back to
 * /user/emails (gated on the `user:email` scope, which is included via
 * the umbrella `user` scope) and pick the primary verified address.
 */

import { setSecrets } from "../../db/secrets.js";
import { publicBaseUrl } from "../lib/public-url.js";

const TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";
const USER_ENDPOINT = "https://api.github.com/user";
const EMAILS_ENDPOINT = "https://api.github.com/user/emails";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for GitHub OAuth callback`);
  }
  return value;
}

function callbackUrl() {
  const base = publicBaseUrl();
  return `${base}/v1/oauth/github/callback`;
}

/**
 * Exchange an authorization code for an access token. Returns the parsed
 * GitHub token response: { access_token, token_type, scope }. Throws on
 * any failure path so the route handler can map to a callback redirect.
 *
 * GitHub returns 200 on validation failures with a JSON body containing
 * `error` + `error_description` — we treat that as a failure too.
 */
export async function exchangeCode(code) {
  if (!code || typeof code !== "string") {
    throw new Error("invalid_code");
  }

  const body = new URLSearchParams({
    code,
    client_id: requireEnv("GITHUB_OAUTH_CLIENT_ID"),
    client_secret: requireEnv("GITHUB_OAUTH_CLIENT_SECRET"),
    redirect_uri: callbackUrl(),
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
    // Fail fast on a stalled GitHub token endpoint; an AbortError propagates
    // to the callback route's try/catch, which redirects to failure.
    signal: AbortSignal.timeout(
      Number(process.env.GITHUB_OAUTH_TIMEOUT_MS) || 10000,
    ),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = json?.error || `http_${res.status}`;
    const err = new Error(`token_exchange_failed:${reason}`);
    err.githubError = json;
    throw err;
  }
  if (json.error) {
    const err = new Error(`token_exchange_failed:${json.error}`);
    err.githubError = json;
    throw err;
  }
  if (!json.access_token) {
    throw new Error("token_exchange_failed:missing_access_token");
  }
  return json;
}

/**
 * Pull the connected account's login + display name + email so the
 * frontend can render "Connected as @calebnewtonusc" and the agent can
 * resolve short-name repos against the user's own login. Best-effort:
 * any failure returns nulls and the callback still completes.
 */
export async function fetchProfile(accessToken) {
  try {
    const res = await fetch(USER_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "medha-id",
      },
      signal: AbortSignal.timeout(
        Number(process.env.GITHUB_OAUTH_TIMEOUT_MS) || 10000,
      ),
    });
    if (!res.ok) {
      return { login: null, name: null, email: null, userId: null };
    }
    const profile = await res.json();
    return {
      login: profile.login || null,
      name: profile.name || null,
      email: profile.email || null,
      userId: profile.id != null ? String(profile.id) : null,
    };
  } catch {
    return { login: null, name: null, email: null, userId: null };
  }
}

/**
 * /user returns email=null when the user has their address set to private,
 * even if the token has `user:email` scope. /user/emails returns the full
 * email list including the verified primary, which is what we want for
 * the connected-account label and any future deduplication.
 */
export async function fetchPrimaryEmail(accessToken) {
  try {
    const res = await fetch(EMAILS_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "medha-id",
      },
      signal: AbortSignal.timeout(
        Number(process.env.GITHUB_OAUTH_TIMEOUT_MS) || 10000,
      ),
    });
    if (!res.ok) return null;
    const emails = await res.json();
    if (!Array.isArray(emails)) return null;
    const primary = emails.find((e) => e?.primary && e?.verified);
    return primary?.email || null;
  } catch {
    return null;
  }
}

/**
 * Persist the GitHub OAuth bundle into the secrets bag for a given DID.
 *
 * Stored keys:
 *   GITHUB_OAUTH_ACCESS          long-lived access token (only credential
 *                                we have — no refresh token in this flow)
 *   GITHUB_OAUTH_TOKEN_TYPE      "bearer" per GitHub spec
 *   GITHUB_OAUTH_SCOPES          space-separated granted scopes
 *   GITHUB_OAUTH_CONNECTED_AT    ISO timestamp the user finished consent
 *   GITHUB_OAUTH_ACCOUNT_HANDLE  GitHub login (drives the "Connected as
 *                                @login" pill + short-name repo lookups)
 *   GITHUB_OAUTH_ACCOUNT_NAME    display name from /user
 *   GITHUB_OAUTH_ACCOUNT_EMAIL   primary verified email from /user/emails
 *   GITHUB_OAUTH_USER_ID         numeric GitHub user id as string (stable
 *                                across login renames)
 */
export async function storeTokens(did, tokens, profile, { updatedBy } = {}) {
  if (!did || typeof did !== "string") {
    throw new Error("did is required to store GitHub tokens");
  }
  if (!tokens || typeof tokens !== "object") {
    throw new Error("tokens object is required");
  }

  const grantedScopes = (tokens.scope || "")
    .split(/[\s,]+/)
    .filter(Boolean)
    .join(" ");

  const record = {
    GITHUB_OAUTH_ACCESS: tokens.access_token,
    GITHUB_OAUTH_TOKEN_TYPE: tokens.token_type || "bearer",
    GITHUB_OAUTH_SCOPES: grantedScopes,
    GITHUB_OAUTH_CONNECTED_AT: new Date().toISOString(),
    GITHUB_OAUTH_ACCOUNT_HANDLE: profile?.login || null,
    GITHUB_OAUTH_ACCOUNT_NAME: profile?.name || null,
    GITHUB_OAUTH_ACCOUNT_EMAIL: profile?.email || null,
    GITHUB_OAUTH_USER_ID: profile?.userId || null,
    // OAuth client credentials mirrored so the revoke flow (which needs
    // them for HTTP Basic) and downstream refresh consumers don't depend
    // on process.env resolving on every host.
    GITHUB_OAUTH_CLIENT_ID: process.env.GITHUB_OAUTH_CLIENT_ID || null,
    GITHUB_OAUTH_CLIENT_SECRET: process.env.GITHUB_OAUTH_CLIENT_SECRET || null,
  };

  return setSecrets(did, record, {
    updatedBy: updatedBy || "oauth-github-callback",
  });
}

/**
 * Revoke the access token on GitHub's side, then clear all
 * GITHUB_OAUTH_* keys from the bag.
 *
 * GitHub's revoke flow: DELETE /applications/{client_id}/grant with HTTP
 * Basic Auth of (client_id:client_secret) and a JSON body containing the
 * access_token. Returns 204 on success, 404 if already revoked. Either
 * way we proceed to clear local state — a stale token must never block
 * a disconnect.
 */
export async function revokeAndClear(did, { accessToken } = {}) {
  if (!did || typeof did !== "string") {
    throw new Error("did is required to revoke GitHub tokens");
  }

  let revoked = false;
  if (accessToken) {
    try {
      const clientId = requireEnv("GITHUB_OAUTH_CLIENT_ID");
      const clientSecret = requireEnv("GITHUB_OAUTH_CLIENT_SECRET");
      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString(
        "base64",
      );
      const res = await fetch(
        `https://api.github.com/applications/${encodeURIComponent(clientId)}/grant`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Basic ${basic}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "medha-id",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ access_token: accessToken }),
          signal: AbortSignal.timeout(
            Number(process.env.GITHUB_OAUTH_TIMEOUT_MS) || 10000,
          ),
        },
      );
      revoked = res.ok || res.status === 404;
    } catch {
      // Local clear still proceeds even if GitHub is unreachable.
    }
  }

  await setSecrets(
    did,
    {
      GITHUB_OAUTH_ACCESS: null,
      GITHUB_OAUTH_TOKEN_TYPE: null,
      GITHUB_OAUTH_SCOPES: null,
      GITHUB_OAUTH_CONNECTED_AT: null,
      GITHUB_OAUTH_ACCOUNT_HANDLE: null,
      GITHUB_OAUTH_ACCOUNT_NAME: null,
      GITHUB_OAUTH_ACCOUNT_EMAIL: null,
      GITHUB_OAUTH_USER_ID: null,
      GITHUB_OAUTH_CLIENT_ID: null,
      GITHUB_OAUTH_CLIENT_SECRET: null,
    },
    { updatedBy: "oauth-github-revoke" },
  );

  return { revoked };
}

export const __test__ = {
  callbackUrl,
  TOKEN_ENDPOINT,
  USER_ENDPOINT,
  EMAILS_ENDPOINT,
};
