/**
 * Togari enterprise access policy.
 *
 * The single source of truth for "which surface is allowed to ACTIVATE the
 * Togari enterprise tier (BMA contact graph + opportunity sequencer + warehouse
 * write paths)." Read sites should call into here instead of re-deriving the
 * rule, so changes to enterprise eligibility don't require chasing every
 * surface.
 *
 * The rule (see Tiwari/YOGA-MODEL.md and docs/TOGARI-ACCESS-POLICY.md):
 *
 *   - Activation surface  = iMessage/Loop-verified concierge ONLY.
 *     A request must originate from a Loop Message webhook whose `sender`
 *     UUID resolved (via amber-id) to a tenant carrying the `amber_imsg`
 *     entitlement. amber-agent is the only Amber surface allowed to
 *     activate enterprise; amber-id stays the private passport, Togari
 *     stays warehouse/API complement.
 *
 *   - iOS / iPadOS / macOS / visionOS clients (the Tiwari proxy) CANNOT
 *     activate enterprise. They may *consume* PeopleRank / Opportunity /
 *     Enrich on already-allowed user-dataset relationships (per their own
 *     entitlements); they must not be the channel that flips the bit.
 *
 *   - Camber (Caleb) and Samber (Sagar) are separate tenants with separate
 *     amber-id DIDs and separate Pinecone namespaces. Activation on one
 *     tenant never grants activation to the other; the policy is keyed off
 *     the resolved tenant, never global env.
 *
 * Why this lives in its own module: the activation gate is checked from at
 * least three places (the iMessage agent loop, the tiwari-proxy HTTP layer,
 * and the scheduled-job runner). Inlining the check led to drift — one site
 * accepted iOS, another silently allowed unauthenticated webhooks. One file,
 * one rule.
 */

/** Sources amber-agent recognizes for an inbound activation request. */
export const ACTIVATION_SOURCES = Object.freeze({
  IMESSAGE_LOOP: "imessage_loop",
  IOS_PROXY: "ios_proxy",
  SCHEDULED_JOB: "scheduled_job",
  ADMIN_CLI: "admin_cli",
  UNKNOWN: "unknown",
});

const ENTERPRISE_ENTITLEMENT_KEYS = Object.freeze([
  "amber_imsg",         // tier flag set by amber-id
  "togari_enterprise",  // explicit per-tenant override
  "imessage_concierge", // entitlement bag form (see tiwari-proxy.deriveEntitlements)
]);

/**
 * Read a tenant's entitlement bag in the same shape tiwari-proxy uses, with
 * a fallback to the legacy `tenant.permissions` map. Returns a plain object
 * with the boolean keys we know about (missing keys are treated as false).
 */
function readEntitlements(tenant) {
  if (!tenant || typeof tenant !== "object") return {};
  // Tier-derived bag (set by amber-id /tenants/resolve or by tiwari-proxy)
  const fromBag = tenant.entitlements && typeof tenant.entitlements === "object"
    ? tenant.entitlements
    : {};
  const fromPerms = tenant.permissions && typeof tenant.permissions === "object"
    ? tenant.permissions
    : {};
  // Tier string — amber_imsg implies enterprise activation right
  const tier = typeof tenant.tier === "string" ? tenant.tier.toLowerCase() : null;
  const tierImpliesEnterprise = tier === "amber_imsg";
  return { ...fromPerms, ...fromBag, ...(tierImpliesEnterprise ? { amber_imsg: true } : {}) };
}

/**
 * True iff the resolved tenant carries any entitlement that authorizes
 * Togari enterprise activation. Pure function — no I/O.
 *
 * @param {object|null} tenant
 * @returns {boolean}
 */
export function tenantHasEnterpriseEntitlement(tenant) {
  if (!tenant) return false;
  const ent = readEntitlements(tenant);
  return ENTERPRISE_ENTITLEMENT_KEYS.some((k) => ent[k] === true);
}

/**
 * The full activation decision. Returns a structured result so callers can
 * log a stable reason code instead of stringly-typed booleans.
 *
 * @param {object} args
 * @param {string} args.source - one of ACTIVATION_SOURCES
 * @param {object|null} args.tenant - resolved tenant (must come from amber-id)
 * @param {boolean} [args.loopVerified] - true iff the inbound webhook auth
 *   passed (Loop signature + sender resolution). Required when source is
 *   IMESSAGE_LOOP.
 * @returns {{allowed: boolean, reason: string, source: string}}
 */
export function evaluateActivation({ source, tenant, loopVerified } = {}) {
  const src = source || ACTIVATION_SOURCES.UNKNOWN;

  if (src === ACTIVATION_SOURCES.IOS_PROXY) {
    return { allowed: false, reason: "ios_cannot_activate_enterprise", source: src };
  }
  if (src === ACTIVATION_SOURCES.UNKNOWN) {
    return { allowed: false, reason: "unknown_source", source: src };
  }
  if (!tenant || !tenant.privyDid) {
    return { allowed: false, reason: "tenant_unresolved", source: src };
  }
  if (src === ACTIVATION_SOURCES.IMESSAGE_LOOP && loopVerified !== true) {
    return { allowed: false, reason: "loop_signature_unverified", source: src };
  }
  if (!tenantHasEnterpriseEntitlement(tenant)) {
    return { allowed: false, reason: "missing_enterprise_entitlement", source: src };
  }

  // Scheduled jobs and admin CLI are allowed only when running on behalf of
  // a tenant that *already* has the entitlement. They cannot be the source
  // of an *upgrade* — that path goes through the iMessage flow.
  if (src === ACTIVATION_SOURCES.SCHEDULED_JOB || src === ACTIVATION_SOURCES.ADMIN_CLI) {
    return { allowed: true, reason: "preauthorized_tenant", source: src };
  }
  if (src === ACTIVATION_SOURCES.IMESSAGE_LOOP) {
    return { allowed: true, reason: "loop_verified_concierge", source: src };
  }
  return { allowed: false, reason: "unrecognized_source", source: src };
}

/**
 * Convenience: throw a structured error if activation is not allowed.
 * Use at the top of any handler that mutates Togari enterprise state.
 *
 * @throws {Error & {code: string, source: string}} on denial
 */
export function assertActivationAllowed(args) {
  const decision = evaluateActivation(args);
  if (decision.allowed) return decision;
  const err = new Error(`togari activation denied: ${decision.reason}`);
  err.code = decision.reason;
  err.source = decision.source;
  throw err;
}

/**
 * Read-side companion: which Tiwari read primitives is iOS allowed to
 * consume against this tenant? iOS gets PeopleRank / Opportunity / Enrich
 * only on user-dataset relationships the tenant already owns — never on
 * enterprise-level Togari surfaces (raw warehouse, campaigns, lead intake).
 *
 * Returns the set of primitive names iOS may call. amber-agent's iMessage
 * loop is unrestricted by this function; it gates separately via
 * evaluateActivation + per-tool entitlement checks.
 */
export function iosAllowedReadPrimitives(tenant) {
  const ent = readEntitlements(tenant);
  const allowed = new Set();
  if (ent.peoplerank === true) allowed.add("peoplerank");
  if (ent.enrich === true) allowed.add("enrich");
  // Opportunity is allowed for iOS only on non-enterprise channels (e.g.
  // the email draft path). The opportunity module itself enforces channel
  // billing gates; here we just permit the primitive call shape.
  if (ent.email === true || ent.peoplerank === true) allowed.add("opportunity");
  return allowed;
}
