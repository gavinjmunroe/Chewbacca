/**
 * THE APPLE LINK TICKET — a server-signed receipt for "we verified this Apple ID".
 *
 * THE ATTACK THIS EXISTS TO STOP. Sign-in with Apple is two requests: verify the
 * Apple token, then verify a phone OTP and attach the two. The second request has
 * to know WHICH Apple identity is being attached. The obvious implementation is to
 * return the Apple `sub` to the client after step one and take it back at step two
 * — and that is an account-takeover primitive. An Apple `sub` is not a secret; it
 * is an opaque id that any client can type. Anyone could POST somebody else's sub
 * with their own phone and OTP, and walk away owning that Apple ID's login.
 *
 * So step one returns a ticket instead: the verified sub, HMAC'd by the server,
 * with a short expiry. The client is a courier and cannot read or forge the cargo.
 *
 * DOMAIN SEPARATION, deliberately. The key here is DERIVED from MEDHA_JWT_SECRET
 * rather than being it. A ticket therefore cannot validate as a session token and a
 * session token cannot validate as a ticket, even though both are HMACs under the
 * same root secret. Reusing the raw secret for two token types is how a "confused
 * deputy" bug gets written six months from now by someone who assumes all our
 * tokens are interchangeable.
 */

import crypto from "node:crypto";

const TICKET_TTL_S = 10 * 60;
const INFO = "amber:apple-link-ticket:v1";

/** Providers that may issue a link ticket. */
export const TICKET_PROVIDERS = Object.freeze(["apple", "google"]);

function ticketKey() {
  const secret = process.env.MEDHA_JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("MEDHA_JWT_SECRET missing or too short (need >= 32 chars)");
  }
  // A derived subkey, not the secret itself. See DOMAIN SEPARATION above.
  return crypto.createHmac("sha256", secret).update(INFO).digest();
}

const b64 = (buf) => Buffer.from(buf).toString("base64url");

/**
 * @param {{ sub: string, email?: string|null, emailVerified?: boolean,
 *           isPrivateEmail?: boolean }} identity  — as returned by verifyAppleIdentityToken
 * @returns {{ ticket: string, expiresIn: number }}
 */
export function issueAppleTicket(identity) {
  return issueLinkTicket("apple", identity);
}

/**
 * A ticket bound to the provider that issued it.
 *
 * WHY THE PROVIDER IS IN THE PAYLOAD. Google sign-in redeems its ticket at a
 * different endpoint, against the same HMAC key. Without a provider field, a
 * ticket earned by verifying an APPLE token could be posted to the Google link
 * endpoint, and the server would happily write
 * (provider='google', subject=<an Apple sub>) into user_identities -- binding a
 * login nobody holds to an account, and poisoning the Google namespace with a
 * subject that will never legitimately appear in it. Domain separation between
 * providers costs one field and one comparison.
 *
 * v2, and v1 is still accepted as Apple. A ticket lives ten minutes; rejecting
 * v1 outright would fail sign-in for anybody mid-flow across the deploy, and
 * "apple" is the only thing v1 could ever have meant.
 */
export function issueLinkTicket(provider, identity) {
  if (!TICKET_PROVIDERS.includes(provider)) throw new Error(`unknown_ticket_provider:${provider}`);
  const payload = {
    v: 2,
    p: provider,
    sub: String(identity.sub),
    // Carried through because Apple will NOT send it again. If it is dropped here
    // the address is unrecoverable without the user revoking the app in Settings.
    email: identity.email ?? null,
    ev: identity.emailVerified === true,
    pe: identity.isPrivateEmail === true,
    exp: Math.floor(Date.now() / 1000) + TICKET_TTL_S,
  };
  const body = b64(JSON.stringify(payload));
  const sig = b64(crypto.createHmac("sha256", ticketKey()).update(body).digest());
  return { ticket: `${body}.${sig}`, expiresIn: TICKET_TTL_S };
}

/**
 * @returns {{ ok: true, sub: string, email: string|null, emailVerified: boolean,
 *             isPrivateEmail: boolean } | { ok: false, reason: string }}
 */
export function verifyAppleTicket(ticket) {
  return verifyLinkTicket("apple", ticket);
}

export function verifyLinkTicket(provider, ticket) {
  if (typeof ticket !== "string" || !ticket.includes(".")) {
    return { ok: false, reason: "malformed_ticket" };
  }
  const idx = ticket.lastIndexOf(".");
  const body = ticket.slice(0, idx);
  const sig = ticket.slice(idx + 1);

  let expected;
  try {
    expected = crypto.createHmac("sha256", ticketKey()).update(body).digest();
  } catch {
    return { ok: false, reason: "not_configured" };
  }
  let got;
  try {
    got = Buffer.from(sig, "base64url");
  } catch {
    return { ok: false, reason: "malformed_ticket" };
  }
  // Length check first: timingSafeEqual throws on a mismatch, and the length of an
  // HMAC is not a secret.
  if (got.length !== expected.length || !crypto.timingSafeEqual(expected, got)) {
    return { ok: false, reason: "bad_ticket" };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed_ticket" };
  }
  if (payload?.v !== 1 && payload?.v !== 2) return { ok: false, reason: "malformed_ticket" };
  if (typeof payload?.sub !== "string" || !payload.sub) {
    return { ok: false, reason: "malformed_ticket" };
  }
  // A v1 ticket predates provider binding and could only ever have been Apple.
  const issuedFor = payload.v === 2 ? payload.p : "apple";
  if (issuedFor !== provider) return { ok: false, reason: "wrong_provider" };
  // No skew allowance. Ten minutes is already generous for "type a code you were
  // just sent", and a link ticket is a credential.
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: "ticket_expired" };
  }
  return {
    ok: true,
    provider: issuedFor,
    sub: payload.sub,
    email: typeof payload.email === "string" ? payload.email : null,
    emailVerified: payload.ev === true,
    isPrivateEmail: payload.pe === true,
  };
}
