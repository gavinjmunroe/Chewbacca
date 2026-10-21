/**
 * ONE OIDC ID-TOKEN VERIFIER, because two of them would drift.
 *
 * Sign in with Apple and Sign in with Google hand the app the same object: an
 * RS256 JWT signed by a key published at a well-known JWKS URL. Everything the
 * service does afterwards trusts the `sub` inside it, which makes this the only
 * thing standing between "signed in as you" and "signed in as anyone".
 *
 * The Apple verifier was written first and is correct. Copying it for Google
 * would have been the fast move and the wrong one: two hand-rolled JWT verifiers
 * in one codebase is two places to fix a break, and the second one is always the
 * one somebody forgets. The provider-specific parts turn out to be four values
 * -- issuers, JWKS URL, audiences, and what the profile claims are called --
 * so they are parameters and the checking is shared.
 *
 * NO JWT LIBRARY, matching the rest of this service: node imports a JWK and
 * verifies RS256 natively, and medha-jwt.js already hand-rolls HS256. Adding a
 * dependency to the most security-critical path in the app for no capability is
 * supply-chain surface we do not need.
 *
 * WHAT IS CHECKED, and why each one is load-bearing:
 *
 *   alg === RS256      Algorithm confusion is the classic JWT break. `none`
 *                      verifies against nothing; `HS256` would be verified with
 *                      the provider's PUBLIC key as an HMAC secret, and that key
 *                      is public. The allow-list IS the attack surface.
 *   kid -> JWKS        Providers rotate. An unseen kid forces exactly one
 *                      refetch, so rotation heals without letting an attacker
 *                      spin the cache with junk kids.
 *   signature          Over the exact `header.payload` bytes AS RECEIVED. Never
 *                      re-serialize the payload first; you would be verifying a
 *                      different string than the one that was signed.
 *   iss                Exact match against a short allow-list. Google is the
 *                      reason it is a list rather than a string: it issues both
 *                      `https://accounts.google.com` and the bare
 *                      `accounts.google.com`, and has for years.
 *   aud                Must be OUR client id. Without it, a token issued to ANY
 *                      other app the user has signed into with that provider
 *                      would authenticate them here. This is the single most
 *                      important check in the file after the signature.
 *   exp / iat          Small skew allowance; iat rejected if meaningfully future.
 *   nonce              Replay defense. A token captured from another session
 *                      carries the wrong nonce.
 *
 * NOTHING THE CLIENT SAYS ABOUT ITSELF IS TRUSTED. The caller passes a token and
 * a raw nonce and gets back only what the provider signed.
 */

import crypto from "node:crypto";

const CLOCK_SKEW_S = 120;
// Keys are stable for long periods; an hour keeps us off their endpoint without
// making a rotation take a deploy to pick up.
const JWKS_TTL_MS = 60 * 60 * 1000;

/**
 * One cache per JWKS URL.
 *
 * Keyed by URL rather than one shared cache, because Apple's keys must never be
 * consulted for a Google token: a kid collision across providers is astronomically
 * unlikely, and "astronomically unlikely" is not the standard for the function
 * that decides who you are.
 */
const caches = new Map();

function cacheFor(url) {
  if (!caches.has(url)) caches.set(url, { keys: [], fetchedAt: 0 });
  return caches.get(url);
}

export function b64urlToBuf(s) {
  return Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");
}
function b64urlToJson(s) {
  return JSON.parse(b64urlToBuf(s).toString("utf8"));
}

async function fetchJwks(url) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!resp.ok) throw new Error(`jwks_http_${resp.status}`);
  const body = await resp.json();
  if (!Array.isArray(body?.keys) || body.keys.length === 0) throw new Error("jwks_empty");
  caches.set(url, { keys: body.keys, fetchedAt: Date.now() });
  return body.keys;
}

async function getKeys(url, { force = false } = {}) {
  const cache = cacheFor(url);
  const fresh = Date.now() - cache.fetchedAt < JWKS_TTL_MS;
  if (!force && fresh && cache.keys.length) return cache.keys;
  try {
    return await fetchJwks(url);
  } catch (err) {
    // A stale key still verifies tokens signed before the rotation, so serving it
    // beats failing every sign-in because the provider's endpoint blipped.
    if (cache.keys.length) return cache.keys;
    throw err;
  }
}

/** Test seam: seed or drop the cache for one JWKS URL. */
export function _setJwksForTests(url, keys = null) {
  if (keys) caches.set(url, { keys, fetchedAt: Date.now() });
  else caches.delete(url);
}

/**
 * Does `claim` correspond to `raw`?
 *
 * Providers echo the nonce string they were given, verbatim. WHICH string that
 * is depends on the client: the widely-copied Firebase recipe hashes the random
 * value before handing it over and sends the raw one to the server, while other
 * clients pass the raw value straight through. All three forms below require
 * possession of the raw nonce, so accepting any of them costs nothing and
 * removes an entire class of "works on my client" breakage.
 */
export function nonceMatches(claim, raw) {
  if (!claim || !raw) return false;
  const sha = crypto.createHash("sha256").update(String(raw)).digest();
  const candidates = [String(raw), sha.toString("hex"), sha.toString("base64url")];
  const got = Buffer.from(String(claim), "utf8");
  return candidates.some((c) => {
    const want = Buffer.from(c, "utf8");
    return want.length === got.length && crypto.timingSafeEqual(want, got);
  });
}

/**
 * Verify an OIDC id token.
 *
 * @param {string} idToken
 * @param {{ issuers: string[], jwksUrl: string, audiences: string[] }} provider
 * @param {{ rawNonce?: string|null, requireNonce?: boolean }} [opts]
 * @returns {Promise<{ ok: true, payload: object, aud: string }
 *                  | { ok: false, reason: string }>}
 */
export async function verifyIdToken(idToken, provider, opts = {}) {
  const { rawNonce = null, requireNonce = true } = opts;
  const { issuers = [], jwksUrl, audiences = [] } = provider || {};

  if (typeof idToken !== "string" || idToken.length < 40) {
    return { ok: false, reason: "malformed_token" };
  }
  const parts = idToken.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed_token" };

  let header;
  let payload;
  try {
    header = b64urlToJson(parts[0]);
    payload = b64urlToJson(parts[1]);
  } catch {
    return { ok: false, reason: "malformed_token" };
  }

  // The allow-list, before anything touches a key.
  if (header?.alg !== "RS256") return { ok: false, reason: "bad_alg" };
  if (!header?.kid) return { ok: false, reason: "no_kid" };

  // NO AUDIENCES CONFIGURED IS A REFUSAL, not an empty allow-list that passes.
  // An unset env var must never widen who can sign in; it must stop sign-in.
  if (!Array.isArray(audiences) || audiences.length === 0) {
    return { ok: false, reason: "not_configured" };
  }

  let keys = await getKeys(jwksUrl).catch(() => null);
  if (!keys) return { ok: false, reason: "jwks_unavailable" };
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    // Unknown kid: the provider probably rotated. Exactly one forced refetch.
    keys = await getKeys(jwksUrl, { force: true }).catch(() => null);
    jwk = keys?.find((k) => k.kid === header.kid);
  }
  if (!jwk) return { ok: false, reason: "unknown_kid" };

  let publicKey;
  try {
    publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
  } catch {
    return { ok: false, reason: "bad_jwk" };
  }

  const signed = Buffer.from(`${parts[0]}.${parts[1]}`, "utf8");
  let sigOk = false;
  try {
    sigOk = crypto.verify("RSA-SHA256", signed, publicKey, b64urlToBuf(parts[2]));
  } catch {
    sigOk = false;
  }
  if (!sigOk) return { ok: false, reason: "bad_signature" };

  if (!issuers.includes(payload?.iss)) return { ok: false, reason: "bad_iss" };

  const tokenAud = Array.isArray(payload?.aud) ? payload.aud : [payload?.aud];
  const matchedAud = tokenAud.find((a) => audiences.includes(a));
  if (!matchedAud) return { ok: false, reason: "bad_aud" };

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload?.exp !== "number" || payload.exp + CLOCK_SKEW_S < now) {
    return { ok: false, reason: "expired" };
  }
  if (typeof payload?.iat === "number" && payload.iat - CLOCK_SKEW_S > now) {
    return { ok: false, reason: "issued_in_future" };
  }

  if (requireNonce || payload?.nonce) {
    if (!nonceMatches(payload?.nonce, rawNonce)) return { ok: false, reason: "bad_nonce" };
  }

  if (typeof payload?.sub !== "string" || !payload.sub) return { ok: false, reason: "no_sub" };

  return { ok: true, payload, aud: matchedAud };
}

/** Split a comma-separated env var into a list. Empty means empty, never [""]. */
export function envList(...names) {
  for (const n of names) {
    const raw = process.env[n];
    if (!raw) continue;
    const out = String(raw)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (out.length) return out;
  }
  return [];
}
