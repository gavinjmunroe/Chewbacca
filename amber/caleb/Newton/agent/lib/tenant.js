/**
 * Tenant resolution: maps incoming messages to the tenant who owns that agent.
 *
 * All per-tenant identity (phone number, loop sender, permissions, context
 * repo) lives in amber-id. amber-agent does NOT hold per-tenant env vars.
 * Adding a new person = one amber-id admin-API call — zero Railway env
 * changes, zero redeploys.
 *
 * Resolution path:
 *   Loop Message `sender` UUID in webhook payload -> amber-id
 *     GET /tenants/resolve?sender_id=xxx -> full tenant object
 *
 * If amber-id returns nothing for that sender, the message is unrouted
 * and must be dropped upstream — we do NOT synthesize a fallback tenant
 * from env vars, because that would silently reply from the wrong
 * identity for any unknown sender.
 */

import { normalizeHandle } from "./permissions.js";
import { getBreaker } from "./circuit-breaker.js";

// Circuit breaker around amber-id tenant resolution. amber-id is on the
// hot path for every inbound webhook; an outage there must not stall
// the agent's reply queue. The breaker fails fast (returns null) once
// failures cross the threshold so callers can drop messages cleanly
// instead of accumulating 5s waits.
const AMBER_ID_BREAKER = getBreaker("amber-id", {
  failureThreshold: 5,
  cooldownMs: 15_000,
  windowMs: 30_000,
  timeoutMs: 3000,
});

// In-memory tenant cache: sender_id -> tenant (TTL 5 min, LRU bounded)
const TENANT_CACHE_TTL = 5 * 60 * 1000;
const TENANT_CACHE_MAX = 1000;
const tenantCache = new Map();

function cacheSet(key, value) {
  if (tenantCache.size >= TENANT_CACHE_MAX) {
    // Evict oldest entry (Map iteration order is insertion order)
    const oldestKey = tenantCache.keys().next().value;
    tenantCache.delete(oldestKey);
  }
  tenantCache.set(key, value);
}

function cacheGet(key) {
  const entry = tenantCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt >= TENANT_CACHE_TTL) {
    tenantCache.delete(key);
    return null;
  }
  // Re-insert to mark as recently used
  tenantCache.delete(key);
  tenantCache.set(key, entry);
  return entry.data;
}

/**
 * The tenant object shape returned by all resolution functions.
 * @typedef {Object} Tenant
 * @property {string} id - UUID from tenants table
 * @property {string} amberId - Amber ID (Privy user ID)
 * @property {string} displayName - Tenant's display name
 * @property {string} phoneNumber - Tenant's real phone number
 * @property {string} loopSenderId - Their assigned Loop Message sender ID
 * @property {string} loopSenderPhone - The phone number Loop sends from
 * @property {Object} onboardingProfile - Personality, demographics, health baseline
 * @property {Object} permissions - Feature access control
 * @property {string|null} contextRepo - GitHub context repo for this tenant
 * @property {string|null} [writingDoctrine] - Ghost-writing doctrine slug
 *   ("bma" | "rytual"). Drives buildWritingDoctrineBlock. May also live at
 *   onboardingProfile.writingDoctrine; the resolver prefers the profile copy.
 * @property {string|null} [org] - Org affiliation slug (e.g. "bma", "rytual").
 *   Last-resort fallback for writing-doctrine resolution.
 * @property {Array<{slug:string,name:string,kind:string,id:string,defaultRange?:string}>} [workspaceDocs] - Tab 6: tenant-registered Sheets/Docs for named lookup
 * @property {object} [preferences] - Per-tenant preference bag (e.g. preferences.proactive.checkins)
 * @property {object|null} [checkInSchedule] - Per-tenant scheduler config (see checkin-schedule.js)
 */

/**
 * Legacy direct-Supabase resolvers — retired. All tenant resolution now
 * goes through amber-id (`resolveTenantFromApi` below). These shims stay
 * here so callers that still reference them degrade gracefully.
 */
export async function resolveTenantFromSenderId(_senderId) {
  return null;
}

export async function resolveTenantFromAmberId(_amberId) {
  return null;
}

/**
 * Legacy: used to synthesize a tenant from env vars. Retired — env-based
 * identity is gone. Kept as a no-op so any stragglers import cleanly; it
 * always returns null now.
 */
export function buildFallbackTenant() {
  return null;
}

/**
 * Resolve tenant via amber-id API (preferred when AMBER_ID_API_URL is set).
 */
async function resolveTenantFromApi(senderId) {
  const apiUrl = process.env.AMBER_ID_API_URL;
  const apiKey = process.env.AMBER_ID_API_KEY;
  if (!apiUrl || !apiKey || !senderId) return null;

  const cached = cacheGet(`api:${senderId}`);
  if (cached) return cached;

  const url = `${apiUrl}/tenants/resolve?sender_id=${encodeURIComponent(senderId)}`;
  const res = await AMBER_ID_BREAKER.run(
    async () =>
      fetch(url, {
        headers: { "x-api-key": apiKey },
        signal: AbortSignal.timeout(3000),
      }),
    { fallback: null },
  );
  if (!res || !res.ok) return null;
  try {
    const body = await res.json();
    if (!body.data) return null;

    // amber-id is now authoritative. The tenant `id` used to be a Supabase
    // UUID, but with Supabase retired we key on the Privy DID directly.
    // Downstream code that still uses `tenant.id` as a row key is fine
    // because amber-id's Firestore-backed tables index by `tenant_did`.
    const tenant = {
      id: body.data.privyDid || body.data.id,
      amberId: body.data.id || body.data.privyDid,
      privyDid: body.data.privyDid,
      displayName: body.data.displayName,
      phoneNumber: body.data.phoneNumber,
      loopSenderId: body.data.loopSenderId,
      loopSenderPhone: body.data.loopSenderPhone,
      onboardingProfile: body.data.onboardingProfile || {},
      permissions: body.data.permissions || {},
      contextRepo: body.data.contextRepo || null,
      // Writing doctrine: prefer the explicit top-level field; the resolver
      // also checks onboardingProfile.writingDoctrine and tenant.org so a
      // missing top-level field is not a hard miss.
      writingDoctrine:
        body.data.writingDoctrine ||
        body.data.onboardingProfile?.writingDoctrine ||
        null,
      org: body.data.org || null,
      workspaceDocs: Array.isArray(body.data.workspaceDocs)
        ? body.data.workspaceDocs
        : [],
      preferences: body.data.preferences || {},
      checkInSchedule:
        body.data.checkInSchedule ??
        body.data.onboardingProfile?.checkInSchedule ??
        null,
      _isFallback: false,
      _source: "amber-id",
    };
    cacheSet(`api:${senderId}`, { data: tenant, fetchedAt: Date.now() });
    return tenant;
  } catch (err) {
    console.warn("[tenant] amber-id API resolution failed:", err.message);
    return null;
  }
}

/**
 * Resolve tenant from Loop `sender` UUID via amber-id. Returns null if
 * amber-id has no tenant for that sender, or if the request fails. The
 * caller MUST handle null by dropping the message — never fall back to
 * a hard-coded identity.
 */
/**
 * Build a synthetic "Medha expert" tenant. No medha-id lookup, no owner,
 * no contacts. Used for the public Medha sender (+1 555 010 0005) where
 * the agent serves anyone who texts in as an expert on the three
 * feminine/inward dimensions (spiritual, emotional, physical).
 *
 * Triggered when the inbound Loop sender UUID equals MEDHA_EXPERT_SENDER_ID.
 * Downstream code that branches on `tenant.expertMode === true` uses
 * the expert prompt path (see prompts.js).
 */
function buildMedhaExpertTenant(loopSenderUuid) {
  return {
    kind: "expert",
    expertMode: true,
    id: "medha-expert",
    amberId: "medha-expert",
    privyDid: "did:expert:medha",
    displayName: "Medha",
    agentName: "Medha",
    phoneNumber: "+15550100005",
    loopSenderId: loopSenderUuid,
    loopSenderPhone: "+15550100005",
    onboardingProfile: {},
    permissions: {},
    contextRepo: null,
    _isFallback: false,
    _source: "medha-expert-sender-id",
  };
}

export async function resolveTenant(loopSenderId) {
  if (!loopSenderId) return null;
  const expertSenderId = process.env.MEDHA_EXPERT_SENDER_ID;
  if (expertSenderId && loopSenderId === expertSenderId) {
    return buildMedhaExpertTenant(loopSenderId);
  }
  return await resolveTenantFromApi(loopSenderId);
}

/**
 * Resolve a tenant from a webhook payload, refusing to trust any
 * identity claim that doesn't match amber-id. The webhook can be
 * spoofed (or simply mis-shaped by a Loop API change), so:
 *
 *   1. Resolution is keyed strictly off the Loop `sender` UUID — the
 *      one field amber-id can authoritatively map to a tenant. We do
 *      NOT accept `phone`, `tenant_did`, `tenant_id`, or any other
 *      tenant-identifying field directly from the webhook payload.
 *
 *   2. If the payload includes claimed identity fields (e.g. a
 *      `tenant_did` or `phone_number`), we cross-check them against
 *      the amber-id-resolved tenant and reject mismatches. This
 *      catches accidental misuse and any future provider that adds
 *      tenant claims to the payload shape.
 *
 *   3. The function returns null on ANY mismatch. Callers must drop
 *      the message, not fall back to a hard-coded identity.
 *
 * @param {Object} payload — full webhook payload
 * @param {{senderField?: string}} [opts]
 */
export async function resolveTenantStrict(payload, opts = {}) {
  if (!payload || typeof payload !== "object") return null;
  const senderField = opts.senderField || "sender";
  const loopSenderUuid = payload[senderField] || payload.sender_name || null;
  if (!loopSenderUuid) return null;
  const expertSenderId = process.env.MEDHA_EXPERT_SENDER_ID;
  if (expertSenderId && loopSenderUuid === expertSenderId) {
    // Public expert mode: no medha-id tenant, no claim cross-checks.
    // Synthesize the tenant locally and skip impersonation guards (there
    // is no per-user identity to impersonate in expert mode).
    return buildMedhaExpertTenant(loopSenderUuid);
  }
  const tenant = await resolveTenantFromApi(loopSenderUuid);
  if (!tenant) return null;

  // Reject obvious tenant-impersonation attempts: any tenant-identifying
  // field on the payload must match what amber-id resolved.
  const claims = [
    ["tenant_did", tenant.privyDid],
    ["privy_did", tenant.privyDid],
    ["tenant_id", tenant.id],
    ["phone_number", tenant.phoneNumber],
    ["tenant_phone", tenant.phoneNumber],
  ];
  for (const [field, expected] of claims) {
    const claimed = payload[field];
    if (!claimed) continue;
    if (
      typeof claimed === "string" &&
      typeof expected === "string" &&
      normalizeHandle(claimed) !== normalizeHandle(expected) &&
      claimed !== expected
    ) {
      console.warn(
        `[tenant-strict] reject: payload.${field}="${claimed}" does not match amber-id ("${expected}") for sender=${loopSenderUuid}`,
      );
      return null;
    }
  }
  return tenant;
}

/**
 * List all active tenants that the agent should service.
 *
 * Pulls from amber-id's `/tenants/list?active=true` endpoint so both
 * Camber (Caleb) and Samber (Sagar) — plus any future tenants — get
 * serviced by the same deployment. If amber-id is unreachable or the
 * endpoint returns empty, falls back to the startup tenant so we never
 * silently stop scheduling Caleb's check-ins.
 *
 * Cached for 2 minutes to avoid hammering amber-id from the 60s scheduler tick.
 *
 * @param {Object|null} fallback - Tenant to return if amber-id has nothing
 * @returns {Promise<Tenant[]>}
 */
const TENANT_LIST_CACHE = { at: 0, value: null };
const TENANT_LIST_TTL = 2 * 60 * 1000; // 2 min

export async function listActiveTenants(fallback = null) {
  const now = Date.now();
  if (TENANT_LIST_CACHE.value && now - TENANT_LIST_CACHE.at < TENANT_LIST_TTL) {
    return TENANT_LIST_CACHE.value;
  }

  const apiUrl = process.env.AMBER_ID_API_URL;
  const apiKey = process.env.AMBER_ID_API_KEY;
  const fallbackList = fallback ? [fallback] : [];

  if (!apiUrl || !apiKey) {
    TENANT_LIST_CACHE.at = now;
    TENANT_LIST_CACHE.value = fallbackList;
    return fallbackList;
  }

  try {
    const res = await fetch(`${apiUrl}/tenants/list?active=true`, {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      // 404 = endpoint not yet deployed on amber-id. Don't log every tick.
      if (res.status !== 404) {
        console.warn(`[tenant] /tenants/list returned ${res.status}`);
      }
      TENANT_LIST_CACHE.at = now;
      TENANT_LIST_CACHE.value = fallbackList;
      return fallbackList;
    }
    const body = await res.json();
    const rows = Array.isArray(body.data) ? body.data : [];
    const tenants = rows
      .filter((row) => row && (row.loopSenderId || row.loop_sender_id))
      .map((row) => ({
        id: row.privyDid || row.id,
        amberId: row.id || row.privyDid,
        privyDid: row.privyDid,
        displayName: row.displayName,
        phoneNumber: row.phoneNumber,
        loopSenderId: row.loopSenderId || row.loop_sender_id,
        loopSenderPhone: row.loopSenderPhone || row.loop_sender_phone,
        onboardingProfile: row.onboardingProfile || {},
        permissions: row.permissions || {},
        contextRepo: row.contextRepo || null,
        writingDoctrine:
          row.writingDoctrine || row.onboardingProfile?.writingDoctrine || null,
        org: row.org || null,
        workspaceDocs: Array.isArray(row.workspaceDocs)
          ? row.workspaceDocs
          : [],
        preferences: row.preferences || {},
        checkInSchedule:
          row.checkInSchedule ?? row.onboardingProfile?.checkInSchedule ?? null,
        _isFallback: false,
        _source: "amber-id-list",
      }));

    // If amber-id knows nobody, still service the local fallback so
    // Caleb's check-ins don't vanish while Sagar onboards.
    const value = tenants.length > 0 ? tenants : fallbackList;
    TENANT_LIST_CACHE.at = now;
    TENANT_LIST_CACHE.value = value;
    return value;
  } catch (err) {
    console.warn("[tenant] listActiveTenants failed:", err.message);
    TENANT_LIST_CACHE.at = now;
    TENANT_LIST_CACHE.value = fallbackList;
    return fallbackList;
  }
}

/**
 * Check if a given phone handle is the owner of a tenant.
 */
export function isOwnerOfTenant(handle, tenant) {
  if (!tenant || !tenant.phoneNumber) return false;
  return normalizeHandle(handle) === normalizeHandle(tenant.phoneNumber);
}

// ── Owner identity helpers ──────────────────────────────────────────────────
//
// `tenant.displayName` is the AGENT'S name in our DB ("Camber" / "Samber"),
// NOT the human owner's name. Calling "Good morning, ${displayName}" sends
// "Good morning, Camber" to Caleb — a real bug we've actually shipped. So
// every site that needs to ADDRESS the human must go through these helpers,
// never raw `tenant.displayName`.
//
// Resolution order:
//   1. tenant.ownerName        (explicit override, set by register-tenant)
//   2. tenant.onboardingProfile.ownerName / .firstName
//   3. KNOWN_OWNER_BY_PHONE map (phone → first name) — the safety net
//   4. tenant.displayName      (last resort — only if it doesn't match any
//                               known agent persona)
//
// Add new tenants to KNOWN_OWNER_BY_PHONE as they're onboarded.
const KNOWN_OWNER_BY_PHONE = new Map([
  ["+15550100002", { first: "Caleb", full: "Caleb Newton" }],
  ["+15550100004", { first: "Sagar", full: "Sagar Tiwari" }],
]);

const AGENT_PERSONA_NAMES = new Set(["camber", "samber", "amber", "agent"]);

function normalizePhone(p) {
  if (!p) return null;
  const s = String(p).trim();
  if (s.startsWith("+")) return s;
  if (/^\d{10}$/.test(s)) return `+1${s}`;
  if (/^1\d{10}$/.test(s)) return `+${s}`;
  return s;
}

/**
 * Return the human owner's full name (e.g. "Caleb Newton" / "Sagar Tiwari").
 * Never returns the agent persona name.
 */
export function getOwnerName(tenant) {
  if (!tenant) return null;
  if (typeof tenant.ownerName === "string" && tenant.ownerName.trim())
    return tenant.ownerName.trim();
  const op = tenant.onboardingProfile || {};
  if (typeof op.ownerName === "string" && op.ownerName.trim())
    return op.ownerName.trim();
  if (typeof op.fullName === "string" && op.fullName.trim())
    return op.fullName.trim();
  const phone = normalizePhone(tenant.phoneNumber);
  const known = phone && KNOWN_OWNER_BY_PHONE.get(phone);
  if (known) return known.full;
  // Fall back to displayName ONLY if it's clearly a human name, not an
  // agent persona. "Camber" / "Samber" → reject.
  const dn = tenant.displayName;
  if (typeof dn === "string" && dn.trim()) {
    const firstWord = dn.trim().split(/\s+/)[0].toLowerCase();
    if (!AGENT_PERSONA_NAMES.has(firstWord)) return dn.trim();
  }
  return null;
}

/**
 * Return the human owner's first name only (e.g. "Caleb"). Used in greetings
 * ("Good morning, ${first}") and prompt vars. Never returns agent persona.
 */
export function getOwnerFirstName(tenant) {
  if (!tenant) return null;
  const op = tenant.onboardingProfile || {};
  if (typeof op.firstName === "string" && op.firstName.trim())
    return op.firstName.trim();
  const phone = normalizePhone(tenant.phoneNumber);
  const known = phone && KNOWN_OWNER_BY_PHONE.get(phone);
  if (known) return known.first;
  const full = getOwnerName(tenant);
  if (full) return full.split(/\s+/)[0];
  return null;
}

/**
 * Return the AGENT persona name (Camber, Samber, etc). This IS
 * `tenant.displayName` in our current schema.
 *
 * NOTE: this is the INTERNAL persona name used for logs, tool routing, and
 * dev-only contexts. For anything a real user can read, prefer
 * `getPublicAgentName(tenant)` so production responses brand as "Amber"
 * (Amber-Dvlp / Amber-Prod are internal-only labels for the two iMessage
 * numbers). See docs/SMOKE-TESTING.md.
 */
export function getAgentName(tenant) {
  if (!tenant) return "Amber";
  if (typeof tenant.agentName === "string" && tenant.agentName.trim())
    return tenant.agentName.trim();
  if (typeof tenant.displayName === "string" && tenant.displayName.trim())
    return tenant.displayName.trim();
  return "Amber";
}

/**
 * User-facing agent name. Always returns "Amber" unless a tenant has
 * `preferences.useInternalPersonaName === true` (a deliberate operator
 * opt-in, used for the dev / Amber-Dvlp number while we're iterating).
 *
 * The product is branded "Amber" externally — Camber and Samber are
 * internal engineering / ops handles for the two Loop senders and must
 * never bleed into a user-facing reply.
 */
export function getPublicAgentName(tenant) {
  if (tenant?.preferences?.useInternalPersonaName === true) {
    return getAgentName(tenant);
  }
  // Explicit env override for the dev number so smoke tests can flip
  // back to the internal persona name without editing per-tenant
  // preferences. Production must NOT set this flag.
  if (
    typeof process !== "undefined" &&
    process.env &&
    process.env.AMBER_USE_INTERNAL_PERSONA_NAME === "1"
  ) {
    return getAgentName(tenant);
  }
  return "Medha";
}

/**
 * Invalidate cached tenant (call after tenant profile updates).
 */
export function invalidateTenantCache(senderId, amberId) {
  if (senderId) tenantCache.delete(`sender:${senderId}`);
  if (amberId) tenantCache.delete(`amber:${amberId}`);
}

// ── Internal helpers ────────────────────────────────────────────────────

function rowToTenant(row) {
  return {
    id: row.id,
    amberId: row.amber_id,
    displayName: row.display_name,
    phoneNumber: row.phone_number,
    loopSenderId: row.loop_sender_id,
    loopSenderPhone: row.loop_sender_phone,
    onboardingProfile: row.onboarding_profile || {},
    permissions: row.permissions || {},
    contextRepo: row.context_repo || null,
    _isFallback: false,
  };
}
