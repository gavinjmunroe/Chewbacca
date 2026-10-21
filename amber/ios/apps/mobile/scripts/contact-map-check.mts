/**
 * A CONTACT IN YOUR PHONE IS A CONTACT IN AMBER.
 *
 * Run with:  node --experimental-strip-types scripts/contact-map-check.mts
 *
 * "I searched for a new contact that I added, and it wasn't there... For a few
 *  contacts that I added that were real users, I just did not see them come up
 *  in Amber, especially as of late."
 *
 * One cause was three characters wide. The reader named a card with
 * `c.name ?? [first, last].join(' ')`, and `??` falls through null and undefined
 * but NOT through an empty string -- so a card iOS handed over with name: '' and
 * a real first and last name came out nameless and was thrown away. No log, no
 * count, and the same person vanished again on every re-sync.
 *
 * These cases are the contract: everything nameable gets a name, and only a card
 * with nothing to call it by is refused.
 */
import {
  addressesForCard,
  datesForCard,
  displayNameForCard,
  emailsForCard,
  isoDateFromParts,
  mapDeviceCard,
  phonesForCard,
  primaryAddressForCard,
  relationshipsForCard,
  urlsForCard,
  type RawCard,
} from '../lib/contactMap.ts';

let failures = 0;
function check(what: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    failures += 1;
    console.error(`FAIL ${what}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`);
  } else {
    console.log(`ok   ${what}`);
  }
}

// THE BUG, AS A TEST. This is the case that was being dropped.
check(
  'an empty name falls through to the name parts',
  displayNameForCard({ name: '', firstName: 'Maggie', lastName: 'Okafor' }),
  'Maggie Okafor',
);
check(
  'a whitespace-only name falls through too',
  displayNameForCard({ name: '   ', firstName: 'Ajay' }),
  'Ajay',
);
check(
  'a full name is used as given',
  displayNameForCard({ name: 'Margaret Okafor', firstName: 'Maggie' }),
  'Margaret Okafor',
);
check('a first name alone is a name', displayNameForCard({ firstName: 'Beau' }), 'Beau');
check('a last name alone is a name', displayNameForCard({ lastName: 'Patel' }), 'Patel');
check(
  'an organisation card is named by its company',
  displayNameForCard({ company: 'Karnataka Plumbing' }),
  'Karnataka Plumbing',
);
check(
  'a person beats their company',
  displayNameForCard({ firstName: 'Ravi', company: 'Karnataka Plumbing' }),
  'Ravi',
);
check('nothing to call them by is empty', displayNameForCard({ phoneNumbers: [{ number: '+13105550100' }] }), '');

// Reachability: order preserved, blanks and nulls dropped, whitespace trimmed.
check(
  'phones keep their order and lose the blanks',
  phonesForCard({
    phoneNumbers: [{ number: ' +1 310 555 0100 ' }, { number: '' }, null, { number: '+13105550111' }],
  }),
  ['+1 310 555 0100', '+13105550111'],
);
check(
  'emails keep their order and lose the blanks',
  emailsForCard({ emails: [{ email: 'a@b.com' }, { email: null }, { email: '  c@d.com ' }] }),
  ['a@b.com', 'c@d.com'],
);
check('no phones is an empty list, never undefined', phonesForCard({}), []);
check('no emails is an empty list, never undefined', emailsForCard({}), []);

// The whole mapping.
const mapped = mapDeviceCard({
  id: 'ABC-123',
  name: '',
  firstName: 'Maggie',
  lastName: 'Okafor',
  company: 'Bluebird',
  phoneNumbers: [{ number: '+13105550100' }],
  emails: [{ email: 'maggie@bluebird.co' }],
});
check('the card maps with its device id', mapped?.id, 'ABC-123');
check('...and the recovered name', mapped?.name, 'Maggie Okafor');
check('...and keeps the name parts for first-name address', [mapped?.firstName, mapped?.lastName], [
  'Maggie',
  'Okafor',
]);
check('...and the company as context', mapped?.organization, 'Bluebird');

check(
  'a card with no id at all still gets a stable one from its name and number',
  mapDeviceCard({ firstName: 'Ravi', phoneNumbers: [{ number: '+13105550100' }] })?.id,
  'Ravi-+13105550100',
);
check('a card with nothing to call it by is refused', mapDeviceCard({ phoneNumbers: [] }), null);

// THE ZERO-INDEXED MONTH AND THE MISSING YEAR, for every labeled date and not
// just the birthday. Both traps produce plausible wrong data rather than an
// error, so both are pinned here.
check('January is month 0, not month 1', isoDateFromParts({ day: 4, month: 0, year: 1990 }), '1990-01-04');
check('December is month 11', isoDateFromParts({ day: 31, month: 11, year: 2001 }), '2001-12-31');
check('a date with no year is refused, never invented', isoDateFromParts({ day: 14, month: 5 }), undefined);
check('a corrupt year is refused too', isoDateFromParts({ day: 1, month: 1, year: 20024 }), undefined);
check('parts are zero-padded to ISO', isoDateFromParts({ day: 7, month: 8, year: 1977 }), '1977-09-07');

// Addresses. Every part is independently optional and iOS leaves empty entries
// behind, so an entry has to be judged part by part.
check(
  'addresses keep their order and their labels',
  addressesForCard({
    addresses: [
      { label: 'home', street: ' 12 Bellwood Ave ', city: 'Chicago', region: 'IL', postalCode: '60614', country: 'USA' },
      { label: 'work', city: 'Oakland', region: 'CA' },
    ],
  }),
  [
    { label: 'home', street: '12 Bellwood Ave', city: 'Chicago', region: 'IL', postalCode: '60614', country: 'USA' },
    { label: 'work', street: undefined, city: 'Oakland', region: 'CA', postalCode: undefined, country: undefined },
  ],
);
check(
  'an entry with a label and no place is not an address',
  addressesForCard({ addresses: [{ label: 'home' }, { label: 'work', street: '' }, null] }),
  [],
);
check('no addresses is an empty list, never undefined', addressesForCard({}), []);
check(
  'the primary address is the first one that holds a place, not the first slot',
  primaryAddressForCard({ addresses: [{ label: 'home' }, { city: 'Austin', region: 'TX' }] })?.city,
  'Austin',
);
// The Frankenstein case: city and region must not be sourced from different
// entries, or the contact ends up living somewhere that is on no address.
const twoPlaces = mapDeviceCard({
  firstName: 'Nina',
  addresses: [
    { label: 'home', city: 'Chicago', region: 'IL' },
    { label: 'work', city: 'Oakland', region: 'CA' },
  ],
});
check('city, region and country all come off one entry', [twoPlaces?.city, twoPlaces?.region], ['Chicago', 'IL']);
check('...and the full set still travels', twoPlaces?.addresses?.length, 2);

// Web links: a URL with no label is kept, a label with no URL is not a link.
check(
  'urls keep their labels and lose the empty ones',
  urlsForCard({ urlAddresses: [{ label: 'home page', url: ' https://nina.dev ' }, { label: 'work' }, { url: 'https://x.com/nina' }] }),
  [
    { label: 'home page', url: 'https://nina.dev' },
    { label: undefined, url: 'https://x.com/nina' },
  ],
);
check('no urls is an empty list, never undefined', urlsForCard({}), []);

// Labeled dates: same two traps as the birthday, and the year-less anniversary
// is dropped rather than given a year it never had.
check(
  'an anniversary with a year survives, zero-indexed month and all',
  datesForCard({ dates: [{ label: ' anniversary ', day: 2, month: 5, year: 2014 }] }),
  [{ label: 'anniversary', date: '2014-06-02' }],
);
check(
  'a year-less anniversary is dropped, not guessed at',
  datesForCard({ dates: [{ label: 'anniversary', day: 2, month: 5 }] }),
  [],
);
check('no dates is an empty list, never undefined', datesForCard({}), []);

// Relationships: free text with a label, and the label is the point.
check(
  'relationships keep the label that gives them meaning',
  relationshipsForCard({ relationships: [{ label: 'spouse', name: ' Jane ' }, { label: '', name: '' }, null, { name: 'Dan' }] }),
  [
    { label: 'spouse', name: 'Jane' },
    { label: undefined, name: 'Dan' },
  ],
);
check('no relationships is an empty list, never undefined', relationshipsForCard({}), []);

// THE REST OF THE ADDRESS BOOK, END TO END. A card with everything on it, and
// then a card with none of it -- absence has to stay absence, because an empty
// array per field per contact is bytes bought for nothing across 2,000 cards.
const full = mapDeviceCard({
  id: 'FULL-1',
  firstName: 'Priya',
  middleName: 'Lakshmi',
  lastName: 'Rao',
  nickname: ' Pri ',
  company: 'Bluebird',
  jobTitle: ' Head of Design ',
  department: ' Product ',
  phoneNumbers: [{ number: '+13105550100' }],
  emails: [{ email: 'priya@bluebird.co' }],
  addresses: [{ label: 'home', street: '9 Ash St', city: 'Chicago', region: 'IL', postalCode: '60614', country: 'USA' }],
  urlAddresses: [{ label: 'home page', url: 'https://priya.design' }],
  birthday: { day: 4, month: 0, year: 1990 },
  dates: [{ label: 'anniversary', day: 2, month: 5, year: 2014 }],
  relationships: [{ label: 'spouse', name: 'Jane' }],
});
check('the middle name travels', full?.middleName, 'Lakshmi');
check('jobTitle becomes title, trimmed', full?.title, 'Head of Design');
check('the department travels', full?.department, 'Product');
check('the place is flattened for search', [full?.city, full?.region, full?.country], ['Chicago', 'IL', 'USA']);
check('the birthday still parses its zero-indexed month', full?.birthday, '1990-01-04');
check('the labeled dates travel', full?.dates, [{ label: 'anniversary', date: '2014-06-02' }]);
check('the relationships travel', full?.relationships, [{ label: 'spouse', name: 'Jane' }]);
check('the urls travel', full?.urls, [{ label: 'home page', url: 'https://priya.design' }]);

const bare = mapDeviceCard({ id: 'BARE-1', firstName: 'Beau' });
check(
  'a bare card carries no empty arrays',
  [bare?.addresses, bare?.urls, bare?.dates, bare?.relationships],
  [undefined, undefined, undefined, undefined],
);
check(
  'a bare card carries no empty strings',
  [bare?.middleName, bare?.title, bare?.department, bare?.city, bare?.region, bare?.country],
  [undefined, undefined, undefined, undefined, undefined, undefined],
);
// And the proof that absence really is absence once it is serialized: this is
// the shape of the body, and a card with nothing extra must not grow it.
check(
  'the serialized bare card has only the keys it earned',
  Object.keys(JSON.parse(JSON.stringify(bare))).sort(),
  ['emails', 'firstName', 'id', 'name', 'phones'],
);

if (failures > 0) {
  console.error(`\n${failures} check${failures === 1 ? '' : 's'} failed.`);
  process.exit(1);
}
console.log('\nAll contact-mapping checks passed.');
