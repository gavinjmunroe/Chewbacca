/**
 * Slack OAuth callback — dual-token persistence.
 *
 * Slack's oauth.v2.access response carries:
 *   - access_token (xoxb-)            workspace-shared bot token
 *   - authed_user.access_token (xoxp-) installing user's token
 *   - team.{id,name}                  workspace identity
 *   - authed_user.{id,scope}          user identity + granted user scopes
 *
 * One consent populates BOTH the SLACK_WORKSPACE_* keys (bot, team-wide
 * reads) and the SLACK_USER_* keys (per-user agent actions). The user
 * token is what /v1/me/connections uses as the presenceKey, so a stale
 * legacy admin install that only has SLACK_WORKSPACE_TOKEN will read as
 * "disconnected" until the user re-consents and we capture their xoxp.
 *
 * Slack does not issue refresh tokens by default; bot + user tokens are
 * long-lived. If token rotation is enabled on the app later, refresh
 * logic lands in this file.
 */

import { setSecrets } from "../../db/secrets.js";
import { publicBaseUrl } from "../lib/public-url.js";

const TOKEN_ENDPOINT = "https://slack.com/api/oauth.v2.access";
const REVOKE_ENDPOINT = "https://slack.com/api/auth.revoke";
const USERS_INFO_ENDPOINT = "https://slack.com/api/users.info";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for Slack OAuth callback`);
  }
  return value;
}

function callbackUrl() {
  const base = publicBaseUrl();
  return `${base}/v1/oauth/slack/callback`;
}

/**
 * Exchange an authorization code for the dual-token response. Returns the
 * parsed Slack response on success; throws on Slack-reported errors.
 */
export async function exchangeCode(code) {
  if (!code || typeof code !== "string") {
    throw new Error("code is required to exchange Slack OAuth grant");
  }
  const clientId = requireEnv("SLACK_OAUTH_CLIENT_ID");
  const clientSecret = requireEnv("SLACK_OAUTH_CLIENT_SECRET");

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: callbackUrl(),
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    // Fail fast on a stalled Slack token endpoint; an AbortError propagates
    // to the callback route's try/catch, which redirects to failure.
    signal: AbortSignal.timeout(
      Number(process.env.SLACK_OAUTH_TIMEOUT_MS) || 10000,
    ),
  });
  if (!res.ok) {
    throw new Error(`slack oauth.v2.access HTTP ${res.status}`);
  }
  const json = await res.json();
  if (!json.ok) {
    const reason = json.error || "unknown_error";
    throw new Error(`slack oauth.v2.access error: ${reason}`);
  }
  return json;
}

/**
 * Look up the installing user's display name so /connect can render
 * "Connected as <name> (<workspace>)". Best-effort: any failure returns
 * null and the caller falls back to a workspace-only label.
 *
 * Prefers the user token (xoxp) because it always has users:read in the
 * user_scope set; falls back to the bot token if the user token is missing.
 */
async function lookupUserDisplayName({ userToken, botToken, userId }) {
  if (!userId) return null;
  const token = userToken || botToken;
  if (!token) return null;
  try {
    const res = await fetch(
      `${USERS_INFO_ENDPOINT}?user=${encodeURIComponent(userId)}`,
      {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(
          Number(process.env.SLACK_OAUTH_TIMEOUT_MS) || 10000,
        ),
      },
    );
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.ok || !json.user) return null;
    const profile = json.user.profile || {};
    return (
      profile.real_name ||
      profile.display_name ||
      json.user.real_name ||
      json.user.name ||
      null
    );
  } catch {
    return null;
  }
}

/**
 * Compose the human-readable account label shown on /connect.
 *   "Caleb Newton (Amber workspace)"
 *   "Amber workspace" (name lookup failed)
 *   null (no workspace name either)
 *
 * The " workspace" suffix disambiguates which org the user authorized
 * against when they belong to multiple Slack workspaces under the same
 * Slack identity.
 */
function composeAccountLabel({ userName, teamName }) {
  if (userName && teamName) return `${userName} (${teamName} workspace)`;
  if (userName) return userName;
  if (teamName) return `${teamName} workspace`;
  return null;
}

/**
 * Persist the workspace install AND per-user xoxp into the installing
 * user's secrets bag. SLACK_WORKSPACE_* mirrors the prior contract;
 * SLACK_USER_* is new and is what the agent reads when acting as the user.
 */
export async function storeTokens(did, tokens) {
  if (!did || typeof did !== "string") {
    throw new Error("did is required to store Slack tokens");
  }
  if (!tokens || typeof tokens !== "object") {
    throw new Error("tokens object is required");
  }
  const team = tokens.team || {};
  const authedUser = tokens.authed_user || {};

  const userName = await lookupUserDisplayName({
    userToken: authedUser.access_token,
    botToken: tokens.access_token,
    userId: authedUser.id,
  });
  const accountLabel = composeAccountLabel({
    userName,
    teamName: team.name || null,
  });

  const record = {
    // Workspace (bot) install
    SLACK_WORKSPACE_TOKEN: tokens.access_token || null,
    SLACK_WORKSPACE_TEAM_ID: team.id || null,
    SLACK_WORKSPACE_TEAM_NAME: team.name || null,
    SLACK_WORKSPACE_SCOPES: tokens.scope || null,
    SLACK_WORKSPACE_BOT_USER_ID: tokens.bot_user_id || null,
    SLACK_WORKSPACE_AUTHED_USER_ID: authedUser.id || null,
    SLACK_WORKSPACE_APP_ID: tokens.app_id || null,
    SLACK_WORKSPACE_ENTERPRISE_ID: tokens.enterprise?.id || null,
    SLACK_WORKSPACE_INSTALLED_AT: new Date().toISOString(),
    // Per-user (xoxp) install — what the agent uses to act AS the user
    SLACK_USER_TOKEN: authedUser.access_token || null,
    SLACK_USER_TOKEN_SCOPES: authedUser.scope || null,
    SLACK_USER_ID: authedUser.id || null,
    SLACK_USER_TEAM_ID: team.id || null,
    SLACK_USER_NAME: userName || null,
    SLACK_USER_ACCOUNT_NAME: accountLabel,
    SLACK_USER_INSTALLED_AT: new Date().toISOString(),
    // OAuth client credentials mirrored so refresh / re-install flows don't
    // depend on process.env resolving on every host that reads the bag.
    SLACK_OAUTH_CLIENT_ID: process.env.SLACK_OAUTH_CLIENT_ID || null,
    SLACK_OAUTH_CLIENT_SECRET: process.env.SLACK_OAUTH_CLIENT_SECRET || null,
  };
  await setSecrets(did, record, { updatedBy: "oauth:slack" });
  return record;
}

/**
 * Revoke both the workspace bot token AND the user token on Slack's
 * side, then clear all SLACK_WORKSPACE_* and SLACK_USER_* keys. Revoke
 * is best-effort: if Slack has already invalidated either token we still
 * want the local bag cleaned up.
 */
export async function revokeTokens(did, currentTokens) {
  if (!did || typeof did !== "string") {
    throw new Error("did is required to revoke Slack tokens");
  }
  const tokensToRevoke = Array.isArray(currentTokens)
    ? currentTokens
    : [currentTokens];

  let anyRevoked = false;
  for (const token of tokensToRevoke) {
    if (!token) continue;
    try {
      const res = await fetch(REVOKE_ENDPOINT, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(
          Number(process.env.SLACK_OAUTH_TIMEOUT_MS) || 10000,
        ),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.ok) anyRevoked = true;
      }
    } catch {
      // swallow: token may already be invalid; we still clear local state
    }
  }

  await setSecrets(
    did,
    {
      SLACK_WORKSPACE_TOKEN: null,
      SLACK_WORKSPACE_TEAM_ID: null,
      SLACK_WORKSPACE_TEAM_NAME: null,
      SLACK_WORKSPACE_SCOPES: null,
      SLACK_WORKSPACE_BOT_USER_ID: null,
      SLACK_WORKSPACE_AUTHED_USER_ID: null,
      SLACK_WORKSPACE_APP_ID: null,
      SLACK_WORKSPACE_ENTERPRISE_ID: null,
      SLACK_WORKSPACE_INSTALLED_AT: null,
      SLACK_USER_TOKEN: null,
      SLACK_USER_TOKEN_SCOPES: null,
      SLACK_USER_ID: null,
      SLACK_USER_TEAM_ID: null,
      SLACK_USER_NAME: null,
      SLACK_USER_ACCOUNT_NAME: null,
      SLACK_USER_INSTALLED_AT: null,
      SLACK_OAUTH_CLIENT_ID: null,
      SLACK_OAUTH_CLIENT_SECRET: null,
    },
    { updatedBy: "oauth:slack:revoke" },
  );
  return { revoked: anyRevoked };
}

export const __test__ = {
  callbackUrl,
  composeAccountLabel,
  lookupUserDisplayName,
  TOKEN_ENDPOINT,
  REVOKE_ENDPOINT,
  USERS_INFO_ENDPOINT,
};
