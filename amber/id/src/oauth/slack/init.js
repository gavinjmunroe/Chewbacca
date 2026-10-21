/**
 * Slack OAuth init: build the workspace-install authorize URL.
 *
 * Slack's OAuth v2 endpoint is https://slack.com/oauth/v2/authorize.
 * `scope=` carries bot scopes, `user_scope=` carries user scopes (empty
 * for the admin install). Slack does not support PKCE on this surface.
 */

import {
  SLACK_BOT_SCOPES,
  SLACK_USER_SCOPES,
  buildScopeString,
} from "./scopes.js";
import { generateState, storePending } from "../state.js";
import { publicBaseUrl, webBaseUrl } from "../lib/public-url.js";

const AUTHORIZE_BASE = "https://slack.com/oauth/v2/authorize";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for Slack OAuth`);
  }
  return value;
}

function callbackUrl() {
  const base = publicBaseUrl();
  return `${base}/v1/oauth/slack/callback`;
}

/**
 * Build the Slack authorize URL for the workspace admin install.
 * The state is HMAC-bound to (did, "slack") and stored in pending_oauth
 * so the callback can resolve it back to the installing admin's DID.
 *
 * `returnTo` is the medha-frontend URL the user should land on after
 * Slack redirects back through medha-id. Defaults to `${MEDHA_FRONTEND_URL}/connect`.
 */
export async function buildAuthorizeUrl(did, { returnTo } = {}) {
  if (!did || typeof did !== "string") {
    throw new Error("did is required to build Slack authorize URL");
  }
  const clientId = requireEnv("SLACK_OAUTH_CLIENT_ID");
  const frontendBase = webBaseUrl().replace(/\/+$/, "");
  const finalReturnTo = returnTo || `${frontendBase}/connect`;

  const state = generateState(did, "slack");
  await storePending(state, did, "slack", finalReturnTo);

  const params = new URLSearchParams({
    client_id: clientId,
    scope: buildScopeString(SLACK_BOT_SCOPES),
    user_scope: buildScopeString(SLACK_USER_SCOPES),
    redirect_uri: callbackUrl(),
    state,
  });

  return { url: `${AUTHORIZE_BASE}?${params.toString()}`, state };
}

export const __test__ = { callbackUrl };
