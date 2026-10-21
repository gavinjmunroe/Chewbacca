/**
 * Permission tiers for contacts.
 * owner: Caleb, full tools, full context, all capabilities
 * trusted: select tools (search, calendar), health tracking, memory
 * basic: chat only, health inference, no tools
 */

import { CALEB_PHONE } from "./constants.js";
import { isOwnerOfTenant } from "./tenant.js";

export const PERMISSION_TIERS = {
  owner: {
    tools: true,
    webSearch: true,
    nativeWebSearch: true,
    github: true,
    todoist: true,
    composio: true,
    healthTracking: true,
    memoryAccess: true,
    proactiveMessages: true,
    fullContext: true,
  },
  trusted: {
    tools: false,
    webSearch: true,
    nativeWebSearch: false,
    github: false,
    todoist: false,
    composio: false,
    healthTracking: true,
    memoryAccess: true,
    proactiveMessages: false,
    fullContext: false,
  },
  basic: {
    tools: false,
    webSearch: true,
    nativeWebSearch: false,
    github: false,
    todoist: false,
    composio: false,
    healthTracking: true,
    memoryAccess: false,
    proactiveMessages: false,
    fullContext: false,
  },
};

export function normalizeHandle(raw) {
  if (!raw || !raw.trim()) return "unknown";
  const trimmed = raw.trim();
  // Slack synthetic identifiers (slack:<team>:<user>) are not phones;
  // pass through so the slack session map in transport.js can find the
  // routing context for outbound replies. Without this, the digits-only
  // path mangles "slack:T087JNEUVHD:U0AEBS2UXRB" into "+08702" and the
  // reply falls through to Loop, which 400s.
  if (trimmed.startsWith("slack:")) return trimmed;
  if (trimmed.includes("@")) return trimmed.toLowerCase();
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return trimmed.toLowerCase();
  if (/^\d{10}$/.test(digits)) return `+1${digits}`;
  if (/^\d{11}$/.test(digits) && digits.startsWith("1")) return `+${digits}`;
  if (trimmed.startsWith("+")) return trimmed;
  return `+${digits}`;
}

/**
 * Check if handle is the owner. Supports both modes:
 * - Multi-tenant: pass a tenant object as second arg
 * - Legacy single-tenant: falls back to CALEB_PHONE env var
 */
export function isOwner(handle, tenant = null) {
  if (tenant) return isOwnerOfTenant(handle, tenant);
  return normalizeHandle(handle) === normalizeHandle(CALEB_PHONE);
}

export function getPermissionTier(contact) {
  if (contact.isCaleb) return "owner";
  if (contact.trustScore >= 0.8) return "trusted";
  return "basic";
}

export function hasPermission(contact, permission) {
  const tier = getPermissionTier(contact);
  return PERMISSION_TIERS[tier]?.[permission] || false;
}
