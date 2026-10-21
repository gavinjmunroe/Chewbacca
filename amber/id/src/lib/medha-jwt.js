/**
 * medha-jwt — issue and verify session tokens for the phone + OTP auth path
 * (the Medha dashboard and the Amber iOS app both use it).
 *
 * Distinct from amber-jwt:
 *   - amber-jwt subjects are `did:amber:<hash>` (the iOS / web Amber
 *     identity envelope).
 *   - medha-jwt subjects are the bare `person_id` (sha256(E.164(phone))
 *     truncated to 32 hex chars) so they line up 1:1 with rows in
 *     medha_pdw.persons and the agent's person-resolver output.
 *
 * Same HS256 / shared-secret shape as amber-jwt so we don't introduce a
 * second key management pattern. Secret env: MEDHA_JWT_SECRET.
 *
 * ── TOKEN LIFETIMES ────────────────────────────────────────────────────────
 * These tokens are now SHORT-LIVED ACCESS TOKENS (15 minutes), paired with an
 * opaque refresh token held in device_sessions (see db/session-store.js).
 *
 * This is not a UX regression and must not be "fixed" by lengthening it: the
 * client refreshes silently in the background, so a signed-in person stays
 * signed in until they explicitly sign out. What the short TTL buys is the
 * ability to REVOKE — a stolen access token dies in minutes rather than being
 * usable for a month with no kill switch.
 *
 * `sid` (the device_sessions row id) is what makes revocation work: sign-out
 * kills the refresh row and denylists the sid (lib/session-denylist.js).
 *
 * ── BACKWARD COMPATIBILITY ─────────────────────────────────────────────────
 * Tokens minted before this change are 30-day, `sid`-less, and still verify.
 * They are accepted until they expire naturally, so shipping this does NOT
 * sign the existing user base out. verifyMedhaSession returns `sid: null` for
 * them and requireAuth treats a null sid as "not revocable, allow" — the same
 * behavior those tokens had before.
 *
 * Payload:
 *   {
 *     iss:   "medha-id",
 *     sub:   "<person_id>",
 *     phone: "+15555551234",
 *     sid:   "<device_sessions.id>",   // absent on legacy tokens
 *     typ:   "access",                 // absent on legacy tokens
 *     iat:   <unix>,
 *     exp:   <unix>
 *   }
 */

import crypto from "node:crypto";
import { reviewSessionAllowed } from "./review-account.js";

// Short by design. See the TOKEN LIFETIMES note above before changing.
export const ACCESS_TTL_SECONDS = 15 * 60;

// Legacy long-lived TTL. Retained ONLY so signLegacyMedhaSession (used by the
// MCP dashboard-URL tool, which has no refresh channel) keeps working.
const LEGACY_TTL_SECONDS = 60 * 60 * 24 * 30;

function getSecret() {
  const secret = process.env.MEDHA_JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("MEDHA_JWT_SECRET missing or too short (need >= 32 chars)");
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

function mint({ personId, phone, sid, ttlSeconds, typ }) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    iss: "medha-id",
    sub: personId,
    phone,
    ...(sid ? { sid: String(sid) } : {}),
    ...(typ ? { typ } : {}),
    iat: now,
    exp: now + ttlSeconds,
  };
  const headerB64 = base64urlEncode(JSON.stringify(header));
  const payloadB64 = base64urlEncode(JSON.stringify(payload));
  const signature = sign(`${headerB64}.${payloadB64}`);
  return {
    token: `${headerB64}.${payloadB64}.${signature}`,
    expiresAt: payload.exp,
    expiresIn: ttlSeconds,
  };
}

/**
 * Issue a SHORT-LIVED access token bound to a device session.
 *
 * `sid` should be the device_sessions row id. It is optional only so that a
 * caller mid-migration still produces a working token; prefer always passing
 * it, because without it the token cannot be revoked before it expires.
 */
export function signMedhaAccessToken({ personId, phone, sid = null }) {
  if (!personId || !phone) {
    throw new Error("signMedhaAccessToken requires personId + phone");
  }
  return mint({
    personId,
    phone,
    sid,
    ttlSeconds: ACCESS_TTL_SECONDS,
    typ: "access",
  });
}

/**
 * Legacy 30-day token. Do not use for app sign-in — it cannot be revoked.
 *
 * Retained for src/mcp/tools/get-dashboard-url.js, which hands a bare URL to a
 * human out-of-band and has nowhere to store a refresh token. That surface
 * accepts the longer exposure knowingly.
 */
export function signLegacyMedhaSession({ personId, phone }) {
  if (!personId || !phone) {
    throw new Error("signLegacyMedhaSession requires personId + phone");
  }
  return mint({ personId, phone, ttlSeconds: LEGACY_TTL_SECONDS });
}

/**
 * @deprecated Use signMedhaAccessToken with a device session.
 * Kept as an alias so any straggling caller keeps compiling; it now issues a
 * SHORT-LIVED token, which is the safe default. A caller that genuinely needs
 * the long TTL must opt in explicitly via signLegacyMedhaSession.
 */
export function signMedhaSession({ personId, phone, sid = null }) {
  return signMedhaAccessToken({ personId, phone, sid });
}

/**
 * Verify and parse a session token. Returns null for any failure (bad
 * signature, expired, malformed): never throws.
 *
 * `sid` is null for legacy tokens minted before device sessions existed.
 */
export function verifyMedhaSession(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signature] = parts;
  let expected;
  try {
    expected = sign(`${headerB64}.${payloadB64}`);
  } catch {
    // getSecret() can throw if MEDHA_JWT_SECRET is missing; treat as no-auth.
    return null;
  }

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
  if (payload.iss !== "medha-id") return null;
  if (!reviewSessionAllowed(payload.phone)) return null;
  if (typeof payload.sub !== "string" || payload.sub.length === 0) return null;

  return {
    personId: payload.sub,
    phone: payload.phone,
    sid: typeof payload.sid === "string" ? payload.sid : null,
    issuedAt: payload.iat,
    expiresAt: payload.exp,
  };
}

/**
 * Extract a bearer token from the Authorization header. Returns the
 * verified session payload, or null if missing/invalid.
 */
export function verifyBearerFromRequest(request) {
  const auth = request?.headers?.authorization;
  if (!auth || typeof auth !== "string") return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  return verifyMedhaSession(m[1].trim());
}
