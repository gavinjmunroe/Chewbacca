/**
 * SOMEONE YOU ALREADY KNOW IS NOT SOMEONE TO ADD.
 *
 * "One of my contacts actually showed up perfectly for my web search request,
 *  and Amber identified that well... It got a little confused and gave me their
 *  contact card both in a way to view the contact card that I already have and
 *  in a way to add it as a new contact card. Since I already have that contact,
 *  it should just be shown to me as something I already have."
 *
 * The LinkedIn pass knows nothing about the address book, so a profile that IS
 * one of the user's contacts came back as a stranger with an "add" button next
 * to it -- while the same person also appeared, correctly, as an existing card.
 * Two cards, two different claims about the same human, and one of them offers
 * to create a duplicate.
 *
 * This matches the profiles against the book and says which is which. What the
 * caller does with it is the point: a known person gets "here they are, and here
 * is what to say to them"; an unknown one gets "add them".
 *
 * THE MATCH IS DELIBERATELY STRICT, and that asymmetry is the whole design.
 * Claiming a stranger is your contact is the worse error by a distance -- it
 * hides a person you wanted to meet behind a card for somebody else, and it
 * makes the app look like it cannot tell people apart. So:
 *
 *   - the full names must match once normalized (case, accents, punctuation,
 *     middle initials, and the honorifics and suffixes LinkedIn titles carry);
 *   - a first-name-only or last-name-only overlap is NOT a match. "Meet Patel"
 *     and "Manush Patel" are two people;
 *   - where a name is ambiguous in the book (two contacts of the same name) and
 *     the profile carries a company, the company breaks the tie; with no company
 *     to go on it is left UNMATCHED rather than guessed, because picking one of
 *     two same-named contacts wrong is exactly the failure the strictness is for.
 *
 * The consequence of being too strict is one extra "add" card for somebody
 * already in the book, which is a duplicate the merge sheet already handles. The
 * consequence of being too loose is silence about a person he asked to find.
 */

const HONORIFICS = new Set(["mr", "mrs", "ms", "miss", "dr", "prof", "sir", "madam"]);
const SUFFIXES = new Set([
  "jr", "sr", "ii", "iii", "iv", "phd", "md", "mba", "cfa", "cpa", "pe", "esq",
  "cissp", "pmp", "rn", "dds", "dvm",
]);

/**
 * A name reduced to its comparable form: lowercase, unaccented, letters and
 * single spaces, with honorifics, suffixes and single-letter initials removed.
 *
 * The initials matter: LinkedIn headers routinely carry "Saavan K. Patel" for
 * the same person the address book has as "Saavan Patel".
 */
export function normalizePersonName(name) {
  const base = String(name || "")
    .normalize("NFKD")
    // Strip combining marks so "José" and "Jose" are the same name.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // AN APOSTROPHE IS PART OF THE NAME, not a separator. Turning it into a
    // space makes "O'Brien" into "o brien", and the initial filter below then
    // eats the "o" -- so the same person spelled "OBrien" in the address book
    // would not match. Removed rather than replaced.
    .replace(/['\u2019\u02bc`]/g, "")
    // LinkedIn titles carry credentials after a comma: "Jane Doe, MBA".
    .replace(/,/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!base) return "";
  const parts = base
    .split(" ")
    .filter((w) => w && !HONORIFICS.has(w) && !SUFFIXES.has(w))
    // A single letter is an initial, not a name.
    .filter((w) => w.length > 1);
  return parts.join(" ");
}

const companyKey = (v) =>
  String(v || "")
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|company|co|technologies|technology|labs|group|holdings)\b/g, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();

/**
 * Index an address book by comparable name.
 *
 * A name held by two or more contacts is kept as a LIST, because that is the
 * case that must not be resolved by luck. See the header.
 *
 * @param {{id: string, name: string, company?: string|null, title?: string|null}[]} contacts
 */
export function indexContactsByName(contacts) {
  const byName = new Map();
  for (const c of contacts || []) {
    const key = normalizePersonName(c?.name);
    if (!key || !c?.id) continue;
    const list = byName.get(key);
    if (list) list.push(c);
    else byName.set(key, [c]);
  }
  return byName;
}

/**
 * Mark each web profile with the contact it already is, if any.
 *
 * Returns a NEW array in a new order: known people first, each carrying
 * `existingContactId` and `existingContactName`; strangers after them, unchanged.
 *
 * KNOWN PEOPLE GO FIRST because of what the user asked for in his own words:
 * "Here are the people you were looking for... One of your contacts actually
 * fits this perfectly, so I will show you their contact card first."
 */
export function markKnownWebPeople(webPeople, contacts) {
  const list = Array.isArray(webPeople) ? webPeople : [];
  if (list.length === 0) return [];
  const byName = indexContactsByName(contacts);
  const known = [];
  const strangers = [];
  for (const person of list) {
    const key = normalizePersonName(person?.name);
    const candidates = key ? byName.get(key) : null;
    let match = null;
    if (candidates && candidates.length === 1) {
      match = candidates[0];
    } else if (candidates && candidates.length > 1) {
      // AMBIGUOUS IN THE BOOK. Only a company match may break the tie, and only
      // when exactly one candidate matches it. Otherwise this stays a stranger,
      // which shows one extra "add" card rather than attributing a profile to
      // the wrong person of that name.
      const want = companyKey(person?.company);
      if (want) {
        const hits = candidates.filter((c) => companyKey(c.company) === want);
        if (hits.length === 1) match = hits[0];
      }
    }
    if (match) {
      known.push({
        ...person,
        existingContactId: String(match.id),
        existingContactName: match.name ?? person.name,
      });
    } else {
      strangers.push(person);
    }
  }
  return [...known, ...strangers];
}

/** How many of these profiles are people the owner already has. */
export function countKnown(webPeople) {
  return (Array.isArray(webPeople) ? webPeople : []).filter((p) => p?.existingContactId).length;
}
