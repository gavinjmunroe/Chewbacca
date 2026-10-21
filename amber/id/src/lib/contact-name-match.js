/**
 * Multi-token fuzzy name matching for "who is <name>" over the address book.
 *
 * WHY A SECOND MATCHER. fact-capture.js already has resolveContactByName and
 * phoneticPool, and they are good — at what they do, which is matching ONE
 * SPOKEN TOKEN against a contact's first name. Both compare the whole query
 * against `full_name.split(" ")[0]`, so a typed FULL name never matches: for
 * "Sagar tieari" the distance from "sagar tieari" to "sagar" is 7 and the
 * soundex of a two-word string matches nothing. That is exactly why "Sagar
 * tieari" came back as "no one named Sagar Tieari showed up in your contacts"
 * while Sagar Tiwari GOAT sat in the address book.
 *
 * So this matches TOKEN-BY-TOKEN: every token of the query must be covered by
 * some token of the candidate name, exactly, as a prefix, or within an edit
 * budget that scales with the token's length. "sagar tieari" → sagar exact,
 * tieari→tiwari one substitution → match. Extra tokens on the CONTACT side are
 * free, which is what lets "Sagar Tiwari GOAT" match, and is the common case in
 * a real phone book full of "Aidan Catholic Family Frat Dude USC".
 *
 * Short tokens must match exactly. With a 1-edit budget on a three-letter token,
 * "ana" would match "anna", "dana", "ann", "and" and half the book — a
 * suggestion list that long is the same as no answer.
 */

/** Fold accents, drop punctuation, lowercase. "José-María" → "jose maria". */
export function normalizeName(value) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(value) {
  const n = normalizeName(value);
  return n ? n.split(" ") : [];
}

/**
 * Edit distance, abandoned as soon as it cannot come in at or under `max`.
 * The bound is not just a speed trick: this runs over every contact for every
 * lookup, and an unbounded distance on a 5,000-row book is wasted work on pairs
 * we already know are too far apart to matter.
 */
export function boundedEditDistance(a, b, max) {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (la === 0) return lb;
  if (lb === 0) return la;
  let prev = new Array(lb + 1);
  let cur = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= lb; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    // Every remaining row can only add to the minimum, so once a whole row is
    // over budget the final distance is too.
    if (rowMin > max) return max + 1;
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  return prev[lb];
}

/**
 * How many edits a token of this length may absorb. Deliberately 0 below four
 * characters — see the note at the top about "ana".
 */
export function editBudget(len) {
  if (len <= 3) return 0;
  if (len <= 5) return 1;
  if (len <= 8) return 2;
  return 3;
}

/**
 * Best cost of covering one query token with one of a candidate's tokens.
 * Returns { cost, kind } or null when nothing is close enough. Cost is in
 * edits; a prefix match costs a fraction of one so "sag" ranks below "sagar"
 * without being rejected.
 */
export function coverToken(queryToken, candidateTokens) {
  let best = null;
  const budget = editBudget(queryToken.length);
  for (const ct of candidateTokens) {
    if (ct === queryToken) return { cost: 0, kind: "exact" };
    // A typed prefix is a deliberate abbreviation, not an error: "tiw" for
    // Tiwari. Needs 3+ characters or every one-letter token matches everything.
    if (queryToken.length >= 3 && ct.startsWith(queryToken)) {
      const cost = 0.25 + Math.min(0.5, (ct.length - queryToken.length) / 20);
      if (!best || cost < best.cost) best = { cost, kind: "prefix" };
      continue;
    }
    if (budget > 0) {
      const d = boundedEditDistance(queryToken, ct, budget);
      if (d <= budget && (!best || d < best.cost)) best = { cost: d, kind: "fuzzy" };
    }
  }
  return best;
}

/**
 * Score one candidate name against a query. Returns null unless EVERY query
 * token is covered — a query token with no counterpart means the user asked
 * about someone else. Score is 1 for an exact match and falls with each edit.
 *
 *   nameMatch("Sagar tieari", "Sagar Tiwari GOAT")
 *     -> { score: ~0.85, exact: false, fuzzyTokens: 1 }
 */
export function nameMatch(query, candidateName) {
  const qTokens = tokenize(query);
  const cTokens = tokenize(candidateName);
  if (qTokens.length === 0 || cTokens.length === 0) return null;
  let cost = 0;
  let chars = 0;
  let fuzzyTokens = 0;
  let allExact = true;
  for (const qt of qTokens) {
    const cover = coverToken(qt, cTokens);
    if (!cover) return null;
    cost += cover.cost;
    chars += qt.length;
    if (cover.kind !== "exact") {
      allExact = false;
      if (cover.kind === "fuzzy") fuzzyTokens += 1;
    }
  }
  // Cost per character typed, so one edit in a long name costs less than one
  // edit in a short one.
  const score = Math.max(0, 1 - cost / Math.max(1, chars));
  return { score, exact: allExact, fuzzyTokens };
}

/**
 * Rank an address book against a typed name. Exact matches first, then closest.
 * `contacts` is whatever shape the caller has, as long as each row carries a
 * name — the row is passed back untouched with `score` attached, so callers do
 * not have to re-join anything.
 */
export function fuzzyFindContactsByName(
  query,
  contacts,
  { limit = 8, minScore = 0.5, nameOf = (c) => c?.name ?? c?.full_name } = {},
) {
  if (!query || !Array.isArray(contacts)) return [];
  const out = [];
  for (const c of contacts) {
    const name = nameOf(c);
    if (!name) continue;
    const m = nameMatch(query, name);
    if (!m || m.score < minScore) continue;
    out.push({ ...c, score: m.score, exactName: m.exact, fuzzyTokens: m.fuzzyTokens });
  }
  out.sort((a, b) => {
    if (a.exactName !== b.exactName) return a.exactName ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    // Stable and predictable when scores tie, instead of insertion order.
    return String(nameOf(a)).localeCompare(String(nameOf(b)));
  });
  return out.slice(0, limit);
}
