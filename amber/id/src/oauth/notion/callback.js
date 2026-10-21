/**
 * Notion OAuth — code exchange + token storage.
 *
 * Notion's token endpoint authenticates with HTTP Basic auth
 * (client_id:client_secret base64) and accepts JSON. The response carries a
 * long-lived access_token plus workspace metadata; Notion does NOT issue
 * refresh tokens — tokens remain valid until the user disconnects the
 * integration from their workspace settings, at which point API calls return
 * 401 and the user must reconnect.
 *
 * Stored secrets bag keys (DID-scoped, AES-GCM encrypted by db/secrets.js):
 *   NOTION_OAUTH_ACCESS              long-lived bearer token
 *   NOTION_OAUTH_BOT_ID              bot identity for the integration
 *   NOTION_OAUTH_WORKSPACE_ID        which workspace was authorized
 *   NOTION_OAUTH_WORKSPACE_NAME      human-readable workspace name (the
 *                                    "Connected as <workspace>" pill on
 *                                    /connect reads this; key name must
 *                                    match the accountKey in connections.js
 *                                    and connections-discovery.js)
 *   NOTION_OAUTH_WORKSPACE_ICON      optional icon URL/emoji
 *   NOTION_OAUTH_OWNER_KIND          "user" or "workspace"
 *   NOTION_OAUTH_OWNER_ID            if owner.type === "user", the user id
 *   NOTION_OAUTH_CONNECTED_AT        ISO timestamp of successful exchange
 *
 * No NOTION_OAUTH_REFRESH / NOTION_OAUTH_EXPIRES_AT keys are written because
 * Notion does not return them. Tab 1.8's connection-status check should treat
 * a present NOTION_OAUTH_ACCESS as "connected".
 */

import { setSecrets, deleteSecrets } from "../../db/secrets.js";
import { getRedirectUri } from "./init.js";

const NOTION_TOKEN_URL = "https://api.notion.com/v1/oauth/token";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing_env:${name}`);
  }
  return value;
}

/**
 * Exchange an authorization code for an access token.
 * @param {string} code   The code parameter from the OAuth callback
 * @returns {Promise<object>} Raw Notion token response
 */
export async function exchangeCode(code) {
  if (!code || typeof code !== "string") {
    throw new Error("code_required");
  }

  const clientId = requireEnv("NOTION_OAUTH_CLIENT_ID");
  const clientSecret = requireEnv("NOTION_OAUTH_CLIENT_SECRET");
  const redirectUri = getRedirectUri();

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch(NOTION_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Basic ${basic}`,
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
    // Fail fast on a stalled Notion token endpoint; an AbortError propagates
    // to the callback route's try/catch, which redirects to failure.
    signal: AbortSignal.timeout(
      Number(process.env.NOTION_OAUTH_TIMEOUT_MS) || 10000,
    ),
  });

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`notion_token_invalid_json:${response.status}`);
  }

  if (!response.ok) {
    const reason =
      payload?.error || payload?.message || `http_${response.status}`;
    throw new Error(`notion_token_exchange_failed:${reason}`);
  }

  if (!payload.access_token) {
    throw new Error("notion_token_missing_access_token");
  }

  return payload;
}

/**
 * Persist Notion tokens for a DID. Idempotent — replaces prior values.
 * @param {string} did     Privy DID
 * @param {object} tokens  Raw Notion token response from exchangeCode
 */
export async function storeTokens(did, tokens) {
  if (!did || typeof did !== "string") {
    throw new Error("did_required");
  }
  if (!tokens || typeof tokens !== "object") {
    throw new Error("tokens_required");
  }

  const owner = tokens.owner || {};
  const ownerKind = owner.type || null;
  const ownerId = ownerKind === "user" && owner.user?.id ? owner.user.id : null;

  await setSecrets(
    did,
    {
      NOTION_OAUTH_ACCESS: tokens.access_token,
      NOTION_OAUTH_BOT_ID: tokens.bot_id || null,
      NOTION_OAUTH_WORKSPACE_ID: tokens.workspace_id || null,
      NOTION_OAUTH_WORKSPACE_NAME: tokens.workspace_name || null,
      NOTION_OAUTH_WORKSPACE_ICON: tokens.workspace_icon || null,
      NOTION_OAUTH_OWNER_KIND: ownerKind,
      NOTION_OAUTH_OWNER_ID: ownerId,
      NOTION_OAUTH_CONNECTED_AT: new Date().toISOString(),
      // OAuth client credentials mirrored so downstream consumers (which
      // need them for the HTTP Basic header on the token endpoint) don't
      // depend on process.env resolving on every host that reads the bag.
      NOTION_OAUTH_CLIENT_ID: process.env.NOTION_OAUTH_CLIENT_ID || null,
      NOTION_OAUTH_CLIENT_SECRET:
        process.env.NOTION_OAUTH_CLIENT_SECRET || null,
    },
    { updatedBy: "oauth:notion" },
  );
}

/**
 * Remove Notion OAuth secrets for a DID. Does not call any Notion revoke
 * endpoint because Notion has no public revocation API — disconnection is
 * done by the user inside their Notion workspace settings. We delete our
 * tokens so subsequent calls treat the user as disconnected.
 */
export async function clearTokens(did) {
  if (!did || typeof did !== "string") {
    throw new Error("did_required");
  }
  await deleteSecrets(did, [
    "NOTION_OAUTH_ACCESS",
    "NOTION_OAUTH_BOT_ID",
    "NOTION_OAUTH_WORKSPACE_ID",
    "NOTION_OAUTH_WORKSPACE_NAME",
    "NOTION_OAUTH_WORKSPACE_ICON",
    "NOTION_OAUTH_OWNER_KIND",
    "NOTION_OAUTH_OWNER_ID",
    "NOTION_OAUTH_CONNECTED_AT",
    "NOTION_OAUTH_CLIENT_ID",
    "NOTION_OAUTH_CLIENT_SECRET",
    "NOTION_WORKSPACE_ID",
    "NOTION_WORKSPACE_NAME",
    "NOTION_WORKSPACE_ICON",
  ]);
}
