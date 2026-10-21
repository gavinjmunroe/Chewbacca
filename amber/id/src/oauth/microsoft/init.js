/**
 * Build the Microsoft OAuth authorize URL for a given Privy DID.
 *
 * Uses the Azure AD v2.0 common endpoint so the same app supports both
 * personal Microsoft accounts and any AAD tenant. The state token is
 * generated + persisted via the Tab 1.1 helper so the callback can
 * verify the round-trip and resolve back to a DID.
 *
 * Env required:
 *   MS_OAUTH_CLIENT_ID       Azure AD application (client) ID
 *   MEDHA_ID_PUBLIC_URL      Public base URL of amber-id (for redirect_uri)
 */

import { generateState, storePending } from "../state.js";
import { MICROSOFT_SCOPES, MICROSOFT_AUTHORIZE_URL } from "./scopes.js";
import { microsoftRedirectUri } from "./urls.js";

const PLATFORM = "microsoft";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing_env:${name}`);
  return value;
}

/**
 * Generate state + write the pending record + assemble the authorize URL.
 * `returnTo` controls where the callback redirects after success (optional).
 */
export async function buildAuthorizeUrl(did, { returnTo } = {}) {
  const clientId = requireEnv("MS_OAUTH_CLIENT_ID");
  const redirectUri = microsoftRedirectUri();

  const state = generateState(did, PLATFORM);
  await storePending(state, did, PLATFORM, returnTo || null);

  return {
    url: `${MICROSOFT_AUTHORIZE_URL}?${authorizeParams({
      clientId,
      redirectUri,
      state,
    }).toString()}`,
    state,
  };
}

/**
 * The query the authorize URL carries, WITHOUT the database.
 *
 * Same lift as the Google side, for the same reason: buildAuthorizeUrl writes a
 * pending-oauth row first, so nothing about the URL could be asserted without
 * Cloud SQL and nothing was.
 */
export function authorizeParams({ clientId, redirectUri, state }) {
  return new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: MICROSOFT_SCOPES.join(" "),
    state,
    /**
     * SELECT_ACCOUNT, SO A SECOND OUTLOOK IS POSSIBLE AT ALL.
     *
     * `consent` alone re-consents whoever is already signed in to Microsoft in
     * that browser and hands back the SAME address, so "Add an Outlook account"
     * quietly reconnected the existing one and the list never grew. Microsoft
     * takes ONE prompt value, unlike Google which takes a space separated list,
     * and the refresh token comes from the offline_access scope rather than
     * from the prompt -- so choosing the account costs nothing.
     */
    prompt: "select_account",
  });
}
