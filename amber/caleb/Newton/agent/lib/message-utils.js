/**
 * Message utilities — pure/near-pure helpers extracted from agent.js.
 *
 *  - extractNamesFromHistory: scrape first-names from user messages
 *  - isDuplicateMessage:      30s content+id dedup window
 *
 * Kept separate so agent.js can stay focused on the webhook loop + startup.
 */

import { FINGERPRINT_TTL } from "./constants.js";

const NAME_PATTERNS = [
  /\bi['\u2019\u2018]?m\s+([A-Z][a-z]{1,20})\b/,
  /\bmy name['\u2019\u2018]?s?\s+(?:is\s+)?([A-Z][a-z]{1,20})\b/i,
  /\bthis is\s+([A-Z][a-z]{1,20})\b/i,
  /\bi am\s+([A-Z][a-z]{1,20})\b/i,
  /^([A-Z][a-z]{1,20})\s+here\b/,
  /^([A-Z][a-z]{1,20})\s*[,!]\s/,
];

export function extractNamesFromHistory(history) {
  const names = new Map(); // phone -> firstName
  for (const msg of history) {
    if (msg.role !== "user" || !msg.from || names.has(msg.from)) continue;
    for (const pattern of NAME_PATTERNS) {
      const m = msg.content.match(pattern);
      if (m) {
        names.set(msg.from, m[1]);
        break;
      }
    }
  }
  return names;
}

// Module-scoped dedup cache — 30s TTL. Safe to have one cache per agent
// process since each agent instance handles its own webhook traffic.
const recentMessageFingerprints = new Map();

export function isDuplicateMessage(from, text, messageId) {
  const now = Date.now();
  // Sweep expired entries first so the cache doesn't grow unbounded.
  for (const [key, ts] of recentMessageFingerprints) {
    if (now - ts > FINGERPRINT_TTL) recentMessageFingerprints.delete(key);
  }
  // Primary fingerprint: from + text content (catches Loop sending the
  // same message body with different IDs).
  const contentFingerprint = `${from}:${(text || "").slice(0, 100)}`;
  if (recentMessageFingerprints.has(contentFingerprint)) return true;
  recentMessageFingerprints.set(contentFingerprint, now);
  // Secondary fingerprint: exact messageId (catches exact retransmissions).
  if (messageId) {
    const idFingerprint = `id:${messageId}`;
    if (recentMessageFingerprints.has(idFingerprint)) return true;
    recentMessageFingerprints.set(idFingerprint, now);
  }
  return false;
}
