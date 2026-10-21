/**
 * Realness classifier for PeopleRank (spec item 157).
 *
 * A user's raw address book is full of rows that are not actually people the
 * user has a relationship with: SMS shortcodes (e.g. "262966"), one-time-code
 * senders ("VerificationCode"), no-reply automation, delivery bots, and bare
 * phone numbers with no name. Ranking those alongside real humans pollutes the
 * top of the list and makes PeopleRank feel dumb. This module decides, purely
 * and deterministically, whether a contact row is a real person.
 *
 * Two consumption modes, both exported:
 *   - filterRealContacts(contacts): drop the obvious non-people before ranking.
 *   - classifyRealness(contact): { isReal, confidence, reason } for a single
 *     row, so the route can log / soft-penalize instead of hard-dropping.
 *
 * Conservative by design: when in doubt, a row is treated as real. We only
 * drop rows that match a strong non-person signal, because dropping a real
 * contact is worse than keeping a borderline bot.
 *
 * Pure: no Firestore, no network, no clock.
 */

// Substrings that, when they dominate a contact's name, mark it as automation
// rather than a person. Matched case-insensitively against the collapsed name.
const AUTOMATION_NAME_HINTS = Object.freeze([
  "no-reply",
  "noreply",
  "no reply",
  "do not reply",
  "donotreply",
  "verification",
  "verify",
  "one-time",
  "one time code",
  "otp",
  "passcode",
  "auto-reply",
  "autoreply",
  "notifications",
  "notification",
  "alerts",
  "alert@",
  "support@",
  "info@",
  "help@",
  "billing",
  "receipts",
  "delivery",
  "shipment",
  "tracking",
  "appointment reminder",
  "spam",
  "unknown",
  "unknown caller",
  "robocall",
  "scam likely",
  "potential spam",
]);

// Email-local parts that are automation mailboxes even when used as a name.
const AUTOMATION_EMAIL_LOCALS = Object.freeze([
  "no-reply",
  "noreply",
  "donotreply",
  "do-not-reply",
  "notifications",
  "notification",
  "alerts",
  "support",
  "info",
  "help",
  "billing",
  "receipts",
  "team",
  "hello",
  "contact",
  "mailer-daemon",
  "postmaster",
]);

/** Collapse a name to a lowercased, single-spaced comparison form. */
function normalizeName(name) {
  return String(name || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Strip everything but digits from a string. */
function digitsOnly(s) {
  return String(s || "").replace(/\D/g, "");
}

/**
 * True when the name is really a bare phone number / shortcode rather than a
 * human name. "262966", "+1 (310) 555-1212", "tel:+13105551212" all qualify.
 * A name with letters (a real name, even if it has a number) does not.
 */
function looksLikePhoneOrShortcode(name) {
  const n = normalizeName(name);
  if (!n) return false;
  // Any alphabetic character means it reads as a name, not a number.
  if (/[a-z]/i.test(n)) return false;
  const digits = digitsOnly(n);
  // 3-6 digit shortcodes, or a 7-15 digit phone number, with no letters.
  return digits.length >= 3 && digits.length <= 15;
}

/**
 * True when a name is the automation hints set. Checks the raw name and, if the
 * name is an email address, the local part too.
 */
function looksLikeAutomation(name) {
  const n = normalizeName(name);
  if (!n) return false;
  for (const hint of AUTOMATION_NAME_HINTS) {
    if (n.includes(hint)) return true;
  }
  const at = n.indexOf("@");
  if (at > 0) {
    const local = n.slice(0, at);
    for (const automated of AUTOMATION_EMAIL_LOCALS) {
      if (local === automated) return true;
    }
  }
  return false;
}

/**
 * Classify one contact row. Returns:
 *   { isReal: boolean, confidence: 0..1, reason: string }
 * `confidence` is how sure we are it's a real person (1 = clearly real,
 * 0 = clearly not). `reason` names the dropping signal when isReal is false.
 */
export function classifyRealness(contact) {
  const name = contact?.name;
  const normalized = normalizeName(name);

  if (!normalized) {
    // No name at all. A bare contact with a phone is usually a real person the
    // user never named, so keep it but at low confidence, it should not crowd
    // out named, warm contacts.
    const hasHandle =
      hasAny(contact?.phoneNumbers) ||
      hasAny(contact?.emails) ||
      hasNonEmptyString(contact?.phone) ||
      hasNonEmptyString(contact?.email);
    if (hasHandle) {
      return { isReal: true, confidence: 0.25, reason: "unnamed_with_handle" };
    }
    return { isReal: false, confidence: 0, reason: "no_name_no_handle" };
  }

  if (looksLikeAutomation(normalized)) {
    return { isReal: false, confidence: 0.05, reason: "automation_name" };
  }

  if (looksLikePhoneOrShortcode(normalized)) {
    const digits = digitsOnly(normalized);
    if (digits.length <= 6) {
      return { isReal: false, confidence: 0.05, reason: "sms_shortcode" };
    }
    // A full phone number as the name: likely an un-named real person.
    return { isReal: true, confidence: 0.3, reason: "phone_as_name" };
  }

  // A single-character name is almost never a person worth ranking high.
  if (normalized.length === 1) {
    return { isReal: true, confidence: 0.4, reason: "single_char_name" };
  }

  return { isReal: true, confidence: 1, reason: "named_person" };
}

/**
 * Drop the obvious non-people from a contact list before ranking. Keeps the
 * order stable. Returns { kept, dropped } so the route can log how many rows
 * the classifier removed (useful when debugging "why is my list short").
 */
export function filterRealContacts(contacts) {
  const list = Array.isArray(contacts) ? contacts : [];
  const kept = [];
  const dropped = [];
  for (const c of list) {
    if (classifyRealness(c).isReal) kept.push(c);
    else dropped.push(c);
  }
  return { kept, dropped };
}

/**
 * Realness confidence as a 0..1 multiplier the scorer can apply to soften
 * borderline rows without removing them. A clearly-real person returns 1, so
 * applying this never changes a normal contact's score.
 */
export function realnessMultiplier(contact) {
  return classifyRealness(contact).confidence;
}

function hasAny(arr) {
  return Array.isArray(arr) && arr.some((v) => hasNonEmptyString(v));
}

function hasNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * ORGANISATIONS ARE NOT PEOPLE, and a contact card for one is embarrassing.
 *
 * "Help me plan a dinner in the Bay Area" came back with a card for "IT Self
 * service Desk". A note mentioning USC produced a card for "USC Graduate School".
 * Nobody plans dinner with a help desk. The realness classifier above did not
 * catch these because they are not automation — they are real entries in a real
 * address book that happen not to be humans.
 *
 * THE LIST IS DELIBERATELY CONSERVATIVE, and specifically excludes words that are
 * also surnames. "Church", "Temple", "Banks", "Parish", "Abbey", "Ford", "Cross"
 * and "Marshall" all belong to real people, so none of them are here — dropping a
 * real contact is a worse failure than keeping a borderline org, because the user
 * notices the person who went missing and shrugs at the one that did not.
 *
 * Every token below is one that no human is named: you can be Bill Church but you
 * cannot be Bill Helpdesk.
 */
const ORG_TOKENS = Object.freeze([
  // service functions
  "desk", "helpdesk", "hotline", "reception", "concierge", "switchboard",
  "customer service", "self service", "selfservice", "support", "service",
  "services", "department", "dept", "division", "payroll", "logistics",
  // education
  "school", "university", "college", "academy", "institute", "campus",
  "faculty", "admissions", "registrar", "alumni",
  // health
  "hospital", "clinic", "pharmacy", "dental", "dentistry", "medical",
  "urgent care", "healthcare", "veterinary",
  // corporate suffixes
  "llc", "l.l.c", "inc", "inc.", "incorporated", "ltd", "limited", "corp",
  "corporation", "gmbh", "plc", "pllc", "llp", "co.", "holdings", "ventures",
  "enterprises", "industries", "systems", "solutions", "technologies",
  "consulting", "associates", "group",
  // civic
  "embassy", "consulate", "municipal", "county of", "city of", "dmv",
  "post office", "library", "museum", "courthouse",
  // places of business
  "restaurant", "cafe", "café", "bakery", "pizzeria", "grill", "bistro",
  "hotel", "motel", "resort", "salon", "spa", "gym", "fitness", "studio",
  "boutique", "pharmacy", "dealership", "storage", "laundry", "cleaners",
  "towing", "plumbing", "roofing", "landscaping", "hvac", "realty",
  "mortgage", "escrow", "insurance", "airlines", "airways", "airport",
]);

/** Collapse for token matching: lowercase, single-spaced, padded. */
function paddedName(name) {
  return ` ${normalizeName(name).replace(/[,]/g, " ").replace(/\s+/g, " ")} `;
}

/**
 * True when this name reads as an organisation rather than a person.
 *
 * Also catches a bare acronym ("USC", "IRS", "AAA") — a two-to-five letter name
 * with no lowercase and no second word is an initialism, and a person shown as
 * one has no name to render on a card anyway.
 */
export function looksLikeOrganization(name) {
  const raw = String(name || "").trim();
  if (!raw) return false;
  const padded = paddedName(raw);
  for (const token of ORG_TOKENS) {
    if (padded.includes(` ${token} `)) return true;
  }
  // Trailing corporate suffix with no space before the period, e.g. "Acme Inc."
  if (/\b(inc|ltd|llc|corp|co)\.\s*$/i.test(raw)) return true;
  // A bare initialism.
  const words = raw.split(/\s+/).filter(Boolean);
  if (words.length === 1 && /^[A-Z0-9&.-]{2,5}$/.test(words[0]) && !/[a-z]/.test(words[0])) {
    return true;
  }
  return false;
}

/**
 * The single question every surface that renders a CONTACT CARD should ask.
 *
 * Combines the three ways a row can fail to be a person: it is a phone number or
 * shortcode, it is automation, or it is an organisation. Used by instant tagging
 * and by place recall, so a help desk cannot reach the screen from either.
 */
export function isTaggablePerson(nameOrContact) {
  const contact =
    typeof nameOrContact === "string" ? { name: nameOrContact } : nameOrContact || {};
  const name = contact.name ?? contact.full_name ?? contact.fullName ?? "";
  if (!String(name).trim()) return false;
  if (looksLikeOrganization(name)) return false;
  const verdict = classifyRealness({ ...contact, name });
  return verdict.isReal !== false;
}
