/**
 * WHO IS ALLOWED TO OVERWRITE WHAT.
 *
 * Every contact field arrives from somewhere, and until now "somewhere" was a
 * free-text label. Thirty-odd distinct strings were in use (`apple`, `manual`,
 * `amber_manual`, `app_voice`, `soundboard`, `parsed`, `firestore_fallback`,
 * `pinecone`, ...), all equal. That meant a vendor guess and a thing the person
 * said out loud ranked the same, and the last writer won.
 *
 * That is the wrong default for a system of record. A person who corrects their
 * friend's job title must not have it silently undone the next time an enrichment
 * run disagrees, or they stop trusting the app -- and a rolodex nobody trusts is
 * not a rolodex.
 *
 * FOUR TIERS, highest wins:
 *
 *   3 OWNER_STATED   the person typed it, said it, or saved it by hand.
 *   2 OWNER_SYNCED   their own connected account said it (Apple, Google, LinkedIn).
 *                    Authoritative about the card, but the person never checked it.
 *   1 AMBER_DERIVED  we inferred it -- parsed from text, filled from a web result.
 *   0 VENDOR         a third party sold it to us. Clay, Pinecone, enrichment runs.
 *
 * THE RULE: a lower tier NEVER overwrites a populated field written by a higher
 * one. It may always FILL a blank, and it is always recorded as provenance, so
 * nothing is lost -- the value is available as an alternate the person can promote,
 * it just does not get to win silently.
 *
 * An unrecognized source is treated as tier 0, deliberately. A new integration
 * someone adds without touching this file can fill blanks and can never clobber.
 * Failing closed is the whole point; add the label here to give it more power.
 */

export const TRUST = Object.freeze({
  OWNER_STATED: 3,
  OWNER_SYNCED: 2,
  AMBER_DERIVED: 1,
  VENDOR: 0,
});

export const UNKNOWN_TRUST = TRUST.VENDOR;

/**
 * Label → tier. Keys are the canonical form produced by normalizeSource(), so a
 * versioned or suffixed label (`slack-thread-2026-05-26`) maps by its prefix.
 */
const TIERS = new Map([
  // ── 3: the person themselves ───────────────────────────────────────────────
  ["manual", TRUST.OWNER_STATED],
  ["amber_manual", TRUST.OWNER_STATED],
  ["user", TRUST.OWNER_STATED],
  ["app_voice", TRUST.OWNER_STATED],
  ["app_web_save", TRUST.OWNER_STATED],
  ["app_favorite", TRUST.OWNER_STATED],
  ["contact_note", TRUST.OWNER_STATED],
  ["amber_note", TRUST.OWNER_STATED],
  ["soundboard", TRUST.OWNER_STATED],
  ["voice", TRUST.OWNER_STATED],
  // Adding a contact from a thread is a deliberate act, unlike merely being
  // messaged by one, which is `imessage_dm` below.
  ["imessage_addcontact", TRUST.OWNER_STATED],

  // ── 2: their own connected accounts ────────────────────────────────────────
  ["apple", TRUST.OWNER_SYNCED],
  ["google", TRUST.OWNER_SYNCED],
  ["carddav", TRUST.OWNER_SYNCED],
  ["linkedin", TRUST.OWNER_SYNCED],
  ["github", TRUST.OWNER_SYNCED],
  ["twitter", TRUST.OWNER_SYNCED],
  ["slack", TRUST.OWNER_SYNCED],
  ["imessage", TRUST.OWNER_SYNCED],
  ["imessage_dm", TRUST.OWNER_SYNCED],
  ["imessage_dq", TRUST.OWNER_SYNCED],
  ["vcard", TRUST.OWNER_SYNCED],

  // ── 1: Amber's own inference ───────────────────────────────────────────────
  ["parsed", TRUST.AMBER_DERIVED],
  ["reminders_parse", TRUST.AMBER_DERIVED],
  ["web_search", TRUST.AMBER_DERIVED],
  ["web_profile_fill", TRUST.AMBER_DERIVED],
  ["peoplerank_enrich", TRUST.AMBER_DERIVED],
  ["otp-auto-provision", TRUST.AMBER_DERIVED],
  ["firestore_fallback", TRUST.AMBER_DERIVED],
  ["amber", TRUST.AMBER_DERIVED],

  // ── 0: bought from someone else ────────────────────────────────────────────
  ["clay", TRUST.VENDOR],
  ["pinecone", TRUST.VENDOR],
  ["enrichment", TRUST.VENDOR],
  ["enformion", TRUST.VENDOR],
  ["apollo", TRUST.VENDOR],
  ["mcp", TRUST.VENDOR],
]);

/**
 * Fold a raw label to its canonical key.
 *
 * Lowercases, trims, and cuts a dated or id-bearing suffix off the stem so
 * `slack-thread-2026-05-26` is `slack` rather than its own unknown source that
 * silently drops to tier 0. Returns null for a blank.
 */
export function normalizeSource(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (TIERS.has(s)) return s;
  // `slack-thread-...`, `google-people-v1`, `clay:table-42` → the stem.
  const stem = s.split(/[-:/]/)[0];
  if (stem && TIERS.has(stem)) return stem;
  return s;
}

/** Tier for a raw label. Unrecognized → UNKNOWN_TRUST (0), by design. */
export function trustOf(raw) {
  const key = normalizeSource(raw);
  if (!key) return UNKNOWN_TRUST;
  const tier = TIERS.get(key);
  return tier === undefined ? UNKNOWN_TRUST : tier;
}

/** Every label this file knows, for the backfill and its test. */
export function knownSources() {
  return [...TIERS.keys()];
}

/**
 * May `incoming` replace a POPULATED field last written by `existing`?
 *
 * Blank fields are not this function's business -- a blank always fills, from any
 * source, and the caller handles that before asking. This answers only the
 * contested case.
 *
 * Equal tiers: yes only when `authoritative`, meaning the source is restating a
 * card it owns (same source, same external id). That is what lets a contact
 * RENAMED in Apple Contacts rename here, while a DIFFERENT Apple-tier card
 * merging in may only fill blanks.
 */
export function canOverwrite(incoming, existing, { authoritative = false } = {}) {
  const a = trustOf(incoming);
  const b = trustOf(existing);
  if (a > b) return true;
  if (a < b) return false;
  return Boolean(authoritative);
}

/**
 * Pick between two values for one field. Returns the value that should be stored
 * and why, so a caller can record the losing value as an alternate rather than
 * dropping it.
 */
export function resolveField(
  { value: incomingValue, source: incomingSource },
  { value: existingValue, source: existingSource },
  { authoritative = false } = {},
) {
  const blank = (v) => v == null || (typeof v === "string" && v.trim() === "");
  if (blank(incomingValue)) {
    return { value: existingValue, winner: "existing", reason: "incoming_blank" };
  }
  if (blank(existingValue)) {
    return { value: incomingValue, winner: "incoming", reason: "filled_blank" };
  }
  if (String(incomingValue).trim() === String(existingValue).trim()) {
    return { value: existingValue, winner: "existing", reason: "identical" };
  }
  if (canOverwrite(incomingSource, existingSource, { authoritative })) {
    return { value: incomingValue, winner: "incoming", reason: "higher_trust" };
  }
  return { value: existingValue, winner: "existing", reason: "lower_trust" };
}
