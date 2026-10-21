/**
 * Slack OAuth scopes — dual-token model, matched to dashboard.
 *
 * One Slack consent screen issues TWO tokens via OAuth v2:
 *   - access_token (xoxb-)            workspace-shared bot token.
 *                                     Persisted under SLACK_WORKSPACE_* keys.
 *                                     Used for team-wide reads on behalf of
 *                                     every member who shows up in Medha.
 *   - authed_user.access_token (xoxp-) per-user token for the installing
 *                                     user. Persisted under SLACK_USER_* keys.
 *                                     Used when Medha acts AS the user
 *                                     (send a DM as them, react as them, etc.).
 *
 * SLACK_BOT_SCOPES go in `scope=` on the authorize URL.
 * SLACK_USER_SCOPES go in `user_scope=` on the authorize URL.
 *
 * Slack OAuth v2 rejects with "Invalid permissions requested" if any scope
 * in the URL is not present in the app's Bot/User Token Scopes lists in
 * the Slack app dashboard. These lists MUST stay in sync with the
 * dashboard at api.slack.com/apps/<app-id>/oauth.
 *
 * Notable v2 quirks captured here:
 *   - search:read (umbrella) is deprecated; Slack now uses six granular
 *     search:read.{files,im,mpim,private,public,users} scopes.
 *   - chat:write.public and chat:write.customize are BOT-only.
 *   - users.profile:read is a separate scope from users:read.
 *
 * If you need to grow this list, add the scope to the Slack app dashboard
 * FIRST, then mirror it here in the same PR.
 */

export const SLACK_BOT_SCOPES = [
  "app_mentions:read",
  "assistant:write",
  "channels:manage",
  "chat:write",
  "im:history",
  "im:read",
  "im:write",
  "users:read",
  "users:read.email",
];

export const SLACK_USER_SCOPES = [
  "canvases:read",
  "channels:history",
  "channels:read",
  "channels:write",
  "chat:write",
  "emoji:read",
  "files:read",
  "files:write",
  "groups:history",
  "groups:read",
  "groups:write",
  "im:history",
  "im:write",
  "mpim:history",
  "mpim:read",
  "mpim:write",
  "pins:read",
  "pins:write",
  "reactions:read",
  "reactions:write",
  "reminders:read",
  "reminders:write",
  "search:read.files",
  "search:read.im",
  "search:read.mpim",
  "search:read.private",
  "search:read.public",
  "search:read.users",
  "users:read",
  "users:read.email",
];

export function buildScopeString(scopes) {
  return scopes.join(",");
}
