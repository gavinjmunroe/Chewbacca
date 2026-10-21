/**
 * GOOGLE AS A WAY IN, NOT AS A DATA SOURCE.
 *
 * There is already a Google OAuth flow in this service and this is not it.
 * That one asks for a signed-in person's permission to read their contacts;
 * this one answers "who is this" for somebody who has no session at all. They
 * want different scopes, different trust and different failure modes, and
 * collapsing them would mean a sign-in button that asks for your address book.
 *
 * WHAT THIS TRUSTS. The id_token Google returns is a JWT signed by Google. We
 * verify the signature against Google's published keys, then check the
 * audience is our client, the issuer is Google, it has not expired, and -- the
 * one everybody forgets -- that `email_verified` is true. A Google account can
 * carry an unverified email, and treating one as proof of an address is how
 * somebody signs in as a colleague.
 *
 * WHAT IT DELIBERATELY CANNOT DO: create an account. The caller decides that,
 * and the rule there is narrow by design -- see org-sso.js.
 */

const ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);
const CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

export function googleSignInConfigured() {
  return Boolean(process.env.GOOGLE_SIGNIN_CLIENT_ID && process.env.GOOGLE_SIGNIN_CLIENT_SECRET);
}

function clientId() {
  return process.env.GOOGLE_SIGNIN_CLIENT_ID;
}

/**
 * Where this service is reachable, for the redirect Google sends people back
 * to. It is the API rather than the website, because the code exchange needs
 * the client secret and a browser must never hold one.
 */
export function signInRedirectUri() {
  const base = (process.env.AMBER_API_BASE_URL || "").replace(/\/+$/, "");
  if (!base) throw new Error("AMBER_API_BASE_URL is required for Google sign-in");
  return `${base}/v1/org/auth/google/callback`;
}

/**
 * The URL to send somebody to.
 *
 * `prompt=select_account` because a person with two Google accounts -- which
 * is most people with a work one -- otherwise gets silently signed in as
 * whichever they used last, and the failure is "it says I am somebody else".
 *
 * Only openid/email/profile. This asks who you are and nothing else; a sign-in
 * button that requests Gmail scopes is a sign-in button people decline.
 */
export function buildSignInUrl({ state, loginHint = null }) {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: signInRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
    access_type: "online",
  });
  if (loginHint) params.set("login_hint", loginHint);
  return `${AUTH_URL}?${params.toString()}`;
}

/** Trade the one-time code for an id_token. Needs the secret, so: server only. */
export async function exchangeSignInCode(code) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId(),
      client_secret: process.env.GOOGLE_SIGNIN_CLIENT_SECRET,
      redirect_uri: signInRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    return { ok: false, reason: "exchange_failed", status: res.status };
  }
  const body = await res.json();
  if (!body?.id_token) return { ok: false, reason: "no_id_token" };
  return { ok: true, idToken: body.id_token };
}

/*
 * Google's signing keys, cached. They rotate, so this is not a constant -- but
 * fetching them on every sign-in would put an outbound request in the path of
 * every login and make Google's availability our availability for longer than
 * it has to be.
 */
let _keys = null;
let _keysAt = 0;
const KEYS_TTL_MS = 60 * 60 * 1000;

async function googleKeys(fetchImpl = fetch) {
  if (_keys && Date.now() - _keysAt < KEYS_TTL_MS) return _keys;
  const res = await fetchImpl(CERTS_URL);
  if (!res.ok) throw new Error(`google_certs_${res.status}`);
  const body = await res.json();
  _keys = body?.keys ?? [];
  _keysAt = Date.now();
  return _keys;
}

/** Exported so a test can seed or clear the cache without the network. */
export function _setGoogleKeys(keys, at = Date.now()) {
  _keys = keys;
  _keysAt = at;
}

function b64urlToBuffer(s) {
  return Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/**
 * Verify an id_token and return the identity it asserts.
 *
 * @returns {Promise<{ok:true,email:string,name:string|null,sub:string}|{ok:false,reason:string}>}
 */
export async function verifyIdToken(idToken, { now = Date.now(), fetchImpl = fetch } = {}) {
  const parts = String(idToken ?? "").split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };

  let header;
  let claims;
  try {
    header = JSON.parse(b64urlToBuffer(parts[0]).toString("utf8"));
    claims = JSON.parse(b64urlToBuffer(parts[1]).toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const keys = await googleKeys(fetchImpl).catch(() => null);
  if (!keys) return { ok: false, reason: "keys_unavailable" };
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return { ok: false, reason: "unknown_key" };

  const crypto = await import("node:crypto");
  const key = crypto.createPublicKey({ key: jwk, format: "jwk" });
  const ok = crypto.verify(
    "RSA-SHA256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    key,
    b64urlToBuffer(parts[2]),
  );
  if (!ok) return { ok: false, reason: "bad_signature" };

  // THE CLAIMS, ALL OF THEM. A verified signature only says Google wrote this;
  // it does not say Google wrote it for us, or recently.
  if (!ISSUERS.has(String(claims.iss))) return { ok: false, reason: "bad_issuer" };
  if (String(claims.aud) !== String(clientId())) return { ok: false, reason: "bad_audience" };
  if (!claims.exp || Number(claims.exp) * 1000 < now) return { ok: false, reason: "expired" };

  /*
   * email_verified IS THE ONE EVERYBODY FORGETS. A Google account can carry an
   * address it has never proved it owns, and treating that as proof is how
   * somebody signs in as a colleague by adding their address to a personal
   * Google account.
   */
  if (claims.email_verified !== true && claims.email_verified !== "true") {
    return { ok: false, reason: "email_unverified" };
  }
  const email = String(claims.email ?? "").trim().toLowerCase();
  if (!email) return { ok: false, reason: "no_email" };

  return { ok: true, email, name: claims.name ? String(claims.name) : null, sub: String(claims.sub) };
}
