/**
 * SIGN IN WITH APPLE — identity-token verification.
 *
 * Apple hands the app a signed JWT. Everything downstream trusts the `sub` in it,
 * so this file is the only thing standing between "signed in as you" and "signed in
 * as anyone". The CHECKING now lives in lib/oidc-verify.js, shared with
 * Google: the two providers hand us the same object, and two hand-rolled JWT
 * verifiers in one codebase is two places to fix a break -- the second of which
 * is always the one somebody forgets. Every check this file used to perform is
 * performed there, unchanged, and the fifteen tests below moved across untouched
 * as the proof of that.
 *
 * What stays here is what is actually Apple: its issuer, its JWKS URL, its bundle
 * ids, and its two claims nobody else has.
 *
 * WHAT IS CHECKED, and why each one matters:
 *
 *   alg === RS256      Algorithm confusion is the classic JWT break. A token whose
 *                      header says "none" verifies against nothing, and one that
 *                      says HS256 would be verified with Apple's PUBLIC key as an
 *                      HMAC secret — which is public. The allow-list is not a
 *                      formality; it is the attack.
 *   kid -> JWKS        Apple rotates signing keys. A kid we have never seen forces
 *                      exactly one refetch, so rotation heals itself without
 *                      letting an attacker spin the cache with junk kids.
 *   signature          Over the exact `header.payload` bytes as received. Never
 *                      re-serialize the payload before verifying.
 *   iss                Must be literally https://appleid.apple.com.
 *   aud                Must be OUR bundle id. Without this, an identity token
 *                      issued to a DIFFERENT app — any app the user has signed into
 *                      with Apple — would authenticate them here.
 *   exp / iat          With a small skew allowance, and iat is rejected if it is in
 *                      the future by more than the skew.
 *   nonce              Replay defense: the client generates a random value, sends
 *                      it to Apple, and sends the raw value here separately. A
 *                      token captured from another session has the wrong nonce.
 *
 * WHAT IS DELIBERATELY NOT TRUSTED: anything the client says about who they are.
 * The caller passes the token and the raw nonce, and gets back only what Apple
 * signed.
 *
 * EMAIL AND NAME ARE FIRST-AUTHORIZATION-ONLY. Apple includes `email` in the token
 * only the first time a given Apple ID authorizes this app, ever. Miss it and it is
 * gone until the user revokes Amber in iOS Settings and signs in again. Whatever
 * calls this MUST persist a non-null email the first time it sees one.
 */

import { envList, verifyIdToken, _setJwksForTests } from "./oidc-verify.js";

const APPLE_ISS = "https://appleid.apple.com";
const APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys";

/** Every bundle id allowed to have issued a token we accept. */
export function expectedAudiences() {
  const fromEnv = envList("APPLE_BUNDLE_IDS", "APPLE_BUNDLE_ID");
  return fromEnv.length ? fromEnv : ["com.joinrytual.amber"];
}

/** Test seam: drop or seed Apple's key cache. Same signature as before. */
export function _resetJwksCacheForTests(keys = null) {
  _setJwksForTests(APPLE_JWKS_URL, keys);
}

/**
 * Verify an Apple identity token.
 *
 * @param {string} identityToken  the JWT from ASAuthorizationAppleIDCredential
 * @param {{ rawNonce?: string, requireNonce?: boolean }} [opts]
 * @returns {Promise<{ ok: true, sub: string, email: string|null, emailVerified: boolean,
 *                     isPrivateEmail: boolean, aud: string }
 *                  | { ok: false, reason: string }>}
 */
export async function verifyAppleIdentityToken(identityToken, opts = {}) {
  const res = await verifyIdToken(
    identityToken,
    { issuers: [APPLE_ISS], jwksUrl: APPLE_JWKS_URL, audiences: expectedAudiences() },
    opts,
  );
  if (!res.ok) return res;
  const payload = res.payload;
  return {
    ok: true,
    sub: payload.sub,
    // Present only on the FIRST authorization for this Apple ID. See the header.
    email: typeof payload.email === "string" ? payload.email.toLowerCase() : null,
    emailVerified: payload.email_verified === true || payload.email_verified === "true",
    isPrivateEmail: payload.is_private_email === true || payload.is_private_email === "true",
    aud: res.aud,
  };
}
