/**
 * phone.js — single source of truth for E.164 normalization.
 *
 * Every BQ row keyed by person_id (sha256(E.164)) MUST run the phone
 * through this normalizer first. Without that invariant, two messages
 * from the same human can land under different person_ids and the
 * cross-event memory pillar (decision 11) silently breaks.
 *
 * Rules:
 *   - Strip everything but digits and a leading '+'
 *   - 10 digits → assume US, prepend +1
 *   - 11 digits starting with 1 → +<digits>
 *   - Already starts with + → keep as-is (after stripping junk)
 *   - Anything that doesn't end up resembling a phone returns null,
 *     because guessing on garbage produces ghost rows that haunt joins.
 *
 * Email handles (iCloud accounts on iMessage) are NOT phones; pass
 * them through unchanged via `normalizeHandle` instead of this fn.
 */

/**
 * Returns canonical "+1234567890" or null if the input doesn't resolve
 * to a recognizable phone number.
 */
export function toE164(raw) {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Email-shaped handles (iMessage iCloud IDs) — never a phone.
  if (trimmed.includes("@")) return null;
  // Strip everything but digits and leading +.
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  if (hasPlus) {
    // Already E.164-ish; just normalize spacing/dashes off.
    return `+${digits}`;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  // International number with no plus sign — best-effort prepend.
  // Caller code that needs strict guarantees should check the length.
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return null;
}

/**
 * Handle normalizer that's tolerant of both phones and email iMessage
 * handles. Returns the canonical form for either, or null if neither.
 * Used at the *application* layer where downstream code wants ONE
 * stable string per identity but doesn't care if it's a phone or email.
 */
export function canonicalHandle(raw) {
  if (!raw || typeof raw !== "string") return null;
  const t = raw.trim();
  if (!t) return null;
  if (t.includes("@")) return t.toLowerCase();
  return toE164(t);
}
