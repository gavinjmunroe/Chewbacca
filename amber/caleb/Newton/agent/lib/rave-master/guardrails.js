/**
 * Hard guardrails for Rave Master.
 *
 * Non-negotiable rule (build brief): do not facilitate illegal drug
 * procurement, distribution, dosing, hiding, or usage logistics. We may
 * classify substance-related messages as safety context for harm-reduction
 * routing — that's all.
 *
 * Procurement / dosing INTENT is the bright line. A message that just
 * mentions "molly" is safety context. A message that says "where can I
 * cop molly" is procurement and must never be drafted into a group
 * update or echoed back to a friend.
 */

const PROCUREMENT_PATTERNS = [
  /\bwhere (?:can|do|to) (?:i|we|u|you) (?:get|buy|find|cop|score|pick up)\b/i,
  /\b(?:got|have|need|want|got any|hook me up|hook us up|hook (?:up|me|us|you))\b.{0,40}\b(stuff|tabs?|caps?|pills?|molly|mdma|acid|shrooms?|ket(?:amine)?|coke|cocaine|2c-?[bicd])\b/i,
  /\bplug\b/i,
  /\bdealer\b/i,
  /\b(?:source|sourcing) (?:a|some|the)?\s?(?:tab|cap|pill|gram|cap|stuff|product)/i,
  /\bhide (?:my|the|some) (?:tabs?|caps?|pills?|molly|mdma|acid|shrooms?)/i,
  /\bsmuggle\b/i,
  /\b(?:dose|dosing|dosage|micro-?dose|re-?dose) (?:advice|guide|how|me|us|recommendation)/i,
  /\bhow (?:much|many) (?:should|do) (?:i|we) (?:take|drop|swallow)\b/i,
];

export function containsProcurementIntent(text) {
  if (!text || typeof text !== "string") return false;
  return PROCUREMENT_PATTERNS.some((p) => p.test(text));
}

/**
 * Sanitize a candidate draft for the group: if it contains procurement
 * intent OR dosing language, refuse to draft and return a flag for the
 * caller to surface to Sagar. Caller decides what to do — typically
 * route the underlying message into the festival.js substance redirect
 * for the friend, and notify Sagar with a "won't draft" note.
 */
export function refuseProcurementDraft(text) {
  if (!containsProcurementIntent(text)) return { ok: true };
  return {
    ok: false,
    reason:
      "Refused to draft: message contains procurement / dosing intent. " +
      "Rave Master will not assist with sourcing, dosing, distribution, " +
      "or hiding substances. Use the SAFE harm-reduction script instead.",
  };
}
