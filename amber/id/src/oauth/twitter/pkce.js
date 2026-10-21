/**
 * PKCE (RFC 7636) primitives for the Twitter OAuth 2.0 flow.
 *
 * Twitter's OAuth 2.0 implementation requires PKCE for all authorization-code
 * flows: the client generates a random `code_verifier` per request, derives
 * `code_challenge = base64url(sha256(code_verifier))`, sends the challenge
 * to the authorize endpoint, and presents the original verifier when
 * exchanging the auth code for tokens.
 *
 * The verifier MUST be stored server-side, indexed by the `state` value
 * that round-trips through the user's browser, so that the callback
 * handler can retrieve it without the browser ever holding it.
 */

import { randomBytes, createHash } from "crypto";

/** base64url (no padding, URL-safe) per RFC 4648 §5. */
function base64url(buf) {
  return buf
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/**
 * Generate a fresh PKCE pair.
 *
 *   verifier   — 43-128 char URL-safe random string (RFC 7636 §4.1)
 *   challenge  — base64url(sha256(verifier))
 *   method     — always "S256" (Twitter does not accept "plain")
 *
 * Returns { codeVerifier, codeChallenge, codeChallengeMethod }.
 */
export function generatePkcePair() {
  // 32 random bytes -> 43-char base64url string, well within the 43-128 range.
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(
    createHash("sha256").update(codeVerifier).digest(),
  );
  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: "S256",
  };
}
