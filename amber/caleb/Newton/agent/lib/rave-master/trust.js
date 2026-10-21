/**
 * Trust resolution for Rave Master.
 *
 * "Trusted" means: this person is allowed to receive the latest event
 * plan when they text the Amber number during the event. The build
 * brief is explicit that unknown senders must NOT get the plan — they
 * should identify themselves first and Sagar gets notified.
 *
 * Trust signals (in order):
 *   1. Handle is on `card.trusted_handles` (explicit add by Sagar).
 *   2. Handle is the tenant owner.
 * Anything else is untrusted by default.
 *
 * Future signals we deliberately do NOT use yet:
 *   - High trustScore on the contact profile (the field exists in
 *     lib/contacts.js but is auto-computed; trusting it for plan
 *     disclosure would leak the plan to anyone who's chatted a lot).
 *   - Group-chat membership (groups don't imply consent to private
 *     plan retrieval; Sagar may share with one person from a group).
 */

import { normalizeHandle } from "../permissions.js";

export function isTrustedForEvent(handle, card, { isOwner = false } = {}) {
  if (isOwner) return true;
  if (!handle || !card) return false;
  const norm = normalizeHandle(handle);
  const set = new Set(
    (card.trusted_handles || []).map((h) => normalizeHandle(h)),
  );
  return set.has(norm);
}

/**
 * Parse a Sagar-only admin command: "RAVE: trust +13105551212"
 * Returns null when the text isn't an admin command.
 */
export function parseRaveAdminCommand(text) {
  if (!text || typeof text !== "string") return null;
  const m = text.match(/^\s*rave\s*:\s*(trust|untrust|plan|approve|status|reset)\b\s*(.*)$/i);
  if (!m) return null;
  const cmd = m[1].toLowerCase();
  const arg = (m[2] || "").trim();
  if (cmd === "trust" || cmd === "untrust") {
    const handles = arg
      .split(/[\s,]+/)
      .map((h) => h.trim())
      .filter(Boolean)
      .map(normalizeHandle);
    return { cmd, handles };
  }
  return { cmd, arg };
}
