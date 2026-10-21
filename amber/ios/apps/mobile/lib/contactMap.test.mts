/**
 * THE ADDRESS BOOK READER. Everything the app knows about a person starts here.
 *
 * mapDeviceCard turns one iOS contact card into the object that gets uploaded,
 * merged, ranked and answered from. A field dropped here is a field the person
 * never had; a field invented here is a fact about somebody that came from
 * nowhere. Both are silent — nothing downstream can tell the difference between
 * "Apple gave us no city" and "we lost the city".
 *
 * The cards below are the shapes iOS actually hands over, including the ugly
 * ones: the half-typed address somebody backed out of, the title that is a
 * single space, the birthday with no year, the card whose only name is a
 * company. Those are not edge cases in an address book of two thousand.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addressesForCard,
  birthdayForCard,
  datesForCard,
  displayNameForCard,
  emailsForCard,
  isoDateFromParts,
  mapDeviceCard,
  phonesForCard,
  primaryAddressForCard,
  relationshipsForCard,
  urlsForCard,
} from './contactMap.ts';

// ── naming ──────────────────────────────────────────────────────────────────

test('a card with an empty name falls through to the parts, not to nothing', () => {
  // The reader used `c.name ?? [first, last].join(' ')`, and ?? does not fall
  // through an empty string. iOS hands back name: '' constantly, so perfectly
  // good cards resolved to '' and were dropped as nameless, silently, on every
  // sync.
  assert.equal(displayNameForCard({ id: '1', name: '', firstName: 'Ana', lastName: 'Alvarez' } as any), 'Ana Alvarez');
  assert.equal(displayNameForCard({ id: '1', name: '   ', firstName: 'Ana' } as any), 'Ana');
  assert.equal(displayNameForCard({ id: '1', name: '', company: 'Cedar Plumbing' } as any), 'Cedar Plumbing');
  assert.equal(displayNameForCard({ id: '1', name: 'Ana Alvarez', firstName: 'X' } as any), 'Ana Alvarez');
});

test('a card with nothing to call anyone by maps to null, not to a blank person', () => {
  assert.equal(mapDeviceCard({ id: '1', name: '' } as any), null);
  assert.equal(mapDeviceCard({ id: '1', name: '  ', firstName: ' ', lastName: '  ', company: '' } as any), null);
});

test('a first name that is only whitespace is not a first name', () => {
  // middleName goes through trimmed() and firstName/lastName did not, so a card
  // edited on a Mac could carry firstName: ' ' and the app would show a leading
  // space everywhere a name is composed. Same field, same source, same rule.
  const m = mapDeviceCard({ id: '1', name: 'Ana Alvarez', firstName: ' ', lastName: '  ', company: '  ' } as any);
  assert.equal(m?.firstName, undefined);
  assert.equal(m?.lastName, undefined);
  assert.equal(m?.organization, undefined);
});

// ── dates: the two traps, plus the calendar itself ──────────────────────────

test('month is zero-indexed and the reader knows it', () => {
  // A January birthday arrives as month 0. Read as a calendar month it makes
  // everybody a month early.
  assert.equal(isoDateFromParts({ day: 4, month: 0, year: 1990 }), '1990-01-04');
  assert.equal(isoDateFromParts({ day: 25, month: 11, year: 1990 }), '1990-12-25');
});

test('a birthday with no year is dropped rather than guessed at', () => {
  assert.equal(isoDateFromParts({ day: 4, month: 0 }), undefined);
  assert.equal(isoDateFromParts({ day: 4, month: 0, year: null }), undefined);
  assert.equal(birthdayForCard({ id: '1', name: 'A', birthday: { day: 4, month: 0 } } as any), undefined);
});

test('a corrupt year is not a birthday', () => {
  assert.equal(isoDateFromParts({ day: 1, month: 1, year: 20024 }), undefined);
  assert.equal(isoDateFromParts({ day: 1, month: 1, year: 24 }), undefined);
  assert.equal(isoDateFromParts({ day: 1, month: 1, year: 1899 }), undefined);
  assert.equal(isoDateFromParts({ day: 1, month: 1, year: 1900 }), '1900-02-01');
  assert.equal(isoDateFromParts({ day: 1, month: 1, year: 2200 }), '2200-02-01');
});

test('nothing at all is undefined, not a crash', () => {
  assert.equal(isoDateFromParts(undefined), undefined);
  assert.equal(isoDateFromParts(null), undefined);
  assert.equal(isoDateFromParts({}), undefined);
  assert.equal(isoDateFromParts({ day: NaN, month: 1, year: 2000 } as any), undefined);
});

test('THE DATE HAS TO EXIST ON THE CALENDAR', () => {
  // The range check was per-field -- day 1..31, month 0..11 -- which lets
  // through days that do not exist in the month they are in. A card carrying a
  // typo'd 31 February produced "2024-02-31": a string that passes for a date
  // everywhere until something parses it, at which point every consumer gets a
  // different answer. Postgres rejects it outright, JS rolls it forward to March
  // 2nd, and the reminder built on it fires on the wrong day.
  assert.equal(isoDateFromParts({ day: 31, month: 1, year: 2024 }), undefined, '31 February');
  assert.equal(isoDateFromParts({ day: 31, month: 3, year: 2024 }), undefined, '31 April');
  assert.equal(isoDateFromParts({ day: 31, month: 8, year: 2024 }), undefined, '31 September');
  assert.equal(isoDateFromParts({ day: 31, month: 10, year: 2024 }), undefined, '31 November');
});

test('leap day is real in a leap year and not in any other', () => {
  assert.equal(isoDateFromParts({ day: 29, month: 1, year: 2024 }), '2024-02-29');
  assert.equal(isoDateFromParts({ day: 29, month: 1, year: 2000 }), '2000-02-29', '2000 is a leap year');
  assert.equal(isoDateFromParts({ day: 29, month: 1, year: 2023 }), undefined);
  assert.equal(isoDateFromParts({ day: 29, month: 1, year: 1900 }), undefined, '1900 is not a leap year');
});

test('a fractional day is not a day', () => {
  // Number() is happy with 1.5 and Number.isFinite agrees, so the padStart
  // produced "2024-02-1.5" -- a string in date position that is not a date.
  assert.equal(isoDateFromParts({ day: 1.5, month: 1, year: 2024 }), undefined);
  assert.equal(isoDateFromParts({ day: 1, month: 1.2, year: 2024 }), undefined);
  assert.equal(isoDateFromParts({ day: 1, month: 1, year: 2024.5 }), undefined);
});

test('every produced date round-trips through Date without moving', () => {
  // The property that matters: whatever comes out, parsed back, is the same day.
  // Anything that rolls forward is a date that did not exist.
  for (let month = 0; month <= 11; month += 1) {
    for (let day = 1; day <= 31; day += 1) {
      const iso = isoDateFromParts({ day, month, year: 2024 });
      if (!iso) continue;
      const d = new Date(`${iso}T00:00:00Z`);
      assert.equal(d.getUTCFullYear(), 2024, iso);
      assert.equal(d.getUTCMonth(), month, iso);
      assert.equal(d.getUTCDate(), day, iso);
    }
  }
});

test('labeled dates drop the unusable ones and keep the order of the rest', () => {
  const out = datesForCard({
    id: '1',
    name: 'A',
    dates: [
      { label: 'anniversary', day: 12, month: 5, year: 2016 },
      { label: 'no year', day: 3, month: 2 },
      null,
      { label: '  ', day: 1, month: 0, year: 2020 },
      { label: 'impossible', day: 31, month: 1, year: 2020 },
    ],
  } as any);
  assert.deepEqual(out, [
    { label: 'anniversary', date: '2016-06-12' },
    { label: undefined, date: '2020-01-01' },
  ]);
});

// ── the collections ─────────────────────────────────────────────────────────

test('phones and emails keep card order, drop blanks, and are trimmed', () => {
  const card = {
    id: '1',
    name: 'A',
    phoneNumbers: [{ number: '  +1 555 010 1234 ' }, { number: '' }, { number: '   ' }, null, { number: '+442079460958' }],
    emails: [{ email: ' a@example.com ' }, { email: '' }, null],
  } as any;
  assert.deepEqual(phonesForCard(card), ['+1 555 010 1234', '+442079460958']);
  assert.deepEqual(emailsForCard(card), ['a@example.com']);
  assert.deepEqual(phonesForCard({ id: '1', name: 'A' } as any), []);
  assert.deepEqual(emailsForCard({ id: '1', name: 'A' } as any), []);
});

test('an address that is only a label is not an address', () => {
  // iOS manufactures one of these the moment somebody taps "add address" and
  // backs out. Shipping it makes a contact look located when it is not.
  const out = addressesForCard({
    id: '1',
    name: 'A',
    addresses: [
      { label: 'Home', street: '  ', city: '', region: null },
      { label: 'Work', city: ' Chicago ', region: 'IL' },
    ],
  } as any);
  assert.equal(out.length, 1);
  assert.equal(out[0].city, 'Chicago');
  assert.equal(out[0].region, 'IL');
});

test('the flattened city, region and country all come off ONE address', () => {
  // Taking city from whichever entry has one and region from whichever other
  // entry has one invents a place that appears nowhere on the card: a home city
  // in Illinois married to a work state of California reads as real and is not.
  const m = mapDeviceCard({
    id: '1',
    name: 'A',
    addresses: [
      { label: 'empty', street: '   ' },
      { label: 'home', city: 'Chicago', region: 'IL', country: 'USA' },
      { label: 'work', city: 'San Francisco', region: 'CA', country: 'USA' },
    ],
  } as any);
  assert.equal(m?.city, 'Chicago');
  assert.equal(m?.region, 'IL');
  const primary = primaryAddressForCard({
    id: '1',
    name: 'A',
    addresses: [{ label: 'empty' }, { city: 'Austin', region: 'TX' }],
  } as any);
  assert.equal(primary?.city, 'Austin', 'the first address holding a place, not literally addresses[0]');
});

test('a url needs a url; a relationship needs a name or a label', () => {
  assert.deepEqual(
    urlsForCard({ id: '1', name: 'A', urlAddresses: [{ label: 'site' }, { url: ' https://x.example ' }, null] } as any),
    [{ label: undefined, url: 'https://x.example' }],
  );
  assert.deepEqual(
    relationshipsForCard({ id: '1', name: 'A', relationships: [{}, { label: 'spouse' }, { name: 'Ana' }, null] } as any),
    [{ label: 'spouse', name: undefined }, { label: undefined, name: 'Ana' }],
  );
});

// ── the whole card ──────────────────────────────────────────────────────────

test('empty is absent, never "" and never []', () => {
  // This object is serialized once per contact across a book of two thousand.
  // undefined disappears from the body; '' and [] do not. More importantly,
  // absence and emptiness must not be two ways of saying the same thing.
  const m = mapDeviceCard({ id: 'abc', name: 'Ana Alvarez', jobTitle: '  ', department: '', note: '   ' } as any);
  assert.ok(m);
  for (const [k, v] of Object.entries(m!)) {
    assert.notEqual(v, '', `${k} is an empty string`);
    if (Array.isArray(v) && k !== 'phones' && k !== 'emails') {
      assert.notEqual(v.length, 0, `${k} is an empty array`);
    }
  }
  assert.equal(m!.title, undefined);
  assert.equal(m!.department, undefined);
  assert.equal(m!.notes, undefined);
});

test('two different people with the same name do not become one contact', () => {
  // The id falls back to `${name}-${phones[0] ?? emails[0] ?? ''}` when iOS gives
  // no identifier. Two cards named "Dentist" with no phone and no email both
  // produce "Dentist-", and an upsert keyed on that id makes them one person --
  // one of the two is simply gone, and no count anywhere says so.
  const a = mapDeviceCard({ id: '', name: 'Dentist' } as any);
  const b = mapDeviceCard({ id: '', name: 'Dentist', company: 'Elm Street Dental' } as any);
  assert.ok(a && b);
  assert.notEqual(a!.id, b!.id, 'two nameless-but-for-a-shared-name cards collided on one id');
});

test('a real card maps to exactly the fields it has and nothing more', () => {
  const m = mapDeviceCard({
    id: 'ABC-123',
    name: 'Şirin Öztürk',
    firstName: 'Şirin',
    lastName: 'Öztürk',
    middleName: ' ',
    nickname: ' Sisi ',
    company: 'Mount Sinai',
    jobTitle: ' Attending Physician ',
    department: 'Cardiology',
    note: 'met at the conference',
    birthday: { day: 9, month: 8, year: 1984 },
    phoneNumbers: [{ number: '+1 617 555 0104' }],
    emails: [{ email: 'sirin@example.org' }],
    addresses: [{ label: 'work', city: 'Boston', region: 'MA', country: 'USA' }],
    urlAddresses: [{ label: 'site', url: 'https://sirin.example' }],
    dates: [{ label: 'anniversary', day: 2, month: 3, year: 2011 }],
    relationships: [{ label: 'spouse', name: 'Deniz' }],
  } as any);
  assert.deepEqual(m, {
    id: 'ABC-123',
    name: 'Şirin Öztürk',
    firstName: 'Şirin',
    middleName: undefined,
    lastName: 'Öztürk',
    phones: ['+1 617 555 0104'],
    emails: ['sirin@example.org'],
    organization: 'Mount Sinai',
    nickname: 'Sisi',
    birthday: '1984-09-09',
    notes: 'met at the conference',
    title: 'Attending Physician',
    department: 'Cardiology',
    city: 'Boston',
    region: 'MA',
    country: 'USA',
    addresses: [{ label: 'work', street: undefined, city: 'Boston', region: 'MA', postalCode: undefined, country: 'USA' }],
    urls: [{ label: 'site', url: 'https://sirin.example' }],
    dates: [{ label: 'anniversary', date: '2011-04-02' }],
    relationships: [{ label: 'spouse', name: 'Deniz' }],
  });
});

test('mapping is deterministic and does not mutate the card it was given', () => {
  const card = {
    id: 'X',
    name: 'Ana Alvarez',
    phoneNumbers: [{ number: ' +1 555 010 1234 ' }],
    addresses: [{ label: 'home', city: ' Denver ' }],
  } as any;
  const before = JSON.stringify(card);
  const one = mapDeviceCard(card);
  const two = mapDeviceCard(card);
  assert.deepEqual(one, two);
  assert.equal(JSON.stringify(card), before, 'mapDeviceCard mutated its input');
});
