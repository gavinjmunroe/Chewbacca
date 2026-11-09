/**
 * FINDING THE SAME PERSON TWICE, WITHOUT EVER MERGING TWO DIFFERENT PEOPLE.
 *
 * "There's multiple Shirley Parks, but one Shirley Park has a tagline that says
 *  USC on it. They were not de-duplicated even though they both have the same
 *  name. One just has a different email, and one has a phone number."
 *
 * Nothing in the codebase considered two same-named address-book contacts to be
 * one person, and that default was right -- `mergeProvableDuplicates` only
 * merges rows already sharing a `linked_amber_id`. Two Shirley Parks may be two
 * Shirley Parks. The fix is more EVIDENCE, not a looser rule.
 *
 * THREE TIERS, and which tier a pair lands in decides what happens to it:
 *
 *   provable    An identity key is shared: the same normalized phone, or the
 *               same lowercased email. One human owns one mobile number. These
 *               merge without asking.
 *
 *   likely      The same name AND a corroborator -- most importantly
 *               COMPLEMENTARY CHANNELS: one row has only an email, the other
 *               only a phone. That is the signature of one person imported from
 *               two sources, and it is exactly the Shirley Park case. Queued for
 *               one tap. Never merged silently.
 *
 *   weak        A shared first name, a phonetic near-match. Never surfaced as a
 *               duplicate. This is already handled where it belongs, at capture
 *               time, by resolveContactByName's soft-confirm ("You mean Shirley
 *               Park, right?").
 *
 * WHY THE USC TAGLINE IS EVIDENCE *FOR* THE MERGE, which is the part that reads
 * backwards until you have seen a real address book. A tagline present on one
 * record and absent on the other is what a partial import looks like -- the
 * fuller card came from the phone, the barer one from an email sync. It is not a
 * distinguishing feature, because a distinguishing feature would have to
 * CONTRADICT: two rows both tagged, with different tags, is the pair to leave
 * alone. Same tag, or one tagged and one not, points the same way.
 *
 * WHY NAMES ARE COMPARED AFTER SPLITTING. "Shirley Park USC BTG" and "Shirley
 * Park" are the same name with a label on one of them, and comparing the raw
 * fields says they are different people. src/lib/name-split.js strips the labels
 * first, using the address book as its own dictionary. Getting that wrong in
 * either direction is why this module takes a corpus rather than building one
 * per call.
 *
 * PURE. Rows in, candidate pairs out. No database, no network, no merging -- the
 * caller decides what to do with a pair, and only `provable` is ever safe to act
 * on without a human.
 */

import { buildNameCorpus, splitName } from "./name-split.js";
import { nameRelation, variantKeysOf } from "./name-nicknames.js";
import { employerKeysOf } from "./network-graph.js";

/** E.164-ish: the last ten digits of a North American number, or null. */
export function normalizePhone(value) {
  const digits = String(value || "").replace(/\D+/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  if (digits.length === 10) return digits;
  // Anything else is kept whole if it is long enough to be a real number, so an
  // international pair can still match itself exactly.
  return digits.length >= 8 ? digits : null;
}

export function normalizeEmail(value) {
  const s = String(value || "").trim().toLowerCase();
  if (!s || !s.includes("@")) return null;
  return s;
}

/** Every phone on a row, from whichever of the three columns carries them. */
function phonesOf(row) {
  const raw = [
    row?.phone_primary_normalized,
    row?.phone_primary,
    ...String(row?.phones_all ?? "").split(/[,;|]/),
  ];
  const out = new Set();
  for (const p of raw) {
    const n = normalizePhone(p);
    if (n) out.add(n);
  }
  return out;
}

function emailsOf(row) {
  const out = new Set();
  for (const e of String(row?.emails ?? "").split(/[,;|\s]+/)) {
    const n = normalizeEmail(e);
    if (n) out.add(n);
  }
  return out;
}

/** The name, label-free and comparable. */
function nameKeyOf(row, corpus) {
  const name = splitName(row, corpus).name;
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

const setsOverlap = (a, b) => {
  for (const v of a) if (b.has(v)) return true;
  return false;
};

/**
 * A row prepared once, so an O(n^2) pass over 4,000 contacts does not re-split
 * every name 16 million times.
 */
function prepare(rows, corpus) {
  return rows
    .filter((r) => r && r.id != null)
    .map((r) => ({
      id: String(r.id),
      row: r,
      nameKey: nameKeyOf(r, corpus),
      display: splitName(r, corpus).name,
      tags: new Set(splitName(r, corpus).tags.map((t) => t.toLowerCase())),
      phones: phonesOf(r),
      emails: emailsOf(r),
      company: String(r.company ?? "").trim().toLowerCase() || null,
      // Every employer the row points at, by company name AND by mail domain.
      // One card says "PWC" and the other says nothing but carries an address
      // at pwc.com; those are the same job described by two exporters.
      employers: employerKeysOf(r),
      city: String(r.city ?? "").trim().toLowerCase() || null,
      facts: Number(r.fact_count ?? 0),
      createdAt: r.created_at ? Date.parse(r.created_at) : 0,
    }));
}

/**
 * Why a pair is a candidate, in the words the review card will show.
 *
 * Returns null when there is not enough evidence, which is the answer for the
 * overwhelming majority of pairs and has to stay cheap.
 */
/**
 * Does this row's name carry more than one token after label-splitting?
 *
 * `nameKey` is already folded, sorted and label-free, so a token count on it is
 * the honest answer: "Shirley Park" is two, "Hannah" is one, and "Hannah Park
 * USC" is two because the tag was stripped before it got here.
 */
function isMultiToken(x) {
  return String(x.nameKey || "").split(" ").filter(Boolean).length > 1;
}

function evidenceFor(a, b) {
  // ── provable ────────────────────────────────────────────────────────────────
  if (setsOverlap(a.phones, b.phones)) {
    return { tier: "provable", reason: "same phone number" };
  }
  if (setsOverlap(a.emails, b.emails)) {
    return { tier: "provable", reason: "same email address" };
  }

  // Everything below requires the same name. Without it this is not a duplicate,
  // it is two people, however much else they share.
  //
  // "The same name" now includes a short form of it -- Nate for Nathan, Liz for
  // Elizabeth. See src/lib/name-nicknames.js for why that is a table and not a
  // string distance. A nickname match is explicitly weaker and is handled on
  // its own terms below.
  const relation = a.nameKey && b.nameKey ? nameRelation(a.nameKey, b.nameKey) : null;
  if (!relation) return null;

  // ── the pair to LEAVE ALONE ────────────────────────────────────────────────
  //
  // Two rows with the same name, both tagged, tagged DIFFERENTLY. "Shirley Park
  // USC" and "Shirley Park Chase" are the address book working as intended: the
  // user wrote those labels precisely to tell two people apart, and merging them
  // destroys the distinction they made by hand.
  if (a.tags.size > 0 && b.tags.size > 0 && !setsOverlap(a.tags, b.tags)) {
    return null;
  }

  // Contradicting companies are the same signal.
  if (a.company && b.company && a.company !== b.company) return null;

  // ── a short form is not a name ─────────────────────────────────────────────
  //
  // "Nate" and "Nathan" are one man or two, and nothing in the pair itself says
  // which. So a nickname match alone never reaches `likely`: it needs the two
  // cards to point at the SAME EMPLOYER, and it needs both names to be more
  // than a first name. One Nathan Kaplan at PWC and one Nate Kaplan at PWC in a
  // nine-hundred-card book is one person. Two Nates with no shared anything are
  // two Nates, and the queue is better for not asking.
  if (relation === "nickname") {
    if (!isMultiToken(a) || !isMultiToken(b)) return null;
    if (!setsOverlap(a.employers, b.employers)) return null;
    const where = a.row.company || b.row.company || [...a.employers].find((k) => b.employers.has(k));
    return {
      tier: "likely",
      reason: `"${a.display}" and "${b.display}" are the same name, and both are at ${where}`,
    };
  }

  // ── likely ─────────────────────────────────────────────────────────────────
  //
  // COMPLEMENTARY CHANNELS: one row reachable only by email, the other only by
  // phone. One person, imported twice from two places. This is the Shirley Park
  // case and it is the single most common real duplicate.
  const aOnlyPhone = a.phones.size > 0 && a.emails.size === 0;
  const bOnlyEmail = b.emails.size > 0 && b.phones.size === 0;
  const aOnlyEmail = a.emails.size > 0 && a.phones.size === 0;
  const bOnlyPhone = b.phones.size > 0 && b.emails.size === 0;
  if ((aOnlyPhone && bOnlyEmail) || (aOnlyEmail && bOnlyPhone)) {
    return { tier: "likely", reason: "same name, and one has only a phone while the other has only an email" };
  }

  // A shared tag on both, or on one with the other bare. Evidence FOR, per the
  // note at the top of this file.
  if (setsOverlap(a.tags, b.tags)) {
    const shared = [...a.tags].filter((t) => b.tags.has(t));
    return { tier: "likely", reason: `same name and both tagged "${shared[0]}"` };
  }
  if ((a.tags.size > 0) !== (b.tags.size > 0)) {
    const tagged = a.tags.size > 0 ? a : b;
    return {
      tier: "likely",
      reason: `same name, and one is tagged "${[...tagged.tags][0]}" while the other has no label`,
    };
  }

  if (a.company && a.company === b.company) {
    return { tier: "likely", reason: `same name and both at ${a.row.company}` };
  }
  // The same employer, said differently on each card: a company name on one, a
  // mail domain on the other. Same evidence as above, and the far more common
  // shape once a book has been imported from two places.
  if (setsOverlap(a.employers, b.employers)) {
    const where = a.row.company || b.row.company || [...a.employers].find((k) => b.employers.has(k));
    return { tier: "likely", reason: `same name and both at ${where}` };
  }
  // A CITY IS ONLY A CORROBORATOR FOR A FULL NAME.
  //
  // "Hannah" and "Hannah" both in New York is not evidence of anything. A bare
  // first name is the most collided token in an address book, and a city is
  // shared by millions of people. In one real 966-contact book four pairs
  // cleared `likely` on city alone -- Hannah, Harrison, Jack, Max -- and none of
  // them were the same person. A company does not have this problem: two Hannahs
  // at the same small company is a coincidence worth a tap, two Hannahs in New
  // York is Tuesday.
  if (a.city && a.city === b.city && isMultiToken(a)) {
    return { tier: "likely", reason: `same name and both in ${a.row.city}` };
  }

  // ONE ROW HAS NOTHING BUT A NAME. A bare duplicate of a card that does have
  // details is a stub -- the shape an import leaves behind. Only when the other
  // side is genuinely populated, so two equally-bare same-named rows are left
  // alone rather than guessed at.
  const aBare = a.phones.size === 0 && a.emails.size === 0 && !a.company;
  const bBare = b.phones.size === 0 && b.emails.size === 0 && !b.company;
  const aRich = a.phones.size + a.emails.size > 0 || a.company;
  const bRich = b.phones.size + b.emails.size > 0 || b.company;
  if ((aBare && bRich) || (bBare && aRich)) {
    return { tier: "likely", reason: "same name, and one record has nothing on it but the name" };
  }

  return null;
}

/**
 * Which of a pair should survive a merge.
 *
 * The one carrying more of the user's own work: notes and facts first, because
 * that is the thing that cannot be recovered, then contact channels, then age.
 * Returned as { keep, drop } so a caller never has to decide.
 */
function chooseKeeper(a, b) {
  const score = (x) => x.facts * 1000 + (x.phones.size + x.emails.size) * 10 + (x.company ? 5 : 0) + x.tags.size;
  const sa = score(a);
  const sb = score(b);
  if (sa !== sb) return sa > sb ? { keep: a, drop: b } : { keep: b, drop: a };
  // Equal on substance: the older row wins, because ids already point at it.
  if (a.createdAt !== b.createdAt) {
    return a.createdAt <= b.createdAt ? { keep: a, drop: b } : { keep: b, drop: a };
  }
  return { keep: a, drop: b };
}

const pairKey = (x, y) => (x < y ? `${x}|${y}` : `${y}|${x}`);

/**
 * Every duplicate candidate in one address book.
 *
 * `dismissed` is the set of pair keys the user has already said "not the same"
 * about, in either order -- without it the queue re-asks forever and people
 * learn to ignore it.
 *
 * BLOCKED, NOT QUADRATIC. Comparing 4,000 contacts pairwise is 8 million
 * evidence calls. Instead rows are bucketed by the things a duplicate must
 * share -- a phone, an email, a name key -- and only rows inside a bucket are
 * compared. A pair that shares none of those three cannot clear any tier, so it
 * is not a pair worth forming.
 */
export function findDuplicateCandidates(rows, { corpus = null, dismissed = null, limit = 200 } = {}) {
  const book = Array.isArray(rows) ? rows : [];
  if (book.length < 2) return [];
  const shared = corpus ?? buildNameCorpus(book);
  const prepared = prepare(book, shared);

  const buckets = new Map();
  const put = (key, item) => {
    if (!key) return;
    const list = buckets.get(key);
    if (list) list.push(item);
    else buckets.set(key, [item]);
  };
  for (const item of prepared) {
    for (const p of item.phones) put(`p:${p}`, item);
    for (const e of item.emails) put(`e:${e}`, item);
    // Under every key the name could be filed as, so "Nate Kaplan" and "Nathan
    // Kaplan" land in one bucket and actually get compared.
    for (const variant of variantKeysOf(item.nameKey)) put(`n:${variant}`, item);
  }

  const seen = new Set();
  const out = [];
  for (const list of buckets.values()) {
    // A bucket the size of an address book is a bucket of nothing -- a name key
    // that empty, or a placeholder phone shared by hundreds of rows. Skipping it
    // is both a correctness guard and what keeps this linear in practice.
    if (list.length < 2 || list.length > 40) continue;
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        if (a.id === b.id) continue;
        const key = pairKey(a.id, b.id);
        if (seen.has(key)) continue;
        seen.add(key);
        if (dismissed && dismissed.has(key)) continue;
        const evidence = evidenceFor(a, b);
        if (!evidence) continue;
        const { keep, drop } = chooseKeeper(a, b);
        out.push({
          key,
          tier: evidence.tier,
          reason: evidence.reason,
          keepId: keep.id,
          dropId: drop.id,
          keep: {
            id: keep.id,
            name: keep.display,
            phones: [...keep.phones],
            emails: [...keep.emails],
            company: keep.row.company ?? null,
            tags: [...keep.tags],
            facts: keep.facts,
          },
          drop: {
            id: drop.id,
            name: drop.display,
            phones: [...drop.phones],
            emails: [...drop.emails],
            company: drop.row.company ?? null,
            tags: [...drop.tags],
            facts: drop.facts,
          },
        });
      }
    }
  }

  // Provable first, then the ones with the most at stake, so a review queue is
  // ordered by how much a tap is worth.
  const rank = { provable: 0, likely: 1 };
  out.sort(
    (x, y) =>
      rank[x.tier] - rank[y.tier] ||
      y.keep.facts + y.drop.facts - (x.keep.facts + x.drop.facts) ||
      String(x.keep.name).localeCompare(String(y.keep.name)),
  );
  return out.slice(0, limit);
}

/** The pair-key form the caller stores when the user says "not the same". */
export function dismissalKey(idA, idB) {
  return pairKey(String(idA), String(idB));
}
