/**
 * person-resolver.js — phone → person_id mapping.
 *
 * person_id is `sha256(toE164(phone))` truncated to 32 hex chars.
 * Stable across medha_pdw AND togari_pdw (decision 19) so the future
 * Amber unification join is free.
 *
 * IMPORTANT: never compute person_id from a raw phone string. Always
 * normalize through toE164() first so "+1 (555) 010-0002", "5550100002",
 * and "+15550100002" collapse to the same identity.
 */

import { createHash } from "node:crypto";
import { toE164 } from "./phone.js";

/**
 * Compute the canonical person_id for a phone. Returns null if the
 * input doesn't normalize to a phone (e.g. an email handle or garbage).
 */
export function personIdFromPhone(rawPhone) {
  const e164 = toE164(rawPhone);
  if (!e164) return null;
  return createHash("sha256")
    .update(e164.toLowerCase())
    .digest("hex")
    .slice(0, 32);
}

/**
 * Same idea but takes whatever handle Loop hands us (could be email
 * for iMessage iCloud accounts). For non-phone handles we hash the
 * lowercased handle directly — different namespace, same id_format
 * shape so downstream code doesn't care.
 */
export function personIdFromHandle(rawHandle) {
  if (!rawHandle || typeof rawHandle !== "string") return null;
  const t = rawHandle.trim();
  if (!t) return null;
  if (t.includes("@")) {
    return createHash("sha256")
      .update(t.toLowerCase())
      .digest("hex")
      .slice(0, 32);
  }
  return personIdFromPhone(t);
}
