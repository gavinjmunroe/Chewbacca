/**
 * microsoft.js: barrel export for the Microsoft Graph native integration
 * (Outlook, Microsoft Calendar, OneDrive, Teams). One consent on medha-id
 * grants tokens that all four surfaces share.
 *
 * Per-tenant secrets (written by medha-id /v1/oauth/microsoft/callback):
 *   MS_OAUTH_REFRESH        OAuth2 refresh token (required)
 *   MS_OAUTH_ACCESS         cached access token
 *   MS_OAUTH_EXPIRES        access token expiry (unix ms as string)
 *   MS_OAUTH_SCOPES         space-separated list of granted scopes
 *   MS_OAUTH_ACCOUNT_EMAIL  user-facing account label
 *   MS_OAUTH_CONNECTED_AT   ISO timestamp consent was completed
 *
 * Per-service override prefixes (OUTLOOK_, MSCAL_, ONEDRIVE_, TEAMS_) are
 * supported by getMicrosoftAccessToken but not written by the default
 * callback flow. They exist so a future per-surface disconnect can land
 * without touching tool code.
 *
 * Org-level env vars on medha-platform:
 *   MS_OAUTH_CLIENT_ID
 *   MS_OAUTH_CLIENT_SECRET
 *
 * Usage:
 *   import { MICROSOFT_TOOLS, MICROSOFT_TOOL_NAMES, executeMicrosoftTool }
 *     from "./lib/tools/microsoft.js";
 */

export {
  MICROSOFT_TOOLS,
  MICROSOFT_TOOL_NAMES,
  executeMicrosoftTool,
} from "./microsoft/tools.js";

export { graphRequest } from "./microsoft/client.js";
export { getMicrosoftAccessToken } from "./microsoft-oauth.js";
