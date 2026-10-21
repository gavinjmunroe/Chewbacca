/**
 * person-mentions.js — match names inside free-form text against a list of
 * known contacts.
 *
 * Used by the personal-life recall path: when Sagar asks "what is Shirley
 * working on?", we look at recent journal entries and need to surface the
 * ones that mention Shirley even when she's not explicitly listed in the
 * entry's `with` array. The structured `with_slugs` filter handles
 * deliberate tags; this helper handles the cases where Sagar just types
 * "Shirley shipped the new landing page" inline.
 *
 * Matching rules:
 *   1. Word-boundary, case-insensitive — "Shirley shipped" matches but
 *      "shirleyshipped" or "shirleyy" do not.
 *   2. Match against contact firstName when present, otherwise the first
 *      whitespace-delimited token of name. Both must be at least three
 *      characters to avoid matching common words like "Al" or "Em".
 *   3. The same contact only contributes one hit per text, even when the
 *      first name appears multiple times.
 *
 * The function is pure and synchronous so the recall route can call it on
 * hundreds of journal entries without async overhead, and so it's trivial
 * to unit-test.
 */

import { nameBoundaryRegex } from "./name-boundary.js";

const NAME_TOKEN_MIN_LENGTH = 3;
const NAME_TOKEN_MAX_LENGTH = 40;
// Guard against a pathologically large body running word-boundary regex over
// megabytes of text on the recall path; journal entries are short in practice.
const MAX_SCAN_LENGTH = 20000;


// Inline citation markers ("[[p:CONTACT_ID]]", whole or a mid-stream fragment)
// are not prose and must never be matched as a name mention, since a contact id can
// contain a name-like token. Strip both complete and trailing-partial markers
// before scanning. Pure; returns "" for any non-string input.
function stripCitationMarkers(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/\[\[p:[^\]]*\]\]/g, " ")
    .replace(/\[\[p:[^\]]*$/g, " ")
    .slice(0, MAX_SCAN_LENGTH);
}

/**
 * Pull the candidate first-name token from a contact row. Returns null if
 * the contact has no usable token (no firstName, no name, or only initials).
 */
export function firstNameToken(contact) {
  if (!contact || typeof contact !== "object") return null;
  const raw =
    (typeof contact.firstName === "string" && contact.firstName.trim()) ||
    (typeof contact.name === "string" && contact.name.trim().split(/\s+/)[0]) ||
    "";
  const token = raw.replace(/[^A-Za-z'\-]/g, "");
  if (token.length < NAME_TOKEN_MIN_LENGTH) return null;
  if (token.length > NAME_TOKEN_MAX_LENGTH) return null;
  return token;
}

/**
 * Scan `text` for occurrences of the given contacts' first names. Returns
 * the subset of contacts whose first name was found.
 *
 *   findMentionedContacts("Shirley shipped the page", [
 *     { id: "c1", firstName: "Shirley" },
 *     { id: "c2", firstName: "Alinna" },
 *   ])
 *   // -> [{ id: "c1", firstName: "Shirley" }]
 */
export function findMentionedContacts(text, contacts) {
  if (!text || typeof text !== "string") return [];
  if (!Array.isArray(contacts) || contacts.length === 0) return [];
  const scan = stripCitationMarkers(text);
  if (!scan.trim()) return [];
  const hits = [];
  const seen = new Set();
  for (const contact of contacts) {
    const token = firstNameToken(contact);
    if (!token) continue;
    const key = `${contact.id || ""}::${token.toLowerCase()}`;
    if (seen.has(key)) continue;
    const re = nameBoundaryRegex(token, "i");
    if (re.test(scan)) {
      hits.push(contact);
      seen.add(key);
    }
  }
  return hits;
}

/**
 * Find every journal entry whose body, topic, or with array references the
 * named contact. Used by the recall path so a Shirley mention surfaces even
 * if the entry's `with` field is empty.
 *
 *   filterEntriesMentioningContact(entries, { firstName: "Shirley" }, { lookbackDays: 30 })
 */
export function filterEntriesMentioningContact(
  entries,
  contact,
  { lookbackDays = 30, now = Date.now() } = {},
) {
  if (!Array.isArray(entries)) return [];
  const token = firstNameToken(contact);
  if (!token) return [];
  const re = nameBoundaryRegex(token, "i");
  const cutoff =
    lookbackDays > 0 ? now - lookbackDays * 24 * 60 * 60 * 1000 : 0;
  const out = [];
  for (const entry of entries) {
    if (!entry) continue;
    const ts = parseEntryTimestamp(entry);
    if (cutoff > 0 && ts !== null && ts < cutoff) continue;
    const inWith =
      Array.isArray(entry.with) &&
      entry.with.some(
        (n) => typeof n === "string" && re.test(stripCitationMarkers(n)),
      );
    const inBody =
      typeof entry.body === "string" &&
      re.test(stripCitationMarkers(entry.body));
    const inTopic =
      typeof entry.topic === "string" &&
      re.test(stripCitationMarkers(entry.topic));
    if (inWith || inBody || inTopic) {
      out.push(entry);
    }
  }
  return out;
}

function parseEntryTimestamp(entry) {
  const raw = entry?.written_at || entry?.updated_at || entry?.created_at;
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}
