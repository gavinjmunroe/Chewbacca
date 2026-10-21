// TURNING AN APPLE CONTACT CARD INTO A CONTACT, AS A PURE FUNCTION.
//
// It lives apart from lib/contactsSync so it can be tested by node without
// react-native or expo-contacts in the way (see scripts/contact-map-check.mts).
// This is the step where people went missing, and the bug was three characters
// long, so it earns a test.

/** The shape expo-contacts hands back, narrowed to the fields we read. */
export type RawCard = {
  id?: string | null;
  name?: string | null;
  firstName?: string | null;
  /**
   * Apple's Middle Name. Requested and carried because it is often the ONLY
   * thing that tells two cards with the same first and last name apart, which
   * is the exact case a merge has to get right -- two people who really are
   * both "Priya Rao" must not collapse into one contact just because the app
   * threw away the one field the address book uses to distinguish them.
   */
  middleName?: string | null;
  lastName?: string | null;
  company?: string | null;
  phoneNumbers?: ({ number?: string | null } | null)[] | null;
  emails?: ({ email?: string | null } | null)[] | null;
  nickname?: string | null;
  /**
   * Apple's protected Notes field. The shipped app deliberately does not
   * request it: iOS rejects the whole contact fetch without the restricted
   * contacts.notes entitlement. Keep mapping support for explicitly supplied
   * records, but never add it to the device fetch without signed entitlement.
   */
  note?: string | null;
  /**
   * expo-contacts hands birthdays back as parts, and TWO THINGS ABOUT IT ARE
   * traps. `month` is ZERO-INDEXED, and `year` is OPTIONAL -- Apple lets a
   * birthday be a day and a month with no year, which is very common for
   * friends. See birthdayForCard.
   */
  birthday?: { day?: number | null; month?: number | null; year?: number | null } | null;
  /**
   * Apple's Job Title. Named `title` from MappedContact onward, because that is
   * what the server's column is called; the rename happens once, in
   * mapDeviceCard, rather than being remembered at every later hop.
   */
  jobTitle?: string | null;
  /** Apple's Department. A separate field from Job Title on the card, so a separate field here. */
  department?: string | null;
  /**
   * Postal addresses.
   *
   * EVERY PART IS OPTIONAL INDEPENDENTLY OF EVERY OTHER PART, which is the
   * thing to know before reading one. A card can be a city with no street, a
   * country with no city, or a label with nothing at all behind it -- Apple
   * creates an empty address entry the moment someone taps "add address" and
   * then backs out. So the presence of an entry is not evidence of a place, and
   * an entry has to be inspected part by part rather than trusted whole.
   *
   * `neighborhood`, `poBox` and `isoCountryCode` also come back from iOS and
   * are deliberately not read here: nothing downstream has a home for them, and
   * a field that is carried but never used is a field nobody notices going
   * wrong.
   */
  addresses?:
    | ({
        street?: string | null;
        city?: string | null;
        region?: string | null;
        postalCode?: string | null;
        country?: string | null;
        label?: string | null;
      } | null)[]
    | null;
  /**
   * Web links on the card -- a personal site, a LinkedIn URL somebody pasted in
   * by hand, a company page. Apple keeps the label ("home page", "work") apart
   * from the URL, and the label is worth carrying: "the LinkedIn one" is a
   * question the app will eventually be asked, and it cannot be answered from a
   * bare list of strings.
   */
  urlAddresses?: ({ url?: string | null; label?: string | null } | null)[] | null;
  /**
   * Apple's other labeled dates: anniversary, graduation, the day someone
   * started a job -- whatever the person typed a label for.
   *
   * THE SAME TWO TRAPS AS BIRTHDAY, because on the iOS side it is literally the
   * same struct: `month` is ZERO-INDEXED, and `year` is OPTIONAL. A year-less
   * anniversary is, if anything, more common than a year-less birthday, so this
   * is the normal path and not an edge case. Both traps are handled in exactly
   * one place, isoDateFromParts, which birthdayForCard also goes through -- the
   * point being that the zero-indexed month cannot be fixed in one reader and
   * forgotten in the other.
   *
   * iOS also sends a `format` on each entry (Apple's non-Gregorian calendar
   * support). It is not read: `dates` is documented as Gregorian, only the
   * separate NonGregorianBirthday field is not, and pretending to handle a
   * Hebrew or Chinese calendar by ignoring the flag that says which one it is
   * would be worse than not handling it.
   */
  dates?:
    | ({
        day?: number | null;
        month?: number | null;
        year?: number | null;
        label?: string | null;
      } | null)[]
    | null;
  /**
   * "spouse: Jane", "mother: Priya", "assistant: Dan".
   *
   * THE NAME IS FREE TEXT, NOT A LINK. Apple never connects a relationship to
   * another card, even when the name matches one exactly, so this is a string
   * that happens to look like a reference and must not be treated as one. The
   * label is the half that carries the meaning, and it is the reason this field
   * is worth syncing at all: knowing that Jane is a spouse and not a coworker
   * is not recoverable from anything else on the card.
   */
  relationships?: ({ name?: string | null; label?: string | null } | null)[] | null;
};

/**
 * One postal address, cleaned. Every part optional for the reason spelled out
 * on RawCard.addresses: Apple hands back half-empty address entries as a matter
 * of course, and an address that is only a city is still worth keeping.
 */
export type MappedAddress = {
  label?: string;
  street?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
};

/** One web link, cleaned. The label survives so "the LinkedIn one" is answerable. */
export type MappedUrl = { label?: string; url?: string };

/**
 * One labeled date. `date` is required and always a real ISO YYYY-MM-DD: an
 * entry that cannot produce one is dropped rather than carried as a partial,
 * for the reason given on isoDateFromParts.
 */
export type MappedDate = { label?: string; date: string };

/** One relationship. Both halves optional; an entry with neither is dropped. */
export type MappedRelationship = { label?: string; name?: string };

export type MappedContact = {
  id: string;
  name: string;
  firstName?: string;
  /** See RawCard.middleName: often the only thing separating two same-named people. */
  middleName?: string;
  lastName?: string;
  phones: string[];
  emails: string[];
  organization?: string;
  nickname?: string;
  /** ISO YYYY-MM-DD, and only when the year is real. See birthdayForCard. */
  birthday?: string;
  /** Empty until the Apple notes entitlement lands. See RawCard.note. */
  notes?: string;
  /** Apple's jobTitle, renamed once here to the name the server stores it under. */
  title?: string;
  department?: string;
  /**
   * The place this person is, flattened out of their first usable address so
   * that "who do I know in Chicago" does not have to dig through an array.
   *
   * ALL THREE COME FROM THE SAME ADDRESS ENTRY, on purpose. Taking the city
   * from whichever entry happened to have one and the region from whichever
   * other entry happened to have one invents a location that appears nowhere on
   * the card -- a home city in Illinois married to a work state of California
   * reads as a real place and is not one. See primaryAddressForCard.
   */
  city?: string;
  region?: string;
  country?: string;
  /**
   * The full set of addresses, not just the flattened one above. Absent rather
   * than empty when there are none: this payload is sent for every card in an
   * address book that runs to a couple of thousand, and an empty array per
   * field per contact is real bytes bought for nothing.
   */
  addresses?: MappedAddress[];
  urls?: MappedUrl[];
  dates?: MappedDate[];
  relationships?: MappedRelationship[];
};

/**
 * A birthday as a date, or undefined.
 *
 * TWO TRAPS, both of which produce wrong data rather than an error.
 *
 * `month` is zero-indexed, so a January birthday arrives as month 0 and reading
 * it as a calendar month makes everyone a month early.
 *
 * `year` is optional. Apple allows a day and a month with no year, and that is
 * the common case for friends. There is nowhere for a year-less birthday to go
 * in a timestamptz column, and INVENTING a year produces a birthday that is
 * wrong in every reminder built on it -- so those are dropped here rather than
 * guessed at. Better to have no birthday than the wrong one.
 */
export function birthdayForCard(c: RawCard): string | undefined {
  // The parsing itself is isoDateFromParts, shared with Apple's other labeled
  // dates. Anniversaries arrive in the identical struct with the identical two
  // traps, and a zero-indexed month fixed in one reader and forgotten in the
  // other is the same bug shipped twice, so there is exactly one reader.
  return isoDateFromParts(c.birthday);
}

/**
 * An ISO YYYY-MM-DD out of Apple's date parts, or undefined.
 *
 * THIS IS WHERE BOTH TRAPS ARE HANDLED, ONCE, for birthdays and for every other
 * labeled date on the card. See birthdayForCard for what they cost: a
 * zero-indexed month read as a calendar month makes everyone a month early, and
 * a year Apple never had, invented to fill the column, is wrong in every
 * reminder and every anniversary count built on top of it. A date that cannot
 * be stated exactly is not stated at all.
 *
 * The year is also range-checked. A card can carry a typo'd year -- 20024, or a
 * 2-digit year that came in from some ancient import as 0024 -- and a date
 * outside 1900-2200 is not a person's birthday or anniversary, it is corrupt
 * input that would sort to the ends of every list it appears in.
 */
export function isoDateFromParts(
  parts?: { day?: number | null; month?: number | null; year?: number | null } | null,
): string | undefined {
  const b = parts;
  if (!b) return undefined;
  const day = Number(b.day);
  const month = Number(b.month);
  const year = Number(b.year);
  // WHOLE NUMBERS ONLY. Number.isFinite(1.5) is true, so a fractional day got
  // through the range check and String(1.5).padStart(2,'0') produced
  // "2024-02-1.5" -- a string sitting in a date column that is not a date.
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return undefined;
  if (year < 1900 || year > 2200) return undefined;
  if (day < 1 || day > 31 || month < 0 || month > 11) return undefined;
  // AND THE DAY HAS TO EXIST IN THAT MONTH.
  //
  // The checks above are per-field, which lets through the 31st of February.
  // A card really does carry one -- a typo, or an import that clamped a day to
  // 31 -- and "2024-02-31" is worse than no birthday at all, because it passes
  // for a date right up until something parses it and every consumer disagrees:
  // Postgres rejects it, JavaScript rolls it forward to March 2nd, and the
  // reminder built on it fires on the wrong day. Leap years included, which is
  // the one people get wrong in the other direction: 2000 IS a leap year and
  // 1900 is not.
  //
  // Checked by construction rather than by a table of month lengths, so the
  // rule cannot drift: build the date and see whether it stayed put.
  const probe = new Date(Date.UTC(year, month, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month ||
    probe.getUTCDate() !== day
  ) {
    return undefined;
  }
  const mm = String(month + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/**
 * The display name for a card, or '' if there is nothing to call this person.
 *
 * TRUTHINESS, NOT NULLISHNESS, and that is the whole point of this function
 * existing. The reader used `c.name ?? [first, last].join(' ')`, and `??` does
 * not fall through an EMPTY STRING -- so a card iOS handed over with name: ''
 * and a perfectly good first and last name resolved to '', was dropped as
 * nameless, and the person simply was not in Amber. Nothing logged it, nothing
 * counted it, and re-syncing dropped them again.
 *
 * Company is a legitimate third fallback: an organisation card is a contact, and
 * a plumber saved as a business with no person's name attached is exactly the
 * kind of card that was disappearing.
 */
export function displayNameForCard(c: RawCard): string {
  return (
    (c.name || '').trim() ||
    [c.firstName, c.lastName].filter(Boolean).join(' ').trim() ||
    (c.company || '').trim()
  );
}

/** Non-empty phone strings, in card order. */
export function phonesForCard(c: RawCard): string[] {
  return (c.phoneNumbers ?? [])
    .map((p) => p?.number)
    .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
    .map((n) => n.trim());
}

/** Non-empty email strings, in card order. */
export function emailsForCard(c: RawCard): string[] {
  return (c.emails ?? [])
    .map((e) => e?.email)
    .filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
    .map((e) => e.trim());
}

/**
 * A trimmed string, or undefined for null, undefined, and whitespace.
 *
 * iOS is generous with blanks. An address entry someone abandoned half-typed
 * comes back with `street: ''`, and a card edited on a Mac can carry a job
 * title that is a single space. Those are not values; storing them means a
 * contact whose title is " " reads as having a title everywhere in the app and
 * shows as blank everywhere it is displayed. Emptiness is normalized to absence
 * here so that "do we have this?" has one answer.
 */
function trimmed(v: string | null | undefined): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

/**
 * Non-empty postal addresses, in card order.
 *
 * An entry with nothing in any part is dropped entirely rather than kept as an
 * empty object: Apple manufactures those the moment someone taps "add address"
 * and backs out, and shipping one per abandoned tap would make a contact look
 * like it has an address when it has a label at best. See RawCard.addresses.
 */
export function addressesForCard(c: RawCard): MappedAddress[] {
  const out: MappedAddress[] = [];
  for (const a of c.addresses ?? []) {
    if (!a) continue;
    const entry: MappedAddress = {
      label: trimmed(a.label),
      street: trimmed(a.street),
      city: trimmed(a.city),
      region: trimmed(a.region),
      postalCode: trimmed(a.postalCode),
      country: trimmed(a.country),
    };
    // A label on its own is not an address. "Home" with no home behind it tells
    // nobody where anybody is, and it is the single most common thing iOS hands
    // back in this array.
    const hasPlace =
      entry.street || entry.city || entry.region || entry.postalCode || entry.country;
    if (hasPlace) out.push(entry);
  }
  return out;
}

/**
 * The address the flattened city/region/country come off, or undefined.
 *
 * It is the first address that actually holds a place, not literally
 * `addresses[0]`, because `addresses[0]` is frequently the abandoned empty
 * entry described on RawCard.addresses -- and reading city from an empty first
 * entry means a contact with a perfectly good second address has no city at
 * all, which is the whole failure this sync is meant to stop.
 *
 * Whatever entry this returns, all three flattened parts come off THAT ONE. See
 * MappedContact.city for why mixing them fabricates places.
 */
export function primaryAddressForCard(c: RawCard): MappedAddress | undefined {
  return addressesForCard(c)[0];
}

/**
 * Non-empty web links, in card order. An entry with no URL is dropped -- a
 * label with no link behind it is not a link -- while a URL with no label is
 * kept, because an unlabeled personal site is still the person's site.
 */
export function urlsForCard(c: RawCard): MappedUrl[] {
  const out: MappedUrl[] = [];
  for (const u of c.urlAddresses ?? []) {
    if (!u) continue;
    const url = trimmed(u.url);
    if (!url) continue;
    out.push({ label: trimmed(u.label), url });
  }
  return out;
}

/**
 * Labeled dates that resolve to a real calendar day, in card order.
 *
 * YEAR-LESS ENTRIES ARE DROPPED, exactly as birthdayForCard drops a year-less
 * birthday, and for exactly the same reason: Apple lets an anniversary be a day
 * and a month with no year, there is nowhere for a partial date to go in a date
 * column, and inventing a year produces an anniversary that is wrong in every
 * count of years built on it. A wrong date is worse than a missing one, because
 * a missing one is visibly missing. Both traps -- the zero-indexed month and
 * the optional year -- are handled in isoDateFromParts.
 */
export function datesForCard(c: RawCard): MappedDate[] {
  const out: MappedDate[] = [];
  for (const d of c.dates ?? []) {
    if (!d) continue;
    const date = isoDateFromParts(d);
    if (!date) continue;
    out.push({ label: trimmed(d.label), date });
  }
  return out;
}

/**
 * Relationships, in card order. An entry needs a name or a label to be worth
 * anything: "spouse" with no name and a name with no relationship are both
 * still information, but an entry with neither is an empty row iOS left behind.
 * See RawCard.relationships on why the name is not a link to another card.
 */
export function relationshipsForCard(c: RawCard): MappedRelationship[] {
  const out: MappedRelationship[] = [];
  for (const r of c.relationships ?? []) {
    if (!r) continue;
    const label = trimmed(r.label);
    const name = trimmed(r.name);
    if (!label && !name) continue;
    out.push({ label, name });
  }
  return out;
}

/**
 * A stable id for a card iOS gave no identifier for.
 *
 * It used to be `${name}-${phone ?? email ?? ''}`, which is unique right up
 * until the card has neither -- and then every card sharing a name produces the
 * SAME id. Two contacts called "Dentist", two called "Mom", two called "Front
 * Desk": an upsert keyed on that id keeps one and silently discards the other,
 * with no count anywhere saying a person was dropped. Those are common rows in a
 * real address book, not contrived ones.
 *
 * A card WITH a phone or an email keeps exactly the id it had, so nothing that
 * already synced is renamed. Only the colliding case changes, and it was already
 * broken.
 */
function fallbackId(name: string, contactPoint: string | undefined, c: RawCard): string {
  if (contactPoint) return `${name}-${contactPoint}`;
  // Everything else on the card that could tell two same-named people apart,
  // hashed so the id stays short and stable across syncs. Deterministic: the
  // same card must produce the same id every time or every sync inserts a
  // duplicate.
  const distinguishing = [
    c.firstName, c.middleName, c.lastName, c.company, c.jobTitle, c.department,
    c.nickname, c.note,
    ...(c.addresses ?? []).map((a) => [a?.street, a?.city, a?.region, a?.postalCode].join('|')),
    ...(c.urlAddresses ?? []).map((u) => u?.url),
  ]
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .join('\u0001');
  let h = 2166136261;
  for (let i = 0; i < distinguishing.length; i += 1) {
    h ^= distinguishing.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // A card with a name and literally nothing else still gets a stable id; two
  // such cards are genuinely indistinguishable and collapsing them is correct.
  return `${name}-${(h >>> 0).toString(36)}`;
}

/**
 * Map one card, or null if it cannot be named. Null is a decision the caller has
 * to count -- see DeviceContactsRead.skipped -- not something to drop quietly.
 */
export function mapDeviceCard(c: RawCard): MappedContact | null {
  const name = displayNameForCard(c);
  if (!name) return null;
  const phones = phonesForCard(c);
  const emails = emailsForCard(c);
  const addresses = addressesForCard(c);
  const primaryAddress = primaryAddressForCard(c);
  const urls = urlsForCard(c);
  const dates = datesForCard(c);
  const relationships = relationshipsForCard(c);
  // EVERY OPTIONAL FIELD IS undefined RATHER THAN EMPTY, and the lists are
  // absent rather than []. This object is JSON.stringify'd once per contact and
  // an address book here runs past two thousand cards, most of which have no
  // department, no anniversary and no web link; `undefined` disappears from the
  // serialized body while `""` and `[]` do not, so absence costs nothing and
  // presence means something.
  return {
    id: c.id || fallbackId(name, phones[0] ?? emails[0], c),
    name,
    // TRIMMED, LIKE middleName ALREADY WAS. `c.firstName || undefined` keeps a
    // single space, and a card edited on a Mac carries exactly that -- so the
    // composed name rendered with a leading space everywhere in the app while
    // the field itself looked blank. Same source, same problem, same rule.
    firstName: trimmed(c.firstName),
    middleName: trimmed(c.middleName),
    lastName: trimmed(c.lastName),
    phones,
    emails,
    organization: trimmed(c.company),
    nickname: c.nickname?.trim() || undefined,
    birthday: birthdayForCard(c),
    notes: c.note?.trim() || undefined,
    title: trimmed(c.jobTitle),
    department: trimmed(c.department),
    city: primaryAddress?.city,
    region: primaryAddress?.region,
    country: primaryAddress?.country,
    addresses: addresses.length > 0 ? addresses : undefined,
    urls: urls.length > 0 ? urls : undefined,
    dates: dates.length > 0 ? dates : undefined,
    relationships: relationships.length > 0 ? relationships : undefined,
  };
}
