/**
 * SIGN IN WITH GOOGLE — id-token verification.
 *
 * The checking lives in lib/oidc-verify.js, shared with Apple, because the two
 * providers hand us the same object and two hand-rolled JWT verifiers in one
 * codebase is two places to fix a break. What is here is only what is actually
 * different about Google, and each of those differences has bitten somebody:
 *
 * TWO ISSUERS, NOT ONE. Google issues id tokens with `iss` of BOTH
 * "https://accounts.google.com" and the bare "accounts.google.com", and has for
 * years. Which one you get is not something you can rely on. An exact match
 * against a single string rejects a valid token from a real user, intermittently,
 * in a way that reproduces on nobody's device.
 *
 * THE AUDIENCE IS USUALLY NOT THE iOS CLIENT ID. This is the one that costs
 * people a day. Google Sign-In on iOS configured with a `serverClientID` issues
 * a token whose `aud` is the WEB client id, not the iOS one, because the token
 * is meant for your backend. Configured without it, `aud` is the iOS client id.
 * Both are legitimate, so both are accepted -- and they are separate env vars so
 * that setting one does not silently authorize the other.
 *
 * NO PRIVATE RELAY, BUT NO GUARANTEED EMAIL EITHER. Google has no equivalent of
 * Apple's Hide My Email, so isPrivateEmail is always false. What it does have is
 * `email_verified`, which is NOT always true: an unverified email on a Google
 * account is a claim about an address nobody proved. See below.
 *
 * UNLIKE APPLE, THE PROFILE COMES EVERY TIME. Apple sends email and name only on
 * the very first authorization, ever, which is why the Apple path goes to such
 * lengths to persist it. Google resends email, name and picture on every sign-in,
 * so there is no once-in-a-lifetime value to lose here.
 */

import { envList, verifyIdToken } from "./oidc-verify.js";

export const GOOGLE_ISSUERS = Object.freeze([
  "https://accounts.google.com",
  "accounts.google.com",
]);
export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";

/**
 * Every client id allowed to have issued a token we accept.
 *
 * Read at call time rather than at import, so a test or a redeploy can change it
 * without the module cache holding the old value.
 */
export function expectedAudiences() {
  return [
    ...envList("GOOGLE_IOS_CLIENT_ID"),
    ...envList("GOOGLE_SERVER_CLIENT_ID", "GOOGLE_WEB_CLIENT_ID", "GOOGLE_CLIENT_ID"),
  ];
}

/**
 * Verify a Google id token.
 *
 * @param {string} idToken
 * @param {{ rawNonce?: string|null, requireNonce?: boolean }} [opts]
 * @returns {Promise<{ ok: true, sub: string, email: string|null, emailVerified: boolean,
 *                     isPrivateEmail: false, name: string|null, hostedDomain: string|null,
 *                     aud: string }
 *                  | { ok: false, reason: string }>}
 */
export async function verifyGoogleIdToken(idToken, opts = {}) {
  const res = await verifyIdToken(
    idToken,
    { issuers: GOOGLE_ISSUERS, jwksUrl: GOOGLE_JWKS_URL, audiences: expectedAudiences() },
    opts,
  );
  if (!res.ok) return res;
  const p = res.payload;

  /**
   * AN UNVERIFIED EMAIL IS NOT AN EMAIL.
   *
   * `email_verified: false` means Google is passing along an address nobody
   * proved control of. Storing it as though it were verified is how an account
   * gets linked to a stranger later, when something downstream matches on email
   * and assumes the match means something. It is dropped here rather than
   * carried with a flag, because a flag is a thing every future caller has to
   * remember to check and exactly one of them will not.
   */
  const verified = p.email_verified === true || p.email_verified === "true";
  const email = verified && typeof p.email === "string" ? p.email.toLowerCase() : null;

  return {
    ok: true,
    sub: p.sub,
    email,
    emailVerified: verified && !!email,
    // Google has no Hide My Email. Named and hard-coded so the shape matches the
    // Apple result and no caller has to branch on which provider it came from.
    isPrivateEmail: false,
    name: typeof p.name === "string" && p.name.trim() ? p.name.trim() : null,
    // Workspace domain, when the account is on one. Not used for auth decisions;
    // useful later for "this is a work account".
    hostedDomain: typeof p.hd === "string" && p.hd.trim() ? p.hd.trim() : null,
    aud: res.aud,
  };
}
