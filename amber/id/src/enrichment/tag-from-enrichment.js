/**
 * Synthesize tags + facts from RESOLVED enrichment. PURE (no DB/network).
 *
 * Verified-data-only: callers MUST invoke this only with fields from confident/
 * resolved enrichment — never from ambiguous candidates.
 */

// title-substring → canonical role tag. Order matters (first match wins per kw).
const ROLE_MAP = [
  ["engineer", "software"],
  ["developer", "software"],
  ["swe", "software"],
  ["co-founder", "founder"],
  ["cofounder", "founder"],
  ["founder", "founder"],
  ["investor", "investor"],
  [" vc", "investor"],
  ["venture", "investor"],
  ["ceo", "executive"],
  ["cto", "executive"],
  ["cfo", "executive"],
  ["coo", "executive"],
  ["product manager", "product"],
  ["designer", "design"],
  ["data scientist", "data"],
  ["marketing", "marketing"],
  ["sales", "sales"],
];

const MAX_TAGS = 10;

function _lower(s) {
  return typeof s === "string" ? s.trim().toLowerCase() : "";
}
function _clean(s) {
  return typeof s === "string" && s.trim() ? s.trim() : "";
}
// lowercase, hyphenate, strip to [a-z0-9-].
function _slug(s) {
  const n = _lower(s)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return n || "";
}

/**
 * Normalized string[] for contacts.tags from title + industry (+ role map).
 * Lowercased, hyphenated, deduped, capped at ~10.
 */
export function deriveTags(fields = {}) {
  const tags = [];
  const push = (t) => {
    const n = _slug(t);
    if (n && !tags.includes(n)) tags.push(n);
  };
  const title = _lower(fields.title);
  const industry = _lower(fields.industry);

  // Canonical role tags from the title.
  for (const [kw, tag] of ROLE_MAP) {
    if (title && title.includes(kw)) push(tag);
  }
  // Industry keyword.
  if (industry) push(industry);
  // The title itself as a hyphenated keyword (e.g. "software-engineer").
  if (title) push(title);

  return tags.slice(0, MAX_TAGS);
}

/**
 * FactIn-shaped rows for contact_facts (source:'enrichment', status:'resolved'
 * applied by the writer). 1–3 high-signal identity facts; empties skipped.
 */
export function deriveFacts(fields = {}) {
  const facts = [];
  const title = _clean(fields.title);
  const company = _clean(fields.company);
  const city = _clean(fields.city);

  if (title && company) {
    facts.push({ fact_text: `Works as ${title} at ${company}`, category: "identity", weight: 0.8 });
  } else if (company) {
    facts.push({ fact_text: `Works at ${company}`, category: "identity", weight: 0.7 });
  } else if (title) {
    facts.push({ fact_text: `Works as ${title}`, category: "identity", weight: 0.6 });
  }
  if (city) {
    facts.push({ fact_text: `Lives in ${city}`, category: "identity", weight: 0.5 });
  }

  return facts.slice(0, 3);
}
