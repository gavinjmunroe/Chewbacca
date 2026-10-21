/**
 * THE SEARCH BAR, AS BEHAVIOR.
 *
 * Every one of these is a name or a query a real address book contains. The
 * failing ones at the top are not hypotheticals: they are what the four copies
 * of this filter did before there was one copy.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterBy,
  filterPeople,
  foldForSearch,
  matchesTerms,
  personFields,
  searchTerms,
} from './peopleSearch.ts';

const P = (name: string, extra: Record<string, unknown> = {}) => ({ name, ...extra }) as any;

const BOOK = [
  P('Şirin Öztürk', { email: 'sirin@mountsinai.example', platform: 'apple' }),
  P('José María Álvarez', { email: 'jose@example.com' }),
  P("Marcus O'Dell", { email: 'marcus@sequoia.example', handle: '@modell' }),
  P('Priya Raghunathan', { email: 'priya@flatironhealth.example', platform: 'google' }),
  P('Priya Sundaram', { email: 'priya.s@ramp.example', platform: 'apple' }),
  P('Danielle Kwon', { email: 'dkwon@cravath.example' }),
  P('Tobias Lindqvist', { handle: '@tobias' }),
  P('李明', {}),
  P('Hana Yilmaz', {}),
];
const names = (rows: readonly any[]) => rows.map((r) => r.name);

// ── the ones that were broken ───────────────────────────────────────────────

test('A NAME WITH AN ACCENT IS FOUND BY TYPING IT WITHOUT ONE', () => {
  // `name.toLowerCase().includes(needle)` cannot do this, and an address book
  // is mostly names. The person is right there and the app said there was
  // nobody.
  assert.deepEqual(names(filterPeople(BOOK, 'sirin')), ['Şirin Öztürk']);
  assert.deepEqual(names(filterPeople(BOOK, 'ozturk')), ['Şirin Öztürk']);
  assert.deepEqual(names(filterPeople(BOOK, 'jose')), ['José María Álvarez']);
  assert.deepEqual(names(filterPeople(BOOK, 'alvarez')), ['José María Álvarez']);
  assert.deepEqual(names(filterPeople(BOOK, 'maria')), ['José María Álvarez']);
});

test('typing the accent still works', () => {
  assert.deepEqual(names(filterPeople(BOOK, 'Şirin')), ['Şirin Öztürk']);
  assert.deepEqual(names(filterPeople(BOOK, 'José')), ['José María Álvarez']);
});

test('WORDS CAN COME IN ANY ORDER, AND FROM DIFFERENT FIELDS', () => {
  // A single substring against the fields joined in a fixed order means
  // "odell marcus" finds nothing, and "priya ramp" -- a name plus where she
  // works, which is exactly how people search -- finds nothing either.
  assert.deepEqual(names(filterPeople(BOOK, "odell marcus")), ["Marcus O'Dell"]);
  assert.deepEqual(names(filterPeople(BOOK, 'priya ramp')), ['Priya Sundaram']);
  assert.deepEqual(names(filterPeople(BOOK, 'ramp priya')), ['Priya Sundaram']);
  assert.deepEqual(names(filterPeople(BOOK, 'kwon cravath')), ['Danielle Kwon']);
});

test('extra whitespace does not break the query', () => {
  // Dictation and paste both produce these, and the literal-substring version
  // failed on every one.
  for (const q of ['  priya   sundaram ', 'priya\tsundaram', 'priya\n sundaram']) {
    assert.deepEqual(names(filterPeople(BOOK, q)), ['Priya Sundaram'], JSON.stringify(q));
  }
});

test('the Turkish dotted I folds to a plain i', () => {
  // 'İ'.toLowerCase() is 'i' plus a combining dot, which does not equal 'i'.
  assert.equal(foldForSearch('İstanbul'), 'istanbul');
  assert.deepEqual(names(filterPeople([P('İpek Demir')], 'ipek')), ['İpek Demir']);
});

// ── the rules that must not change ──────────────────────────────────────────

test('an empty query returns the list itself, unchanged and by reference', () => {
  // The callers memoize on identity. Returning a copy makes every keystroke on
  // an empty box re-render the whole list.
  assert.equal(filterPeople(BOOK, ''), BOOK);
  assert.equal(filterPeople(BOOK, '   '), BOOK);
  assert.deepEqual(searchTerms(''), []);
  assert.deepEqual(searchTerms('   '), []);
});

test('order is preserved; searching never re-ranks the list', () => {
  // The user is looking at the list while they type. Re-ordering it under their
  // finger moves the row they were reaching for.
  const out = filterPeople(BOOK, 'a');
  const expected = BOOK.filter((p) => names([p])[0] && out.includes(p)).map((p) => p.name);
  assert.deepEqual(names(out), expected);
});

test('every word must match something, not just one of them', () => {
  assert.deepEqual(names(filterPeople(BOOK, 'priya kwon')), []);
  assert.deepEqual(names(filterPeople(BOOK, 'marcus zzz')), []);
});

test('a typo returns nothing rather than somebody else', () => {
  // Deliberate. This is a filter over a list the user can see, not a search
  // engine: guessing here puts the wrong person under their thumb.
  assert.deepEqual(names(filterPeople(BOOK, 'marcuss')), []);
  assert.deepEqual(names(filterPeople(BOOK, 'pryia')), []);
});

test('a search matches the middle of a word, not only the start', () => {
  assert.deepEqual(names(filterPeople(BOOK, 'raghu')), ['Priya Raghunathan']);
  assert.deepEqual(names(filterPeople(BOOK, 'nathan')), ['Priya Raghunathan']);
});

test('two people who share a first name both come back', () => {
  assert.deepEqual(names(filterPeople(BOOK, 'priya')), ['Priya Raghunathan', 'Priya Sundaram']);
});

test('an apostrophe in a name is searchable with and without it', () => {
  assert.deepEqual(names(filterPeople(BOOK, "o'dell")), ["Marcus O'Dell"]);
  assert.deepEqual(names(filterPeople(BOOK, 'marcus')), ["Marcus O'Dell"]);
});

test('a non-Latin name is not mangled by folding', () => {
  // Stripping diacritics must not touch scripts that have none.
  assert.equal(foldForSearch('李明'), '李明');
  assert.deepEqual(names(filterPeople(BOOK, '李')), ['李明']);
});

test('a person with no searchable text at all never matches a query', () => {
  const blanks = [P(''), { name: null } as any, {} as any];
  assert.deepEqual(filterPeople(blanks, 'anything'), []);
  assert.equal(matchesTerms([null, undefined, '', '   '], ['a']), false);
});

test('null and undefined fields are skipped, not stringified', () => {
  // A field joined as the literal "null" makes every contact match a search for
  // "null" -- silly, and exactly what String(x) on a nullable field does.
  assert.equal(foldForSearch(null), '');
  assert.equal(foldForSearch(undefined), '');
  assert.equal(foldForSearch(42 as any), '');
  assert.deepEqual(names(filterPeople(BOOK, 'null')), []);
  assert.deepEqual(names(filterPeople(BOOK, 'undefined')), []);
});

test('case never matters, in either direction', () => {
  for (const q of ['DANIELLE', 'danielle', 'DaNiElLe']) {
    assert.deepEqual(names(filterPeople(BOOK, q)), ['Danielle Kwon'], q);
  }
});

test('the searchable fields of a contact are exactly these four', () => {
  // Two of the four copies searched `platform` and two did not, so the same
  // query returned different people depending on which screen you were on.
  // Pinned so a fifth copy cannot appear with a fifth opinion.
  assert.deepEqual(personFields({ name: 'n', email: 'e', handle: 'h', platform: 'p' }), ['n', 'e', 'h', 'p']);
  assert.deepEqual(names(filterPeople(BOOK, 'google')), ['Priya Raghunathan'], 'platform is searchable');
  assert.deepEqual(names(filterPeople(BOOK, '@tobias')), ['Tobias Lindqvist'], 'handle is searchable');
});

test('filterBy applies the same rule to rows that are not contacts', () => {
  // The connections sheet searches a username, an occupation and a city. Same
  // rule, different columns -- which is the thing that kept drifting.
  const connections = [
    { user: { fullName: 'Émile Chen', username: 'emile', occupation: 'Cardiologist', currentCity: 'Montréal' } },
    { user: { fullName: 'Sam Reed', username: 'sreed', occupation: 'Designer', currentCity: 'Austin' } },
  ];
  const fields = (c: (typeof connections)[number]) => [
    c.user.fullName, c.user.username, c.user.occupation, c.user.currentCity,
  ];
  assert.deepEqual(filterBy(connections, 'emile', fields).map((c) => c.user.username), ['emile']);
  assert.deepEqual(filterBy(connections, 'montreal', fields).map((c) => c.user.username), ['emile']);
  assert.deepEqual(filterBy(connections, 'cardio montreal', fields).map((c) => c.user.username), ['emile']);
  assert.equal(filterBy(connections, '', fields), connections);
});

test('filtering is pure: same input, same output, source untouched', () => {
  const before = JSON.stringify(BOOK);
  const a = names(filterPeople(BOOK, 'priya'));
  const b = names(filterPeople(BOOK, 'priya'));
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(BOOK), before);
});

test('a query of punctuation alone matches nobody rather than everybody', () => {
  // An empty term list means "no filter", so a query that folds to nothing has
  // to be treated as an empty query -- but a query that folds to punctuation
  // still has to be a real term and match nothing.
  assert.deepEqual(names(filterPeople(BOOK, '@@@')), []);
  assert.deepEqual(names(filterPeople(BOOK, '...')), []);
});
