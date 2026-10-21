/**
 * Railway OAuth 2.0 init: build the authorize URL and persist the
 * per-request state + PKCE verifier so the callback can finish the
 * flow.
 *
 * Railway requires PKCE with S256 (only `S256` listed in
 * code_challenge_methods_supported on the discovery document). We
 * generate a fresh code_verifier per init call, derive the challenge
 * as base64url(sha256(verifier)), send the challenge to the authorize
 * endpoint, and stash the verifier in pending_oauth (keyed by state)
 * for the callback to read back.
 */

import { randomBytes, createHash } from "node:crypto";
import { generateState, storePending } from "../state.js";
import {
  RAILWAY_SCOPES,
  buildScopeString,
  RAILWAY_AUTHORIZE_URL,
} from "./scopes.js";
import { publicBaseUrl } from "../lib/public-url.js";

const PLATFORM = "railway";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var: ${name}`);
  return v;
}

function base64url(buf) {
  return buf
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/**
 * Fresh PKCE pair per RFC 7636. 32 random bytes -> 43-char URL-safe
 * verifier (within the 43-128 char range Railway accepts). Challenge
 * is the S256 hash; Railway does not accept "plain".
 */
function generatePkcePair() {
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(
    createHash("sha256").update(codeVerifier).digest(),
  );
  return { codeVerifier, codeChallenge, codeChallengeMethod: "S256" };
}

export function callbackUrl() {
  const base = publicBaseUrl();
  return `${base}/v1/oauth/railway/callback`;
}

/**
 * Build the Railway authorize URL for a given DID. Returns
 * { url, state }. `returnTo` is the medha-frontend path to redirect
 * to after the callback completes (defaults to `/connect`).
 *
 * The PKCE code_verifier is persisted in pending_oauth's `extra`
 * field so the callback can pull it back out at exchange time. The
 * verifier never enters the browser — it lives server-side from
 * generation to exchange.
 */
export async function buildAuthorizeUrl(did, { returnTo = "/connect" } = {}) {
  if (!did || typeof did !== "string") {
    throw new Error("did is required to build Railway authorize URL");
  }

  const clientId = requireEnv("RAILWAY_OAUTH_CLIENT_ID");
  const redirectUri = callbackUrl();

  const state = generateState(did, PLATFORM);
  const { codeVerifier, codeChallenge, codeChallengeMethod } =
    generatePkcePair();

  await storePending(state, did, PLATFORM, returnTo, { codeVerifier });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: buildScopeString(RAILWAY_SCOPES),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
  });

  return {
    url: `${RAILWAY_AUTHORIZE_URL}?${params.toString()}`,
    state,
  };
}

export const __test__ = { callbackUrl, generatePkcePair };
