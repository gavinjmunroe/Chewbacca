/**
 * Rave Master v1 — single-tenant, single-event gate.
 *
 * Locked v1 scope (see amber_rave_master_build_brief.md):
 *   - User:  Sagar only.
 *   - Event: EDC 2026.
 *   - Visibility: private/Sagar-owned.
 *
 * Everything else in the Rave Master module short-circuits unless this
 * gate returns true. Generalization (multi-tenant, rolling weekends,
 * shared visibility) is intentionally deferred.
 */
import { normalizeHandle } from "../permissions.js";

// Sagar's phone — matches the KNOWN_OWNER_BY_PHONE entry in lib/tenant.js.
// We re-anchor on phone (not displayName) because displayName is the agent
// persona ("Samber"), not the human owner.
const SAGAR_PHONE = "+15550100004";

export const EDC_2026_EVENT_TITLE = "EDC 2026";

export function eventIdForTenant(tenant) {
  const did = tenant?.privyDid || tenant?.amberId || tenant?.id;
  if (!did) return null;
  return `event:${did}:edc:2026`;
}

export function isSagarTenant(tenant) {
  if (!tenant?.phoneNumber) return false;
  return normalizeHandle(tenant.phoneNumber) === normalizeHandle(SAGAR_PHONE);
}

export function isRaveMasterEnabledForTenant(tenant) {
  if (process.env.RAVE_MASTER_ENABLED !== "1") return false;
  return isSagarTenant(tenant);
}

// Exported for tests / future generalization.
export const _SAGAR_PHONE_FOR_TEST = SAGAR_PHONE;
