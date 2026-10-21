/**
 * Microsoft OAuth callback handling: exchange the auth code for tokens
 * and persist them in the per-tenant secrets bag.
 *
 * Tokens written (all AES-256-GCM encrypted via db/secrets.js):
 *   MS_OAUTH_REFRESH        long-lived refresh token (only set when granted)
 *   MS_OAUTH_ACCESS         short-lived access token
 *   MS_OAUTH_EXPIRES_AT     ISO timestamp when the access token expires
 *   MS_OAUTH_SCOPES         space-separated list of granted scopes
 *   MS_OAUTH_ACCOUNT_EMAIL  decoded from id_token (preferred_username or email);
 *                           used by the /connect page to render "Connected as foo@outlook.com"
 *   MS_OAUTH_CONNECTED_AT   ISO timestamp the user completed consent
 *
 * Env required:
 *   MS_OAUTH_CLIENT_ID
 *   MS_OAUTH_CLIENT_SECRET
 */

import { setSecrets, deleteSecrets } from "../../db/secrets.js";
import { microsoftRedirectUri } from "./urls.js";
import { MICROSOFT_TOKEN_URL } from "./scopes.js";

const SECRET_KEYS = [
  "MS_OAUTH_REFRESH",
  "MS_OAUTH_ACCESS",
  "MS_OAUTH_EXPIRES_AT",
  "MS_OAUTH_SCOPES",
  "MS_OAUTH_ACCOUNT_EMAIL",
  "MS_OAUTH_CONNECTED_AT",
  "MS_OAUTH_CLIENT_ID",
  "MS_OAUTH_CLIENT_SECRET",
];

/**
 * Pull a user-facing account label out of a Microsoft id_token without
 * verifying the signature. The id_token came from Microsoft's token
 * endpoint over TLS so we trust it for display purposes only.
 *
 * Preference order:
 *   1. `email`               present on personal MSA when the user has a verified email
 *   2. `preferred_username`  always present; equals email for MSA, UPN for AAD work/school
 *
 * Returns null on any parse failure or if neither claim is present.
 *
 * Exported for direct unit testing in microsoft.test.js. Production callers
 * go through `storeTokens()`.
 */
export function accountFromIdToken(idToken) {
  if (!idToken || typeof idToken !== "string") return null;
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const seg = parts[1];
    const padded = seg + "=".repeat((4 - (seg.length % 4)) % 4);
    const json = Buffer.from(
      padded.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    const claims = JSON.parse(json);
    if (typeof claims.email === "string" && claims.email.length > 0) {
      return claims.email;
    }
    if (
      typeof claims.preferred_username === "string" &&
      claims.preferred_username.length > 0
    ) {
      return claims.preferred_username;
    }
    return null;
  } catch {
    return null;
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing_env:${name}`);
  return value;
}

/**
 * Exchange the authorization code for tokens. Throws an error whose
 * `.code` is a stable machine-readable string the route can surface.
 */
export async function exchangeCode(code) {
  if (!code || typeof code !== "string") {
    const err = new Error("missing_code");
    err.code = "missing_code";
    throw err;
  }

  const clientId = requireEnv("MS_OAUTH_CLIENT_ID");
  const clientSecret = requireEnv("MS_OAUTH_CLIENT_SECRET");
  const redirectUri = microsoftRedirectUri();

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  const res = await fetch(MICROSOFT_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    // Fail fast on a stalled Microsoft token endpoint; an AbortError
    // propagates to the callback route's try/catch, which redirects to failure.
    signal: AbortSignal.timeout(
      Number(process.env.MS_OAUTH_TIMEOUT_MS) || 10000,
    ),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      json.error_description || json.error || "token_exchange_failed",
    );
    err.code = json.error || "token_exchange_failed";
    err.status = res.status;
    throw err;
  }

  if (!json.access_token) {
    const err = new Error("no_access_token_returned");
    err.code = "no_access_token_returned";
    throw err;
  }

  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token || null,
    expires_in: Number(json.expires_in) || 3600,
    scope: json.scope || "",
    token_type: json.token_type || "Bearer",
    id_token: json.id_token || null,
  };
}

/**
 * Persist the exchanged tokens into the per-tenant secrets bag.
 * `refresh_token` is only stored when present (Microsoft only returns it
 * when `offline_access` is in the granted scope set). `MS_OAUTH_ACCOUNT_EMAIL`
 * is only written when an id_token was returned and could be decoded; the
 * other keys are written unconditionally so the connection-discovery surface
 * always has fresh values.
 */
export async function storeTokens(did, tokens) {
  if (!did) throw new Error("missing_did");
  if (!tokens?.access_token) throw new Error("missing_access_token");

  const now = Date.now();
  const expiresAt = new Date(
    now + Math.max(60, Number(tokens.expires_in) || 3600) * 1000,
  ).toISOString();
  const connectedAt = new Date(now).toISOString();
  const accountEmail = accountFromIdToken(tokens.id_token);

  const record = {
    MS_OAUTH_ACCESS: tokens.access_token,
    MS_OAUTH_EXPIRES_AT: expiresAt,
    MS_OAUTH_SCOPES: tokens.scope || "",
    MS_OAUTH_CONNECTED_AT: connectedAt,
    // OAuth client credentials mirrored so refresh / revoke flows don't
    // depend on process.env resolving on every host that reads the bag.
    MS_OAUTH_CLIENT_ID: process.env.MS_OAUTH_CLIENT_ID || null,
    MS_OAUTH_CLIENT_SECRET: process.env.MS_OAUTH_CLIENT_SECRET || null,
  };
  if (tokens.refresh_token) {
    record.MS_OAUTH_REFRESH = tokens.refresh_token;
  }
  if (accountEmail) {
    record.MS_OAUTH_ACCOUNT_EMAIL = accountEmail;
  }

  await setSecrets(did, record, { updatedBy: "oauth:microsoft" });

  /**
   * AND RECORD IT AS A CALENDAR ACCOUNT. Same reasoning as the Google callback:
   * the secrets bag holds one Microsoft grant per person under fixed key names,
   * so a second Outlook account would overwrite the first. calendar_accounts is
   * keyed on (owner, provider, account_email) and holds as many as somebody has.
   *
   * Best effort: a failure here must not break a connection that worked.
   */
  if (accountEmail) {
    try {
      const [{ resolveAmberIdByPrivyDid }, { connectCalendarAccount }] = await Promise.all([
        import("../../db/store.js"),
        import("../../db/calendar-accounts.js"),
      ]);
      const ownerId = await resolveAmberIdByPrivyDid(did);
      if (ownerId) {
        await connectCalendarAccount(ownerId, {
          provider: "microsoft",
          accountEmail,
          refreshToken: tokens.refresh_token ?? null,
          accessToken: tokens.access_token ?? null,
          expiresAt,
          scopes: tokens.scope || null,
        });
      }
    } catch (err) {
      console.warn(`[oauth-microsoft] calendar account not recorded: ${err?.message || err}`);
    }
  }

  return { stored: Object.keys(record), expires_at: expiresAt };
}

/** Remove every MS_OAUTH_* key for this DID. */
export async function clearTokens(did) {
  if (!did) throw new Error("missing_did");
  await deleteSecrets(did, SECRET_KEYS);
  return { cleared: SECRET_KEYS };
}

export { SECRET_KEYS as MICROSOFT_SECRET_KEYS };
