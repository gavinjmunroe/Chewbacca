/**
 * Twitter OAuth 2.0 init: build the authorize URL and persist the
 * per-request state + PKCE verifier so the callback can finish the flow.
 *
 * Depends on Tab 1.1 (`src/oauth/state.js` + `src/db/pending-oauth.js`).
 * The contract this module relies on:
 *
 *   generateState(did, platform) -> string
 *   storePending(state, did, platform, returnTo, extra?) -> Promise<void>
 *
 * The optional `extra` argument carries `{ codeVerifier }`, which the
 * callback reads back out of pending_oauth to redeem the auth code.
 */

import { generateState, storePending } from "../state.js";
import { generatePkcePair } from "./pkce.js";
import { TWITTER_AUTHORIZE_URL, TWITTER_SCOPE_STRING } from "./scopes.js";
import { publicBaseUrl } from "../lib/public-url.js";

const PLATFORM = "twitter";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var: ${name}`);
  return v;
}

/**
 * Build the URL we redirect the user's browser to.
 *
 * @param {string} did       Privy DID of the authenticated user
 * @param {string} [returnTo] Frontend path to bounce back to after callback
 *                            (defaults to /connect)
 * @returns {Promise<{ url: string, state: string }>}
 */
export async function buildAuthorizeUrl(did, returnTo = "/connect") {
  if (!did || typeof did !== "string") {
    throw new Error("did is required");
  }

  const clientId = requireEnv("TWITTER_OAUTH_CLIENT_ID");
  const publicUrl = publicBaseUrl();
  const redirectUri = `${publicUrl}/v1/oauth/twitter/callback`;

  const state = generateState(did, PLATFORM);
  const { codeVerifier, codeChallenge, codeChallengeMethod } =
    generatePkcePair();

  await storePending(state, did, PLATFORM, returnTo, { codeVerifier });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: TWITTER_SCOPE_STRING,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
  });

  return {
    url: `${TWITTER_AUTHORIZE_URL}?${params.toString()}`,
    state,
  };
}
