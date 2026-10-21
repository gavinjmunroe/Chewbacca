/**
 * Twitter (X) OAuth 2.0 scopes for medha-id.
 *
 * Scope reference: https://docs.x.com/resources/fundamentals/authentication/oauth-2-0/authorization-code
 *
 * We request the full surface area the X app is permissioned for. Some
 * scopes (dm.read, dm.write) only function at Pro tier or above; on Free
 * or Basic the OAuth consent still succeeds for them but the actual API
 * call returns 403 until the developer account is upgraded. That's
 * intentional: when Caleb upgrades tier, every tool starts working with
 * zero code changes.
 *
 * If the X app's User authentication settings do NOT include "Direct
 * message" permission, X will strip dm.* from the granted scope list at
 * consent time. That's fine: the tools detect missing scopes at call time
 * and surface a clear error.
 */

export const TWITTER_SCOPES = [
  "offline.access",
  "tweet.read",
  "tweet.write",
  "tweet.moderate.write",
  "users.read",
  "follows.read",
  "follows.write",
  "like.read",
  "like.write",
  "list.read",
  "list.write",
  "block.read",
  "block.write",
  "bookmark.read",
  "bookmark.write",
  "mute.read",
  "mute.write",
  "space.read",
  "dm.read",
  "dm.write",
  "media.write",
];

/** The string form sent in the authorize URL (space-delimited). */
export const TWITTER_SCOPE_STRING = TWITTER_SCOPES.join(" ");

/** Twitter's OAuth 2.0 endpoints. */
export const TWITTER_AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
export const TWITTER_TOKEN_URL = "https://api.x.com/2/oauth2/token";
export const TWITTER_REVOKE_URL = "https://api.x.com/2/oauth2/revoke";
