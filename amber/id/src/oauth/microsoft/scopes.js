/**
 * Microsoft (Azure AD) OAuth scopes spanning Outlook, Microsoft Calendar,
 * OneDrive, and Teams.
 *
 * `offline_access` is required to receive a refresh_token.
 * `openid`, `email`, `profile` are needed for the `/v1.0/me` lookup and to
 * surface the id_token used for "Connected as foo@outlook.com" labels.
 *
 * Each scope here must be granted in the Azure AD app registration's API
 * Permissions tab. Mail.Send + Chat.ReadWrite + ChatMessage.Send + Files.*
 * count as sensitive; the app stays in Testing mode until verification.
 */

export const MICROSOFT_SCOPES = [
  "offline_access",
  "openid",
  "email",
  "profile",
  "User.Read",
  "Calendars.ReadWrite",
  "Mail.Send",
  "Mail.Read",
  "Files.ReadWrite",
  "Chat.ReadWrite",
  "ChatMessage.Send",
  "Presence.Read",
];

export const MICROSOFT_AUTHORIZE_URL =
  "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";

export const MICROSOFT_TOKEN_URL =
  "https://login.microsoftonline.com/common/oauth2/v2.0/token";
