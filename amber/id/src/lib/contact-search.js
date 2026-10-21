/**
 * FINDING ONE PERSON IN A ROLODEX OF THOUSANDS.
 *
 * "Create a rolodex that you can search on. That's it."
 *
 * What was here matched a lowercased substring against full_name, ranked prefix
 * above mid-string, and broke ties ALPHABETICALLY. Three things wrong with that,
 * and all three are the difference between a search box people use and one they
 * give up on:
 *
 *   IT SEARCHED ONE FIELD. Typing a company, a city, a job title, an email
 *   address or a phone number found nobody, because none of those were looked
 *   at. Half of what a person remembers about someone is not their name -- "the
 *   guy at Rytual", "that recruiter in Austin" -- and the card already holds all
 *   of it.
 *
 *   IT COULD NOT SPELL. "Tiwari" typed "Tieari" found nothing.
 *   contact-name-match.js has handled exactly this since it was written, with a
 *   per-token edit budget and prefix abbreviations, and the search box was not
 *   calling it.
 *
 *   IT RANKED BY THE ALPHABET, which means Aaron Abbott -- imported once, never
 *   contacted -- outranks the person you emailed this morning, forever. The
 *   rollup already knows which of those two matters.
 *
 * TIERS, THEN SCORE, THEN STRENGTH -- IN THAT ORDER, AND THE ORDER IS THE POINT.
 *
 * The tier is a discrete bucket of HOW the row matched: an exact name, a
 * prefix, an identity, a fuzzy name, an attribute. Ranking sorts by tier first,
 * so a contact whose COMPANY happens to contain "park" can never outrank a
 * contact NAMED Park, whatever else is true about them. Only inside a tier does
 * match quality decide, and only after that does relationship strength.
 *
 * Strength is a tiebreaker and nothing more. It never crosses a tier boundary,
 * because the moment a popularity signal can promote a worse match, search
 * starts ignoring what was typed -- and a search box that ignores what was
 * typed is the thing everyone complains about and nobody can name.
 *
 * PURE. Rows in, ranked rows out. No database, no network.
 */

import { nameMatch, tokenize } from "./contact-name-match.js";

/** Match tiers, lowest is best. Gaps are intentional -- room to insert later. */
export const TIER = Object.freeze({
  EXACT_NAME: 0,
  EXACT_IDENTITY: 1,
  NAME_PREFIX: 2,
  IDENTITY_PREFIX: 3,
  FUZZY_NAME: 4,
  ATTRIBUTE: 5,
});

const TIER_REASON = Object.freeze({
  0: "name",
  1: "email or phone",
  2: "name",
  3: "email or phone",
  4: "name (close match)",
  5: "details",
});

const lower = (v) => String(v ?? "").trim().toLowerCase();
const digitsOf = (v) => String(v ?? "").replace(/\D+/g, "");

/** Is the typed query a phone number rather than a word? */
export function looksLikePhone(q) {
  const s = String(q ?? "").trim();
  if (!s) return false;
  // Digits, and the punctuation people type inside numbers. A name never
  // survives this, and "+1 (630)" does.
  if (!/^[+\d\s().-]+$/.test(s)) return false;
  return digitsOf(s).length >= 3;
}

export const looksLikeEmail = (q) => String(q ?? "").includes("@");

/**
 * Everything on a row that a person might type, flattened once.
 *
 * Done per row per SEARCH, not per keystroke per row -- the caller holds the
 * prepared book across requests if it wants to.
 */
export function prepareForSearch(row) {
  const emails = String(row?.emails ?? "")
    .split(/[,;|\s]+/)
    .map(lower)
    .filter((e) => e.includes("@"));
  const phones = [row?.phone_primary, row?.phone_primary_normalized, ...String(row?.phones_all ?? "").split(/[,;|]/)]
    .map(digitsOf)
    .filter((d) => d.length >= 7);
  const name = String(row?.full_name ?? "").trim() ||
    [row?.first_name, row?.last_name].filter(Boolean).join(" ").trim();
  const attrs = [row?.company, row?.title, row?.city, row?.notes_preview]
    .map(lower)
    .filter(Boolean);
  return {
    row,
    id: String(row?.id ?? ""),
    name,
    nameLower: lower(name),
    nameTokens: tokenize(name),
    emails,
    emailLocals: emails.map((e) => e.split("@")[0]),
    phones,
    attrs,
    // Everything searchable as one string, for the attribute tier only.
    haystack: [lower(name), ...attrs, ...emails].join(" "),
    strength: strengthOf(row),
  };
}

/**
 * How much this person matters to the owner, as a number in [0, 1].
 *
 * Recency dominates frequency on purpose. Somebody you spoke to yesterday is
 * who you mean far more often than somebody you exchanged forty emails with two
 * years ago, and a search box is used in the present tense.
 *
 * A contact with no rolled-up stats scores 0 rather than being penalised into
 * negative territory, so a freshly imported address book with no interaction
 * history ranks purely on match quality -- which is correct, because on day one
 * there is nothing else to go on.
 */
export function strengthOf(row, now = Date.now()) {
  const last = row?.last_interaction_at ? Date.parse(row.last_interaction_at) : NaN;
  let recency = 0;
  if (Number.isFinite(last)) {
    const days = Math.max(0, (now - last) / 86_400_000);
    // Half-life of about 60 days: yesterday ~1, two months ~0.5, a year ~0.02.
    recency = Math.pow(0.5, days / 60);
  }
  const n = Number(row?.count_90d ?? row?.interaction_count ?? 0);
  const frequency = n > 0 ? Math.min(1, Math.log1p(n) / Math.log(21)) : 0; // 20 touches saturates
  const favorite = row?.is_favorite ? 1 : 0;
  const score = 0.55 * recency + 0.3 * frequency + 0.15 * favorite;
  return Math.max(0, Math.min(1, score));
}

/**
 * How one prepared row matches one query. Null when it does not.
 *
 * Returns the tier, a 0-1 quality inside that tier, and which field answered,
 * so a client can say "matched on company" instead of leaving the user to
 * work out why a row is in the list.
 */
export function matchRow(p, q) {
  const query = lower(q);
  if (!query) return null;

  // ── identity ──────────────────────────────────────────────────────────────
  //
  // Typed a phone number or an email address? Then that is what was meant, and
  // no amount of name similarity is more relevant than the number matching.
  if (looksLikePhone(q)) {
    const d = digitsOf(q);
    for (const phone of p.phones) {
      if (phone === d || phone.endsWith(d)) {
        const exact = phone === d || (d.length >= 10 && phone.endsWith(d));
        return {
          tier: exact ? TIER.EXACT_IDENTITY : TIER.IDENTITY_PREFIX,
          quality: Math.min(1, d.length / 10),
          field: "phone",
        };
      }
      if (phone.startsWith(d)) {
        return { tier: TIER.IDENTITY_PREFIX, quality: Math.min(1, d.length / 10), field: "phone" };
      }
    }
    // A digits query that matches no number is not then matched against names.
    // "630" is not a fuzzy match for anybody, and letting it fall through fills
    // the list with noise at exactly the moment the user was being precise.
    return null;
  }

  if (looksLikeEmail(q)) {
    for (const email of p.emails) {
      if (email === query) return { tier: TIER.EXACT_IDENTITY, quality: 1, field: "email" };
      if (email.startsWith(query)) return { tier: TIER.IDENTITY_PREFIX, quality: 0.8, field: "email" };
      if (email.includes(query)) return { tier: TIER.IDENTITY_PREFIX, quality: 0.5, field: "email" };
    }
    return null;
  }

  // ── name ──────────────────────────────────────────────────────────────────
  if (p.nameLower && p.nameLower === query) {
    return { tier: TIER.EXACT_NAME, quality: 1, field: "name" };
  }
  if (p.nameLower.startsWith(query)) {
    // A longer name is a looser prefix match: "sam" against "Sam" beats "sam"
    // against "Samantha Rodriguez-Klein".
    return { tier: TIER.NAME_PREFIX, quality: query.length / Math.max(query.length, p.nameLower.length), field: "name" };
  }
  // A prefix of any TOKEN, so a surname typed alone finds the person.
  for (const t of p.nameTokens) {
    if (t.length >= 2 && t.startsWith(query)) {
      return { tier: TIER.NAME_PREFIX, quality: 0.6 * (query.length / Math.max(query.length, t.length)), field: "name" };
    }
  }

  // An email local-part is very often the name typed as one word: "shirleypark"
  // finds Shirley Park, which no name tokenizer will do on its own.
  const squashed = query.replace(/\s+/g, "");
  if (squashed.length >= 4) {
    for (const localPart of p.emailLocals) {
      if (localPart === squashed || localPart.replace(/[._-]/g, "") === squashed) {
        return { tier: TIER.IDENTITY_PREFIX, quality: 0.9, field: "email" };
      }
    }
  }

  // Spelled it wrong. Every query token must still be covered by some name
  // token, so this widens tolerance without widening what counts as a match.
  const fuzzy = nameMatch(query, p.name);
  if (fuzzy && fuzzy.score >= 0.55) {
    return { tier: TIER.FUZZY_NAME, quality: fuzzy.score, field: "name" };
  }

  // ── attributes ────────────────────────────────────────────────────────────
  //
  // "rytual", "austin", "recruiter". EVERY token must appear somewhere on the
  // row, so "sagar rytual" needs both -- otherwise a two-word query returns
  // everyone who matches either half, which is the whole company.
  const qTokens = query.split(/\s+/).filter(Boolean);
  if (qTokens.length && qTokens.every((t) => p.haystack.includes(t))) {
    const covered = qTokens.reduce((n, t) => n + t.length, 0);
    return { tier: TIER.ATTRIBUTE, quality: Math.min(1, covered / 12), field: "details" };
  }

  return null;
}

/**
 * Rank a prepared book against a query.
 *
 * The comparator is written out rather than summed into one number so that the
 * precedence is readable and cannot drift: tier, then quality, then strength,
 * then name. A weighted sum of those four would let a large strength quietly
 * outweigh a small quality gap, which is the bug this ordering exists to make
 * impossible.
 */
/**
 * Quality, coarsened to tenths before it is compared.
 *
 * Prefix quality is the typed length over the candidate length, so for a
 * two-letter query "Samir Shah" scores 0.20 and "Sagar Tiwari" 0.17 -- a gap
 * that is entirely about how long the other name happens to be, and nothing at
 * all about which person was meant. Compared raw, that noise outranks every
 * strength signal the rollup has, and the person you spoke to yesterday loses
 * to a stranger with a shorter surname.
 *
 * Tenths keep the differences that mean something -- "sam" covering all of
 * "Sam" against a fifth of "Samantha Rodriguez" is 0.6 against 0.2 and survives
 * -- and discard the ones that do not.
 */
const bucket = (x) => Math.round(Number(x) * 10) / 10;

export function searchContacts(prepared, q, { limit = 20 } = {}) {
  const query = String(q ?? "").trim();
  if (!query || !Array.isArray(prepared)) return [];
  const hits = [];
  for (const p of prepared) {
    if (!p) continue;
    const m = matchRow(p, query);
    if (!m) continue;
    hits.push({
      id: p.id,
      name: p.name,
      tier: m.tier,
      quality: m.quality,
      matchedOn: m.field,
      why: TIER_REASON[m.tier],
      strength: p.strength,
      row: p.row,
    });
  }
  hits.sort(
    (a, b) =>
      a.tier - b.tier ||
      bucket(b.quality) - bucket(a.quality) ||
      b.strength - a.strength ||
      String(a.name).localeCompare(String(b.name)),
  );
  return hits.slice(0, limit);
}
