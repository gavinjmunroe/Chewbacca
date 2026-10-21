/**
 * Notion OAuth — authorize URL builder.
 *
 * Notion uses standard OAuth 2.0. The owner=user variant is used so the
 * installation is scoped to the user's personal workspace selection at consent
 * time (Notion presents a workspace picker as part of the consent screen).
 *
 * Token endpoint specifics live in callback.js; this file only assembles the
 * authorize URL and registers a pending-OAuth row so the callback can verify
 * the state parameter on return.
 */

import { generateState, storePending } from "../state.js";
import { publicBaseUrl } from "../lib/public-url.js";

const NOTION_AUTHORIZE_URL = "https://api.notion.com/v1/oauth/authorize";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing_env:${name}`);
  }
  return value;
}

export function getRedirectUri() {
  const base = publicBaseUrl();
  return `${base}/v1/oauth/notion/callback`;
}

/**
 * Build the Notion authorize URL for a given DID. Persists a pending-OAuth
 * row keyed by state so the callback can resolve the originating user.
 *
 * @param {string} did   Privy DID of the caller
 * @param {string} [returnTo]  Optional medha-frontend path to bounce back to
 * @returns {Promise<{ url: string, state: string }>}
 */
export async function buildAuthorizeUrl(did, returnTo) {
  if (!did || typeof did !== "string") {
    throw new Error("did_required");
  }

  const clientId = requireEnv("NOTION_OAUTH_CLIENT_ID");
  const redirectUri = getRedirectUri();
  const state = generateState(did, "notion");
  await storePending(state, did, "notion", returnTo || null);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    owner: "user",
    redirect_uri: redirectUri,
    state,
  });

  return {
    url: `${NOTION_AUTHORIZE_URL}?${params.toString()}`,
    state,
  };
}
