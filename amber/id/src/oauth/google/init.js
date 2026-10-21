/**
 * Google OAuth init: build the authorize URL the browser is redirected to.
 *
 * Caller flow:
 *   1. Frontend POST /v1/oauth/google/init (JWT-gated)
 *   2. This module mints a state token via Tab 1.1's pending-oauth store
 *      and returns the Google authorize URL
 *   3. Frontend window.location.href = authorize_url
 *
 * Tab 1.1 owns generateState + storePending and ships on a separate PR;
 * the imports below resolve once both PRs are merged.
 */

import { generateState, storePending } from "./../state.js";
import {
  GOOGLE_SCOPES,
  GOOGLE_CALENDAR_SCOPES,
  GOOGLE_RELATIONSHIP_SCOPES,
} from "./scopes.js";
import { publicBaseUrl } from "../lib/public-url.js";

const GOOGLE_AUTHORIZE_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    throw new Error(`google_oauth_env_missing:${name}`);
  }
  return v;
}

export function callbackUrl() {
  const base = publicBaseUrl();
  return `${base}/v1/oauth/google/callback`;
}

/**
 * Build the Google authorize URL for a given DID. Returns { url, state }.
 *
 * `returnTo` is the medha-frontend path to redirect to after the callback
 * completes (defaults to /connect). It round-trips through the pending-oauth
 * doc so the callback can hand off cleanly.
 *
 * `access_type=offline` + `prompt=consent` is required to receive a refresh
 * token on every consent (Google omits refresh_token if the user has already
 * granted the same scopes without explicit re-consent).
 *
 * AND `select_account`, WITHOUT WHICH THERE IS ONLY EVER ONE ACCOUNT.
 *
 *   "It should show me Google logins so I can log into multiple calendars...
 *    you should have the option to add another Google account."
 *
 * `prompt=consent` alone re-consents whoever is already signed in to Google in
 * that browser and returns to the app with the SAME address it already had, so
 * "Add a Google account" quietly reconnected the existing one and the list never
 * grew. The server has been able to hold several accounts since migration 046 --
 * calendar_accounts is keyed on (owner, provider, account_email) -- so the last
 * thing standing between the user and their work calendar was one missing word
 * in this URL. Both prompts, space separated: choose WHO, then consent as them.
 */
export async function buildAuthorizeUrl(
  did,
  { returnTo = "/connect", purpose } = {},
) {
  if (!did || typeof did !== "string") {
    throw new Error("buildAuthorizeUrl requires a DID string");
  }

  const clientId = requireEnv("GOOGLE_OAUTH_CLIENT_ID");
  const state = generateState(did, "google");
  await storePending(state, did, "google", returnTo);

  return {
    url: `${GOOGLE_AUTHORIZE_ENDPOINT}?${authorizeParams({
      clientId,
      redirectUri: callbackUrl(),
      state,
      purpose,
    }).toString()}`,
    state,
  };
}

/**
 * The query the authorize URL carries, WITHOUT the database.
 *
 * Lifted out of buildAuthorizeUrl so it can be tested at all: that function
 * writes a pending-oauth row before it builds anything, so every assertion
 * about the URL used to need Cloud SQL and there were none. The parameters here
 * are the whole contract with Google, and one of them being wrong is the
 * difference between adding an account and silently reconnecting the old one.
 */
export function authorizeParams({ clientId, redirectUri, state, purpose }) {
  return new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    // A refresh token, every time, rather than only on the first consent.
    access_type: "offline",
    // WHO first, then consent as them. See the note above buildAuthorizeUrl.
    prompt: "select_account consent",
    include_granted_scopes: "true",
    scope: (purpose === "calendar"
      ? GOOGLE_CALENDAR_SCOPES
      : purpose === "relationships"
        ? GOOGLE_RELATIONSHIP_SCOPES
        : GOOGLE_SCOPES
    ).join(" "),
    state,
  });
}
