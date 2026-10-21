/**
 * Auth-bounce middleware: short-circuit tool calls when the resolved
 * tenant has not yet connected the service the tool requires, and
 * issue a medha-id magic link the agent can DM back to the user.
 *
 * Design mirrors withAuditLog (lib/middleware/audit.js) — a higher-order
 * function that wraps the inner dispatcher and either:
 *
 *   1. Pass-through: the tool has no service requirement, or the
 *      requirement is already satisfied. Inner handler runs normally.
 *
 *   2. Short-circuit: the tool requires a service (gcal, gmail,
 *      linkedin, apple) whose per-tenant secret is missing. We call
 *      medha-id POST /api/v1/magic-link/issue, then return a structured
 *      result the agent surfaces to the user:
 *
 *        { error: "connection_required",
 *          service: "google_calendar",
 *          magic_link: "https://medha-frontend-production.../onboarding?...",
 *          message: "I need you to connect Google Calendar first. Tap..." }
 *
 *      The agent's tool-result handler treats this the same as any
 *      other tool error — it's surfaced verbatim in the next assistant
 *      turn, where Claude can paste the link to the user.
 *
 * If medha-id's magic-link endpoint is unavailable (still being built
 * under WS-4, or transient outage), we fall back to a plain
 * "connection_required" error with no link — strictly better than
 * letting the tool fail mid-execution with a cryptic OAuth error.
 *
 * The service-requirement table is intentionally minimal: we only gate
 * tools where a missing secret reliably maps to "user has not connected
 * this account." Tools with org-level fallbacks (Perplexity, Composio,
 * Loop) are not gated here — they degrade through their own paths.
 */

import {
  MEDHA_ID_URL,
  MEDHA_ID_API_KEY,
  AMBER_ID_API_URL,
  AMBER_ID_API_KEY,
  JUSTAROCK_SIGNUP_URL,
} from "../constants.js";
import { getSecret } from "../secrets.js";

/**
 * Map tool-name prefix → service descriptor. The descriptor says:
 *   - service: canonical id sent to medha-id when issuing a magic link
 *   - secretKeys: per-tenant secret bag keys whose presence proves the
 *     service is connected. If ANY key is set, the service is considered
 *     connected.
 *   - label: human-readable name the agent can paste back to the user
 *
 * Add entries here when a new tool group needs gating. Anything not
 * matched falls through with no check.
 */
const SERVICE_REQUIREMENTS = [
  {
    // Real calendar tools (schedule_event, list_events, get_availability,
    // reschedule_event, cancel_event) don't share a clean prefix, so
    // keep the gating in the gcal client itself. The old gcal_/event_
    // match never fired against real tool names, but we keep this entry
    // shape commented out so future calendar tools added with the
    // gcal_ prefix get gated correctly.
    match: (_name) => false,
    service: "google_calendar",
    label: "Google Calendar",
    secretKeys: ["GCAL_OAUTH_REFRESH", "GCAL_OAUTH_ACCESS"],
  },
  {
    match: (name) => name.startsWith("gmail_"),
    service: "gmail",
    label: "Gmail",
    // Gmail OAuth tokens land under GMAIL_OAUTH_REFRESH / GMAIL_OAUTH_ACCESS,
    // and gmail.js falls back to GCAL_OAUTH_REFRESH (same Google consent
    // covers all three product surfaces). Match any of them as "connected".
    secretKeys: [
      "GMAIL_OAUTH_REFRESH",
      "GMAIL_OAUTH_ACCESS",
      "GCAL_OAUTH_REFRESH",
    ],
  },
  {
    match: (name) => name.startsWith("linkedin_"),
    service: "linkedin",
    label: "LinkedIn",
    secretKeys: ["LINKEDIN_OAUTH_REFRESH", "LINKEDIN_OAUTH_ACCESS"],
  },
  {
    match: (name) =>
      name.startsWith("apple_") || name === "togari_push_to_apple",
    service: "apple",
    label: "Apple Contacts (iCloud)",
    // Apple credentials live in GCP Secret Manager keyed by privyDid
    // (apple-carddav-{did}), not the bag. This entry is currently
    // best-effort; a proper check would call medha-id GET
    // /dnc/auth/apple/credentials/status. Until that exists, leave the
    // bag-key probe and accept the false negative.
    secretKeys: ["APPLE_APP_PASSWORD", "APPLE_ICLOUD_PASSWORD"],
  },
];

/**
 * Find the requirement (if any) for a tool name.
 *
 * @param {string} toolName
 * @returns {{ service: string, label: string, secretKeys: string[] } | null}
 */
function findRequirement(toolName) {
  if (!toolName) return null;
  for (const req of SERVICE_REQUIREMENTS) {
    if (req.match(toolName)) return req;
  }
  return null;
}

/**
 * Probe per-tenant secrets to decide if the tenant has connected a
 * service. We return true on the first secret that resolves to a
 * truthy value; null/empty means not connected.
 *
 * @param {object} tenant
 * @param {string[]} secretKeys
 * @returns {Promise<boolean>}
 */
async function hasConnection(tenant, secretKeys) {
  if (!tenant) return false;
  for (const key of secretKeys) {
    const value = await getSecret(tenant, key).catch(() => null);
    if (value && String(value).trim().length > 0) return true;
  }
  return false;
}

/**
 * Resolve the base URL + service key for the magic-link issuer. Prefers
 * MEDHA_ID_URL (the active naming) and falls back to AMBER_ID_API_URL
 * during the in-flight rename window. If neither is set we cannot
 * issue a link — that's a configuration error, not a per-call failure.
 */
function magicLinkConfig() {
  const baseUrl = MEDHA_ID_URL || AMBER_ID_API_URL;
  const apiKey = MEDHA_ID_API_KEY || AMBER_ID_API_KEY;
  return { baseUrl, apiKey };
}

/**
 * Issue a magic link via medha-id POST /api/v1/magic-link/issue.
 *
 * Endpoint contract (WS-4 of the dedup parallel build):
 *   POST /api/v1/magic-link/issue
 *   headers: { "content-type": "application/json", "x-api-key": <service key> }
 *   body:    { did, service, return_to? }
 *   200 →    { url, expires_at }
 *
 * If WS-4 hasn't merged yet we'll get a 404; the caller treats that as
 * "no link available" and returns the structured connection_required
 * error without a URL.
 *
 * @param {string} did
 * @param {string} service
 * @returns {Promise<{ url: string, expires_at?: string } | null>}
 */
async function issueMagicLink(did, service) {
  const { baseUrl, apiKey } = magicLinkConfig();
  if (!baseUrl || !apiKey || !did || !service) return null;
  const url = `${baseUrl.replace(/\/$/, "")}/api/v1/magic-link/issue`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({ did, service }),
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) return null;
    const body = await resp.json().catch(() => null);
    if (!body || typeof body.url !== "string") return null;
    return { url: body.url, expires_at: body.expires_at };
  } catch {
    return null;
  }
}

/**
 * Extract a tenant DID for medha-id calls. Tolerates both shapes the
 * dispatcher passes: `{ tenant: { ... } }` or the tenant object
 * directly.
 *
 * @param {object | null | undefined} ctx
 * @returns {string | null}
 */
function extractTenantDid(ctx) {
  if (!ctx) return null;
  const t = ctx.tenant || ctx;
  if (!t || typeof t !== "object") return null;
  return t.privyDid || t.id || t.amberId || null;
}

/**
 * Build the structured tool result returned when a tool is gated and
 * the tenant has not yet connected the required service.
 *
 * @param {{ service: string, label: string }} req
 * @param {{ url: string, expires_at?: string } | null} link
 * @returns {object}
 */
function buildConnectionRequiredResult(req, link) {
  if (link && link.url) {
    return {
      error: "connection_required",
      service: req.service,
      service_label: req.label,
      magic_link: link.url,
      expires_at: link.expires_at || null,
      message: `${req.label} is not connected for this user. Send them this magic link to finish setup: ${link.url}`,
    };
  }
  return {
    error: "connection_required",
    service: req.service,
    service_label: req.label,
    magic_link: null,
    message: `${req.label} is not connected for this user, and I could not generate a setup link right now (medha-id magic-link endpoint unavailable). Ask the user to open the Medha onboarding wizard and connect ${req.label}.`,
  };
}

/**
 * Build the structured tool result returned when the caller has no
 * real medha-id (expert-tenant). A magic link won't help — they need
 * to create an account first.
 */
function buildSignupRequiredResult(req) {
  return {
    error: "signup_required",
    service: req.service,
    service_label: req.label,
    signup_url: JUSTAROCK_SIGNUP_URL,
    message: `${req.label} needs a Medha account first. Tell the user to sign up at ${JUSTAROCK_SIGNUP_URL}, then come back and connect ${req.label} from their dashboard.`,
  };
}

/**
 * Higher-order function: wrap a dispatch handler so any tool call
 * whose name maps to a gated service short-circuits with a magic-link
 * payload when the tenant has not yet connected that service.
 *
 * Wrapped handler keeps the (toolUse, ctx) signature used by
 * dispatchToolCall, so it composes cleanly with withAuditLog.
 *
 * Composition order at the dispatcher:
 *
 *   const guarded = withAuthBounce(name, _dispatchToolCallInner);
 *   const audited = withAuditLog(name, guarded);
 *   return audited(toolUse, ctx);
 *
 * Audit on the outside means short-circuited calls still emit a
 * structured log line.
 *
 * @template R
 * @param {string} toolName
 * @param {(toolUse: any, ctx?: any) => Promise<R> | R} handlerFn
 * @returns {(toolUse: any, ctx?: any) => Promise<R | object>}
 */
export function withAuthBounce(toolName, handlerFn) {
  if (typeof handlerFn !== "function") {
    throw new TypeError(
      `withAuthBounce: handler for "${toolName}" must be a function`,
    );
  }
  return async function bouncedHandler(toolUse, ctx) {
    const req = findRequirement(toolName);
    if (!req) return handlerFn(toolUse, ctx);

    const did = extractTenantDid(ctx);
    if (!did) {
      // No DID resolved — fail open. The downstream tool will raise its
      // own clearer error than a synthetic "connection_required."
      return handlerFn(toolUse, ctx);
    }

    const connected = await hasConnection(ctx?.tenant, req.secretKeys);
    if (connected) return handlerFn(toolUse, ctx);

    // Expert-tenant users (cold iMessage / unlinked Slack) have no
    // personal medha-id, so a magic-link mint can't bind anything
    // meaningful. Point them at the sign-up landing instead.
    const tenantObj = ctx?.tenant || ctx || {};
    if (tenantObj.expertMode === true) {
      console.warn(
        `[auth-bounce] ${toolName}: expert-tenant ${did} missing ${req.service}; surfacing sign-up URL`,
      );
      return buildSignupRequiredResult(req);
    }

    console.warn(
      `[auth-bounce] ${toolName}: tenant ${did} missing ${req.service}; issuing magic link`,
    );
    const link = await issueMagicLink(did, req.service);
    return buildConnectionRequiredResult(req, link);
  };
}

// Internal exports for tests + neighboring modules. Stable enough that
// a unit test can probe gating without going through the full
// dispatcher.
export const __internals = {
  findRequirement,
  hasConnection,
  issueMagicLink,
  extractTenantDid,
  buildConnectionRequiredResult,
  buildSignupRequiredResult,
  SERVICE_REQUIREMENTS,
};
