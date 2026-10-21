/**
 * Slack -> phone identity link (Option C in envelope.js's design notes).
 *
 * First time a Slack user DMs Medha, we have no idea who they are. Instead
 * of inventing a parallel slack-only person_id namespace (Option A), we
 * ask them to reply with their phone number in E.164. Once they do, we
 * persist `slack:team:user -> person_id` in medha-id so every subsequent
 * Slack message from that user attaches to the same graph as their
 * iMessage history.
 *
 * All persistence lives in medha-id behind /v1/slack-links/*. This module
 * is a thin client and the local E.164 validator.
 */

import { MEDHA_ID_URL, MEDHA_ID_API_KEY } from "../../constants.js";

const FETCH_TIMEOUT_MS = 4_000;

function isConfigured() {
  return !!(MEDHA_ID_URL && MEDHA_ID_API_KEY);
}

function authHeaders() {
  return {
    "x-api-key": MEDHA_ID_API_KEY,
    "Content-Type": "application/json",
  };
}

/**
 * Strict-ish E.164 detector: optional leading "+", first digit 1-9, 8-15
 * total digits. Permissive enough to accept "+15551234567" and "15551234567"
 * but rejects free text, US-only short forms, and anything with letters.
 */
export function isE164(text) {
  if (typeof text !== "string") return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /^\+?[1-9]\d{7,14}$/.test(trimmed);
}

/**
 * Normalize a maybe-E.164 string to a canonical "+<digits>" form. Adds
 * the "+" if missing. Caller must have already passed isE164.
 */
export function toE164(text) {
  const trimmed = String(text || "").trim();
  return trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
}

/**
 * Look up an existing link for a Slack identity.
 *
 * @param {Object} args
 * @param {string} args.team - Slack team id (T...)
 * @param {string} args.user - Slack user id (U...)
 * @returns {Promise<{personId: string, phone: string} | null>}
 *   null when no link exists, the medha-id side returns 404, or the
 *   service is unconfigured / unreachable. Callers MUST treat null as
 *   "unlinked" and prompt accordingly.
 */
export async function lookupLink({ team, user } = {}) {
  if (!team || !user) return null;
  if (!isConfigured()) return null;
  const url = `${MEDHA_ID_URL}/v1/slack-links/${encodeURIComponent(team)}/${encodeURIComponent(user)}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: authHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      console.warn(
        `[slack-identity] lookupLink ${team}:${user} failed http=${res.status}`,
      );
      return null;
    }
    const body = await res.json().catch(() => null);
    if (!body || typeof body.personId !== "string") return null;
    return { personId: body.personId, phone: body.phone || null };
  } catch (err) {
    console.warn(`[slack-identity] lookupLink threw: ${err.message}`);
    return null;
  }
}

/**
 * Register a pending link for a Slack identity. Idempotent on the
 * medha-id side. Used the first time we see an unlinked user so the
 * service knows we're mid-onboarding.
 */
export async function startLink({ team, user, channel } = {}) {
  if (!team || !user) return;
  if (!isConfigured()) return;
  try {
    const res = await fetch(`${MEDHA_ID_URL}/v1/slack-links/pending`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ team, user, channel: channel || null }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(
        `[slack-identity] startLink ${team}:${user} failed http=${res.status}`,
      );
    }
  } catch (err) {
    console.warn(`[slack-identity] startLink threw: ${err.message}`);
  }
}

/**
 * Complete a link by binding the Slack identity to an E.164 phone. The
 * medha-id side derives person_id as sha256(toE164(phone)).slice(0,32),
 * matching the iMessage identity derivation, so the resulting person_id
 * collides intentionally with any existing iMessage history for the
 * same phone.
 *
 * @returns {Promise<{personId: string} | null>}
 *   null on failure; caller should reply with a "couldn't link, try
 *   again" message rather than continuing into the agent loop.
 */
export async function completeLink({ team, user, phoneE164 } = {}) {
  if (!team || !user || !phoneE164) return null;
  if (!isConfigured()) return null;
  try {
    const res = await fetch(`${MEDHA_ID_URL}/v1/slack-links/complete`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ team, user, phone: phoneE164 }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(
        `[slack-identity] completeLink ${team}:${user} failed http=${res.status}`,
      );
      return null;
    }
    const body = await res.json().catch(() => null);
    if (!body || typeof body.personId !== "string") return null;
    return { personId: body.personId };
  } catch (err) {
    console.warn(`[slack-identity] completeLink threw: ${err.message}`);
    return null;
  }
}

/**
 * Has this user already seen the one-time link offer? Used so the link
 * P.S. only appears on a Slack user's first unlinked message, not on
 * every subsequent one. Fail-closed: on network/config errors return
 * `true` so we don't spam the user with repeated prompts during an outage.
 */
export async function wasPrompted({ team, user } = {}) {
  if (!team || !user) return true;
  if (!isConfigured()) return true;
  const url = `${MEDHA_ID_URL}/v1/slack-links/${encodeURIComponent(team)}/${encodeURIComponent(user)}/prompted`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: authHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(
        `[slack-identity] wasPrompted ${team}:${user} failed http=${res.status}`,
      );
      return true; // fail-closed (don't spam the user)
    }
    const body = await res.json().catch(() => null);
    return Boolean(body?.prompted);
  } catch (err) {
    console.warn(`[slack-identity] wasPrompted threw: ${err.message}`);
    return true;
  }
}

/**
 * Look up an existing Privy tenant by an email address (Slack Option B
 * pre-flight). Used when the Slack user is unlinked but their Slack
 * profile exposes an email — if the email matches a tenant on the
 * amber-id side we can silently auto-bind instead of running the
 * Option C "send me your phone" ceremony.
 *
 * The amber-id route is two-stage: it first checks the user's Privy
 * linked emails, and on a miss falls through to the per-tenant secrets
 * bag's `*_OAUTH_ACCOUNT_EMAIL` entries (Google, Microsoft, GitHub,
 * Railway, Notion, Slack). The response carries `matchedVia` so we can
 * tell which path produced the match.
 *
 * @param {string} email — already extracted from users.info; never the
 *   raw mention token. Caller normalizes case before passing.
 * @returns {Promise<{
 *   phone: string,
 *   did: string,
 *   displayName: string | null,
 *   matchedVia: "privy_primary" | "oauth_account" | null,
 *   matchedKey: string | null
 * } | null>}
 *   null on 404, missing config, network error, or any unexpected
 *   response shape. Callers MUST treat null as "no match" and fall
 *   through to the existing Option C path.
 */
export async function lookupTenantByEmail(email) {
  if (typeof email !== "string" || !email.trim()) return null;
  if (!isConfigured()) return null;
  const url = `${MEDHA_ID_URL}/v1/tenants/by-email?email=${encodeURIComponent(email.trim().toLowerCase())}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: authHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      console.warn(
        `[slack-identity] lookupTenantByEmail ${email} failed http=${res.status}`,
      );
      return null;
    }
    const body = await res.json().catch(() => null);
    const tenant = body?.data;
    // Need both a phone and a DID to be useful for auto-bind. If either
    // is missing the tenant exists but isn't a candidate for Option B
    // (e.g. an admin user with no phone on the account).
    if (!tenant || typeof tenant !== "object") return null;
    const phone = tenant.phoneNumber || tenant.loopSenderPhone || null;
    const did = tenant.privyDid || tenant.id || null;
    if (!phone || !did) return null;
    return {
      phone,
      did,
      displayName: tenant.displayName || tenant.ownerName || null,
      matchedVia: tenant.matchedVia || null,
      matchedKey: tenant.matchedKey || null,
    };
  } catch (err) {
    console.warn(`[slack-identity] lookupTenantByEmail threw: ${err.message}`);
    return null;
  }
}

/**
 * Auto-bind a Slack identity to a known tenant (Slack Option B). Calls
 * the medha-id /v1/slack-links/auto-bind route, which writes a "linked"
 * row with bind_method="auto_email", suppresses the soft P.S. offer,
 * and returns the iMessage-compatible person_id.
 *
 * @param {Object} args
 * @param {string} args.team        — Slack team id
 * @param {string} args.user        — Slack user id
 * @param {string} args.tenantDid   — Privy DID returned by lookupTenantByEmail
 * @param {string} args.phone       — E.164 phone returned by lookupTenantByEmail
 * @param {string} args.sourceEmail — Slack profile email that produced the match
 * @returns {Promise<{personId: string, phone: string} | null>}
 *   null on any failure. Callers MUST treat null as "didn't bind" and
 *   fall through to Option C so the user is never stranded.
 */
export async function autoBindSlackLink({
  team,
  user,
  tenantDid,
  phone,
  sourceEmail,
} = {}) {
  if (!team || !user || !tenantDid || !phone || !sourceEmail) return null;
  if (!isConfigured()) return null;
  try {
    const res = await fetch(`${MEDHA_ID_URL}/v1/slack-links/auto-bind`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ team, user, tenantDid, phone, sourceEmail }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(
        `[slack-identity] autoBindSlackLink ${team}:${user} failed http=${res.status}`,
      );
      return null;
    }
    const body = await res.json().catch(() => null);
    if (!body || typeof body.personId !== "string") return null;
    return {
      personId: body.personId,
      phone: body.phone || phone,
    };
  } catch (err) {
    console.warn(`[slack-identity] autoBindSlackLink threw: ${err.message}`);
    return null;
  }
}

/**
 * Resolve a Slack sender email to either a tenant owner OR a contact in
 * some tenant's address book. Hits medha-id's `/internal/contacts/by-email`
 * which checks (in order): Privy linked email, OAuth-account-email per
 * tenant, contact in any tenant's address book.
 *
 * Used when the Slack sender is NOT a tenant (Option B's auto-bind path
 * already covers the tenant case end-to-end) but their email is known to
 * Medha as a contact in someone's contact book. Returning a non-null
 * result here lets the envelope attach `senderDisplayName` so the agent
 * addresses the inbound message as the right human ("Caleb", not the
 * channel owner) even without a link.
 *
 * Returns:
 *   { kind: "tenant_owner", did, displayName }            tenant match
 *   { kind: "contact", did, contactId, displayName,        contact match
 *     firstName, lastName, name }
 *   null                                                   miss / config /
 *                                                          network error
 */
const senderEmailCache = new Map();
const SENDER_EMAIL_TTL_MS = 60 * 60 * 1000; // 1 hour per spec

export function _resetSenderEmailCacheForTests() {
  senderEmailCache.clear();
}

function cacheGetSender(emailLower) {
  const hit = senderEmailCache.get(emailLower);
  if (!hit) return undefined;
  if (Date.now() - hit.ts > SENDER_EMAIL_TTL_MS) {
    senderEmailCache.delete(emailLower);
    return undefined;
  }
  return hit.value;
}

function cacheSetSender(emailLower, value) {
  senderEmailCache.set(emailLower, { value, ts: Date.now() });
}

export async function lookupSenderByEmail(email) {
  if (typeof email !== "string") return null;
  const lower = email.trim().toLowerCase();
  if (!lower) return null;
  if (!isConfigured()) return null;

  const cached = cacheGetSender(lower);
  if (cached !== undefined) return cached;

  const url = `${MEDHA_ID_URL}/internal/contacts/by-email?email=${encodeURIComponent(lower)}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: authHeaders(),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      // HTTP errors are treated as transient (do NOT cache the null) so
      // a single bad medha-id deploy doesn't pin every unknown sender to
      // "unidentified" for an hour. The next event re-queries.
      console.warn(
        `[slack-identity] lookupSenderByEmail failed http=${res.status}`,
      );
      return null;
    }
    const body = await res.json().catch(() => null);
    if (!body || body.found !== true) {
      cacheSetSender(lower, null);
      return null;
    }
    if (body.kind === "tenant_owner" && typeof body.did === "string") {
      const value = {
        kind: "tenant_owner",
        did: body.did,
        displayName: body.displayName || null,
        matchedVia: body.matchedVia || null,
      };
      cacheSetSender(lower, value);
      return value;
    }
    if (body.kind === "contact" && typeof body.did === "string") {
      const c = body.contact || {};
      const value = {
        kind: "contact",
        did: body.did,
        contactId: body.contactId || c.id || null,
        // Prefer firstName for the agent's "you" reference (matches the
        // tone used for iMessage contacts: "Hey Caleb", not "Hey Caleb
        // Newton"). Fall back to full name when firstName is empty.
        displayName: c.firstName || c.name || null,
        firstName: c.firstName || null,
        lastName: c.lastName || null,
        name: c.name || null,
      };
      cacheSetSender(lower, value);
      return value;
    }
    cacheSetSender(lower, null);
    return null;
  } catch (err) {
    console.warn(`[slack-identity] lookupSenderByEmail threw: ${err.message}`);
    // Do not cache transient errors — let the next event retry.
    return null;
  }
}

/**
 * Stamp the one-time offer so it does not re-appear on subsequent
 * inbound messages. Idempotent on the medha-id side.
 */
export async function markPrompted({ team, user } = {}) {
  if (!team || !user) return;
  if (!isConfigured()) return;
  try {
    const res = await fetch(`${MEDHA_ID_URL}/v1/slack-links/mark-prompted`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ team, user }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(
        `[slack-identity] markPrompted ${team}:${user} failed http=${res.status}`,
      );
    }
  } catch (err) {
    console.warn(`[slack-identity] markPrompted threw: ${err.message}`);
  }
}
