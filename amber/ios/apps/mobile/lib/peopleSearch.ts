/**
 * SEARCHING YOUR OWN PEOPLE. One matcher, used by every bar that filters a list
 * of humans.
 *
 * "Search bars should be components based on their functionality." The bar
 * already is one (see lib/searchModes.ts). What it DOES with the text was not:
 * the same six-line filter was written out four separate times -- the contacts
 * page, the circle screen, the share sheet, the share scope picker -- plus a
 * fifth variant in the connections sheet that searched different fields. Four
 * copies of a rule is four rules, and they had already drifted: two searched the
 * platform a contact came from and two did not.
 *
 * WHAT THE COPIES GOT WRONG, and why it matters for this app specifically.
 *
 *   ACCENTS. `name.toLowerCase().includes(needle)` cannot find "Şirin Öztürk"
 *   from "sirin", or "José" from "jose". An address book is mostly names, a lot
 *   of names carry marks, and nobody types them. The person is right there and
 *   the app says there is nobody.
 *
 *   WORD ORDER. Matching one substring against the fields joined in a fixed
 *   order means "odell marcus" finds nothing while "marcus odell" works, and
 *   "priya ramp" -- a name plus where she works, which is exactly how people
 *   search -- finds nothing either, because the two words are in different
 *   fields. Every word has to match SOMETHING; they do not have to be adjacent.
 *
 *   DOUBLE SPACES. A stray space from dictation or a paste made the whole query
 *   fail, because the needle was matched literally.
 *
 *   THE TURKISH I. 'İ'.toLowerCase() is 'i' followed by a combining dot, which
 *   does not equal 'i'. Folding after normalizing fixes it; folding before does
 *   not.
 *
 * WHAT IS DELIBERATELY NOT HERE. No fuzzy matching, no edit distance, no
 * synonyms. This runs on every keystroke over a book of a couple of thousand
 * and it is a FILTER, not a search engine: a typo should return nothing rather
 * than somebody else, because the user can see their own list and will fix the
 * typo. Guessing is the read side's job (lib/contactMap and the server), where a
 * wrong guess costs a wrong row and not a filed fact.
 *
 * See lib/peopleSearch.test.mts.
 */

/**
 * Lowercase, strip diacritics, collapse whitespace.
 *
 * NFD first so a marked letter separates into a base letter plus its mark, then
 * the marks are removed. Lowercasing happens AFTER, because 'İ' lowercases into
 * a letter plus a combining dot and the dot has to be strippable when it gets
 * there.
 */
export function foldForSearch(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return '';
  return value
    .normalize('NFD')
    .toLowerCase()
    .replace(/\p{Diacritic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The words a query is looking for. Empty query, empty list, matches nothing. */
export function searchTerms(query: string): string[] {
  const folded = foldForSearch(query);
  return folded.length === 0 ? [] : folded.split(' ').filter(Boolean);
}

/**
 * Does this person match every word typed?
 *
 * `fields` is whatever the caller considers searchable for its list -- a name
 * and an email on one screen, a name, a username, an occupation and a city on
 * another. The RULE is shared even where the columns are not, which is the part
 * that kept drifting.
 */
export function matchesTerms(fields: readonly unknown[], terms: readonly string[]): boolean {
  if (terms.length === 0) return true;
  const hay = fields.map(foldForSearch).filter(Boolean).join(' ');
  if (!hay) return false;
  return terms.every((t) => hay.includes(t));
}

/** The searchable text of one person, as the people lists define it. */
export type SearchablePerson = {
  name?: string | null;
  email?: string | null;
  handle?: string | null;
  platform?: string | null;
};

export function personFields(p: SearchablePerson): unknown[] {
  return [p?.name, p?.email, p?.handle, p?.platform];
}

/**
 * Filter a list of people by what was typed. Order is preserved: this is a
 * filter over a list the user is already looking at, and re-ranking it under
 * their finger would move the row they were reaching for.
 *
 * An empty query returns the list unchanged (the same array reference), so a
 * caller can keep its identity checks and its memoization.
 */
export function filterPeople<T extends SearchablePerson>(people: readonly T[], query: string): readonly T[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return people;
  return people.filter((p) => matchesTerms(personFields(p), terms));
}

/**
 * The same rule over an arbitrary set of fields, for lists whose rows are not
 * shaped like a contact -- connections carry a username, an occupation and a
 * city instead.
 */
export function filterBy<T>(
  rows: readonly T[],
  query: string,
  fieldsOf: (row: T) => readonly unknown[],
): readonly T[] {
  const terms = searchTerms(query);
  if (terms.length === 0) return rows;
  return rows.filter((r) => matchesTerms(fieldsOf(r), terms));
}
