/**
 * vCard builder for the Amber contact card.
 *
 * Used at EDC and other in-person events so people can save Amber's
 * number directly from an iMessage attachment instead of typing a
 * phone number. Loop Message accepts a `contact_file` URL field on
 * /api/v1/message/send/ and renders it as a tap-to-save contact
 * bubble.
 *
 * Identity rules (CRITICAL — see docs/prod-readiness on identity-leak):
 *   - The vCard must NEVER reveal the human owner's name. The shared
 *     card is Amber-branded only. We use getPublicAgentName(tenant)
 *     which always returns "Amber" in production.
 *   - The phone number is the tenant's `loopSenderPhone` (the public
 *     iMessage sender), NOT `tenant.phoneNumber` (the human owner).
 *
 * No external deps — we hand-roll vCard 3.0 because every npm package
 * for this is either abandoned or pulls in a useless transitive tree.
 */

import { getPublicAgentName } from "./tenant.js";

/**
 * Build a vCard 3.0 body for the public Amber identity attached to a
 * tenant. Returns null if the tenant has no loopSenderPhone, since
 * there's nothing to share in that case.
 *
 * @param {Object} tenant - Resolved tenant object.
 * @returns {string|null} vCard body, CRLF-terminated, or null.
 */
export function buildAmberVcard(tenant) {
  if (!tenant) return null;
  const phone = tenant.loopSenderPhone;
  if (!phone || typeof phone !== "string") return null;

  const name = getPublicAgentName(tenant) || "Amber";
  const safeName = name.replace(/[;\\,]/g, " ").trim() || "Amber";
  const safePhone = phone.trim();

  // vCard 3.0 — RFC 2426. CRLF line endings, escaped delimiters,
  // single TEL with TYPE=CELL,iPhone so iMessage previews cleanly.
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${safeName}`,
    `N:${safeName};;;;`,
    `ORG:${safeName};`,
    "TITLE:Personal assistant",
    `TEL;TYPE=CELL,VOICE,iPhone:${safePhone}`,
    "END:VCARD",
    "",
  ];
  return lines.join("\r\n");
}

/**
 * Filename used when serving the vCard over HTTP. Loop dereferences
 * the URL and uses the file's basename + Content-Type for the
 * attachment, so the name shows up in the iMessage bubble.
 */
export function vcardFilename(tenant) {
  const name = getPublicAgentName(tenant) || "Amber";
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, "");
  return `${safe || "Amber"}.vcf`;
}
