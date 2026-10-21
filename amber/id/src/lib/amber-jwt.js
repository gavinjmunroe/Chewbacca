/**
 * amber-jwt — issue and verify session tokens for the amber-id native auth
 * path (post-OTP). HS256 with a shared secret so amber-agent can
 * verify the same tokens without a JWKS round-trip.
 *
 * Token shape:
 *   {
 *     iss: "amber-id",
 *     sub: "did:amber:<uuid>",   // canonical user id, used everywhere as DID
 *     phone: "+15555551234",
 *     iat: <unix>,
 *     exp: <unix>                 // 30 days from issue
 *   }
 *
 * The secret lives in env (AMBER_JWT_SECRET) and is shared with amber-agent.
 * Rotation requires updating both deploys; for MVP that is acceptable.
 */

import crypto from "node:crypto";

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function getSecret() {
  const secret = process.env.AMBER_JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AMBER_JWT_SECRET missing or too short (need >= 32 chars)");
  }
  return secret;
}

function base64urlEncode(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64urlDecode(str) {
  const pad = (4 - (str.length % 4)) % 4;
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  return Buffer.from(b64, "base64");
}

function sign(input) {
  return crypto
    .createHmac("sha256", getSecret())
    .update(input)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/**
 * Issue a session token for the given amber DID + phone.
 * Returns the JWT string and the expiry as a unix timestamp.
 */
/**
 * A TOKEN THAT CAN SAY WHAT IT IS ALLOWED TO DO.
 *
 * `scope` is optional and omitting it is the whole of the old behavior: no
 * claim, no restriction, exactly the token iOS has always been given. It exists
 * for the website, where the credential lives in browser storage and is
 * therefore the one most likely to be stolen. A token carrying
 * ["network:read","contacts:read"] is worth the graph and the cards and
 * nothing else -- not notes, not DMs, not the secrets bag -- so losing one is a
 * different kind of day than losing a full session.
 *
 * `ttlSeconds` exists for the same reason: a browser token should not live as
 * long as one on a phone the person is holding.
 */
/**
 * `phone` IS NO LONGER REQUIRED, and the reason is migration 062. An employee
 * invited into a company by their work address may have no phone number at all,
 * so there is nothing to put in the claim and nothing to resolve them by except
 * the DID we are signing. Every existing caller passes a phone and is
 * unaffected; the claim is simply omitted when there is none, and
 * verifySessionToken returns null for it rather than undefined.
 *
 * The DID stays mandatory. A token with no subject is not a session.
 */
export function signSessionToken({ did, phone = null, scope = null, ttlSeconds = null }) {
  if (!did) {
    throw new Error("signSessionToken requires did");
  }
  const scopes = Array.isArray(scope)
    ? [...new Set(scope.map((s) => String(s).trim()).filter(Boolean))]
    : null;
  // An empty array is a token that can do nothing, which is never what a caller
  // meant -- it is what you get from `.filter()` on junk. Refuse it rather than
  // mint a credential that 403s on every route and looks like a server bug.
  if (scopes && scopes.length === 0) {
    throw new Error("signSessionToken: scope was given but empty");
  }
  const ttl = Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? Math.floor(ttlSeconds) : TOKEN_TTL_SECONDS;
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: "amber-id",
    sub: did,
    ...(phone ? { phone } : {}),
    iat: now,
    exp: now + ttl,
    ...(scopes ? { scope: scopes } : {}),
  };
  const headerB64 = base64urlEncode(JSON.stringify(header));
  const payloadB64 = base64urlEncode(JSON.stringify(payload));
  const signature = sign(`${headerB64}.${payloadB64}`);
  return {
    token: `${headerB64}.${payloadB64}.${signature}`,
    expiresAt: payload.exp,
  };
}

/**
 * Verify and parse a session token. Returns `null` for any failure (bad
 * signature, expired, malformed, missing secret) — never throws. Token
 * contents are never returned in error paths.
 */
export function verifySessionToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signature] = parts;
  let expected;
  try {
    expected = sign(`${headerB64}.${payloadB64}`);
  } catch {
    return null;
  }

  // Constant-time compare so timing attacks can't leak the secret.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = JSON.parse(base64urlDecode(payloadB64).toString("utf8"));
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now) return null;
  if (payload.iss !== "amber-id") return null;
  if (typeof payload.sub !== "string" || !payload.sub.startsWith("did:amber:"))
    return null;

  return {
    did: payload.sub,
    phone: payload.phone ?? null,
    issuedAt: payload.iat,
    expiresAt: payload.exp,
    // null means unrestricted, which is what every token minted before this
    // existed carries. Anything that is not an array of strings is treated as
    // null rather than as a scope nobody can satisfy: a malformed claim must
    // not silently widen what the token can reach.
    scope:
      Array.isArray(payload.scope) && payload.scope.every((s) => typeof s === "string")
        ? payload.scope
        : null,
  };
}

/**
 * Same checks as verifySessionToken but returns a short string code
 * describing the FIRST failure reason instead of null. Used by requireAuth
 * to surface diagnostic info on 401 without echoing the token. Never
 * throws; never returns token contents.
 *
 * Return values:
 *   - "ok"                  signature + claims valid
 *   - "not_string"          token missing / wrong type
 *   - "malformed"           not 3 dot-separated parts
 *   - "secret_missing"      AMBER_JWT_SECRET not set on this server
 *   - "signature_mismatch"  HMAC didn't verify (almost always means
 *                           AMBER_JWT_SECRET differs from the secret
 *                           that signed the cookie)
 *   - "bad_payload"         payload section isn't decodable JSON
 *   - "expired"             exp in the past
 *   - "wrong_issuer"        iss != amber-id (e.g., it's a Privy token)
 *   - "wrong_sub_prefix"    sub doesn't start with did:amber:
 */
export function debugVerify(token) {
  if (!token || typeof token !== "string") return "not_string";
  const parts = token.split(".");
  if (parts.length !== 3) return "malformed";

  const [headerB64, payloadB64, signature] = parts;

  let expected;
  try {
    expected = sign(`${headerB64}.${payloadB64}`);
  } catch {
    return "secret_missing";
  }

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return "signature_mismatch";
  if (!crypto.timingSafeEqual(a, b)) return "signature_mismatch";

  let payload;
  try {
    payload = JSON.parse(base64urlDecode(payloadB64).toString("utf8"));
  } catch {
    return "bad_payload";
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now) return "expired";
  if (payload.iss !== "amber-id") return "wrong_issuer";
  if (typeof payload.sub !== "string" || !payload.sub.startsWith("did:amber:"))
    return "wrong_sub_prefix";

  return "ok";
}
