/**
 * GitHub OAuth init: mint the authorize URL the browser is redirected to.
 *
 * GitHub Classic OAuth Apps do not support PKCE on the web flow, so state
 * is the only CSRF defense. `state` is stored in pending_oauth keyed by
 * an HMAC of (did + platform + random) — see src/oauth/state.js for the
 * full rationale.
 *
 * `allow_signup=true` lets a logged-out browser create a GitHub account
 * mid-flow rather than dead-ending. `prompt` is not supported by GitHub
 * (unlike Google) — re-consent happens only when scopes change.
 */

import { generateState, storePending } from "../state.js";
import { GITHUB_SCOPES, buildScopeString } from "./scopes.js";
import { publicBaseUrl } from "../lib/public-url.js";

const AUTHORIZE_BASE = "https://github.com/login/oauth/authorize";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for GitHub OAuth`);
  }
  return value;
}

export function callbackUrl() {
  const base = publicBaseUrl();
  return `${base}/v1/oauth/github/callback`;
}

/**
 * Build the GitHub authorize URL for a given DID. Returns { url, state }.
 *
 * `returnTo` is the medha-frontend path to redirect to after the callback
 * completes (defaults to `/connect`). It round-trips through the pending-
 * oauth doc so the callback can hand off cleanly.
 */
export async function buildAuthorizeUrl(did, { returnTo = "/connect" } = {}) {
  if (!did || typeof did !== "string") {
    throw new Error("did is required to build GitHub authorize URL");
  }

  const clientId = requireEnv("GITHUB_OAUTH_CLIENT_ID");
  const state = generateState(did, "github");
  await storePending(state, did, "github", returnTo);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl(),
    scope: buildScopeString(GITHUB_SCOPES),
    state,
    allow_signup: "true",
  });

  return { url: `${AUTHORIZE_BASE}?${params.toString()}`, state };
}

export const __test__ = { callbackUrl };
