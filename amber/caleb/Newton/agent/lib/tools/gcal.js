/**
 * gcal.js — Google Calendar native integration (barrel export).
 *
 * Replaces Composio's googlecalendar with a direct Google Calendar REST API
 * client that runs entirely client-side using per-tenant OAuth2 credentials
 * stored in amber-id secrets.
 *
 * Secret keys (all per-tenant via amber-id):
 *   GCAL_OAUTH_REFRESH        — OAuth2 refresh token (required)
 *   GCAL_OAUTH_ACCESS         — cached access token
 *   GCAL_OAUTH_EXPIRES        — access token expiry (unix ms as string)
 *   GCAL_OAUTH_CLIENT_ID      — Google app client ID (env fallback: GCAL_OAUTH_CLIENT_ID, then GOOGLE_OAUTH_CLIENT_ID)
 *   GCAL_OAUTH_CLIENT_SECRET  — Google app client secret (env fallback: GCAL_OAUTH_CLIENT_SECRET, then GOOGLE_OAUTH_CLIENT_SECRET)
 *   GCAL_CAL_FINANCIAL        — Google Calendar ID for "Amber · Financial"
 *   GCAL_CAL_INTELLECTUAL     — Google Calendar ID for "Amber · Intellectual"
 *   GCAL_CAL_SOCIAL           — Google Calendar ID for "Amber · Social"
 *   GCAL_CAL_SPIRITUAL        — Google Calendar ID for "Amber · Spiritual"
 *   GCAL_CAL_EMOTIONAL        — Google Calendar ID for "Amber · Emotional"
 *   GCAL_CAL_PHYSICAL         — Google Calendar ID for "Amber · Physical"
 *
 * Usage:
 *   import { GCAL_TOOLS, executeGcalTool, freebusyFor, provisionHealthCalendars }
 *     from "./lib/tools/gcal.js";
 */

// Re-export Claude tool schemas + dispatcher
export { GCAL_TOOLS, executeGcalTool } from "./gcal/tools.js";

// Re-export service-to-service helpers
export { freebusyFor } from "./gcal/tools.js";

// Re-export provisioner for use by setup flows
export {
  provisionHealthCalendars,
  DIMENSIONS,
  resolveCalendarId,
} from "./gcal/provisioner.js";

// Re-export raw client for other service files that need direct access
export { gcalRequest, resolveAccessToken } from "./gcal/client.js";
