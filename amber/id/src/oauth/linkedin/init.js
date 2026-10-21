/**
 * LinkedIn OAuth init - build the authorize URL the browser is sent to.
 *
 * Depends on Tab 1.1 (src/oauth/state.js + src/db/pending-oauth.js) to
 * persist a state token bound to the requester's DID for 10 minutes. The
 * callback handler verifies the state before exchanging the auth code.
 */

import { generateState, storePending } from "../state.js";
import { LINKEDIN_AUTHORIZE_URL, LINKEDIN_SCOPES } from "./scopes.js";
import { publicBaseUrl } from "../lib/public-url.js";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required for LinkedIn OAuth`);
  return v;
}

export function getRedirectUri() {
  const base = publicBaseUrl();
  return `${base}/v1/oauth/linkedin/callback`;
}

/**
 * Build the LinkedIn authorize URL for a given DID.
 *
 * @param {string} did - The Privy/amber DID of the requesting user.
 * @param {object} [opts]
 * @param {string} [opts.returnTo] - Path on medha-frontend to land on after
 *   the callback completes. Defaults to "/connect".
 * @returns {Promise<{ url: string, state: string }>}
 */
export async function buildAuthorizeUrl(did, { returnTo = "/connect" } = {}) {
  if (!did || typeof did !== "string") {
    throw new Error("did is required");
  }
  const clientId = requireEnv("LINKEDIN_OAUTH_CLIENT_ID");
  const redirectUri = getRedirectUri();

  const state = generateState(did, "linkedin");
  await storePending(state, did, "linkedin", returnTo);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    scope: LINKEDIN_SCOPES.join(" "),
  });

  return {
    url: `${LINKEDIN_AUTHORIZE_URL}?${params.toString()}`,
    state,
  };
}
