/**
 * NOT EVERY CARD IN AN ADDRESS BOOK IS A PERSON.
 *
 * "UW-Madison Finaid Front Desk". "Catering Office Wisconsin Union". "Housing
 * Assignments". "Marina Bay Sands Singapore". "BKLYN GOLD RENTALS". Those are
 * a counter, a mailbox, a queue and a hotel, and drawn as dots in a personal
 * network they are indistinguishable from friends -- which makes the whole
 * picture read as noise, because a third of it is.
 *
 * They still belong in the book. You do want the dentist's number. They just
 * do not belong in the same visual category as the people you know, so they
 * get their own group and can be lit or ignored as a set.
 *
 * TWO SIGNALS, BOTH CONSERVATIVE:
 *
 *   A ROLE ADDRESS. info@, admissions@, do_not_reply@, front.desk@,
 *   labor_relations_mail@. Nobody is named Billing. The local part is split on
 *   dots and underscores first, because "front.desk" and "labor_relations_mail"
 *   are role addresses spelled with separators.
 *
 *   AN INSTITUTION WORD IN THE NAME, matched as a whole token and never as a
 *   substring. Token matching is the entire discipline here: "shop" inside
 *   "Bishop" and "car" inside "Carol" are how a classifier like this starts
 *   quietly filing people as businesses, and a wrong answer costs more than a
 *   missed one -- somebody scanning for a friend will not find them.
 *
 * WHEN IN DOUBT IT SAYS PERSON. A book has far more people in it than places,
 * so the prior is on people, and everything unrecognised stays one.
 *
 * PURE. A row in, a word out.
 */

/** Local parts nobody is named. */
const ROLE_LOCALS = new Set([
  "info", "admin", "administration", "administrator", "support", "sales",
  "contact", "hello", "office", "noreply", "donotreply", "billing", "hr",
  "reservations", "reservation", "help", "team", "service", "services",
  "careers", "jobs", "recruiting", "recruitment", "orders", "order",
  "bookings", "booking", "enquiries", "inquiries", "mail", "mailer",
  "marketing", "accounts", "accounting", "payroll", "frontdesk", "desk",
  "reception", "admissions", "registrar", "security", "webmaster",
  "postmaster", "notifications", "notification", "alerts", "news",
  "newsletter", "feedback", "press", "legal", "privacy", "compliance",
  "catering", "events", "membership", "customerservice", "customercare",
  "corp", "corporate", "hq", "front",
]);

/**
 * Whole-local substrings that are safe because they are long and specific.
 * Anything shorter goes in ROLE_LOCALS and is matched as a token instead.
 */
const ROLE_SUBSTRINGS = [
  "noreply", "no-reply", "donotreply", "do-not-reply", "school", "admissions",
  "recruiting", "helpdesk", "customerservice", "frontdesk", "webmaster",
];

/** Words that name an institution rather than a human being. */
const ORG_WORDS = new Set([
  // corporate forms
  "llc", "inc", "corp", "corporation", "ltd", "limited", "plc", "gmbh", "co",
  "company", "group", "holdings", "partners", "associates", "assoc", "firm",
  "enterprises", "ventures", "capital",
  // places of business
  "office", "offices", "clinic", "hospital", "medical", "dental", "dentistry",
  "orthodontics", "pharmacy", "urgent", "care", "health", "healthcare",
  "wellness", "veterinary", "vet", "salon", "spa", "barber", "gym", "fitness",
  "studio", "yoga", "pilates", "crossfit", "restaurant", "pizza", "pizzeria",
  "cafe", "coffee", "bakery", "deli", "grill", "kitchen", "bar", "pub",
  "bistro", "diner", "catering", "hotel", "motel", "inn", "resort", "lodge",
  "rentals", "rental", "realty", "properties", "property", "bank", "credit",
  "union", "insurance", "agency", "law", "attorney", "store", "shop",
  "market", "mart", "boutique", "outlet", "auto", "motors", "repair",
  "plumbing", "hvac", "electric", "roofing", "landscaping", "cleaning",
  "moving", "storage", "airlines", "airways", "airport", "transit", "taxi",
  "cab", "delivery", "express", "logistics", "dealership",
  // institutions
  "school", "schools", "academy", "college", "university", "institute",
  "district", "department", "dept", "division", "program", "programs",
  "admissions", "registrar", "recruiting", "recruitment", "staffing",
  "housing", "financial", "finaid", "bursar", "library", "museum", "theater",
  "theatre", "cinema", "church", "temple", "mosque", "synagogue", "municipal",
  "county", "dmv", "irs", "embassy", "consulate",
  // functions and queues
  "services", "solutions", "systems", "technologies", "technology", "labs",
  "laboratory", "center", "centers", "club", "support", "helpdesk", "desk",
  "reservations", "reception", "billing", "payroll", "accounts", "accounting",
  "relations", "communications", "operations", "logistics", "assignments",
  "account", "mailbox", "notifications", "alerts", "newsletter", "hotline",
  "helpline", "hr", "it",
]);

/**
 * ORG WORDS THAT ARE ALSO ORDINARY SURNAMES.
 *
 * "Jay Barber" was filed as a business on the strength of the word "barber",
 * and so would Mike Law, Charlotte Church and anyone named Lodge, Temple or
 * Inn. English surnames are largely trades and places -- that is where they
 * came from -- so a trade word in a two-word name is at least as likely to be
 * somebody's family name as a shop.
 *
 * The distinguishing fact is that a business says what it is IN ADDITION to
 * what it is called: "Magico Barber Shop" has "shop" too, "Law Office" has
 * "office". So a name whose ONLY institution word is one of these, sitting
 * where a surname sits, is a person. Both ends count, because half this
 * address book is written "Calvert, Dave".
 */
const SURNAME_WORDS = new Set(["barber", "law", "church", "lodge", "temple", "inn"]);

const tokensOf = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Does any address on this card read as a role rather than a person? */
export function hasRoleAddress(contact) {
  const raw = Array.isArray(contact?.emails)
    ? contact.emails
    : String(contact?.emails ?? "").split(/[,;|\s]+/);
  for (const e of raw) {
    const at = String(e ?? "").indexOf("@");
    if (at <= 0) continue;
    const local = String(e).slice(0, at).toLowerCase();
    // Separators are how these are actually spelled: "do_not_reply",
    // "front.desk", "labor-relations". Flattening catches the ones that only
    // read as a role once the punctuation is gone.
    const flat = local.replace(/[^a-z0-9]/g, "");
    if (ROLE_SUBSTRINGS.some((sub) => local.includes(sub) || flat.includes(sub))) return true;
    for (const t of tokensOf(local)) if (ROLE_LOCALS.has(t)) return true;
  }
  return false;
}

/** Does the name on this card name an institution? */
export function nameReadsAsOrganization(name) {
  const tokens = tokensOf(name);
  if (tokens.length === 0) return false;
  const matched = tokens.filter((t) => ORG_WORDS.has(t));
  if (matched.length === 0) return false;

  // A trade word carrying the whole claim, in the position a surname occupies
  // on a short name, is a surname. See SURNAME_WORDS.
  if (tokens.length <= 3 && matched.every((t) => SURNAME_WORDS.has(t))) {
    const first = tokens[0];
    const last = tokens[tokens.length - 1];
    if (SURNAME_WORDS.has(first) || SURNAME_WORDS.has(last)) return false;
  }
  return true;
}

/**
 * "person" or "place".
 *
 * `place` covers every non-human card: a business, a school office, a gym, a
 * doctor's surgery, a no-reply mailbox. One word rather than a taxonomy,
 * because the only decision anything downstream makes is whether to treat this
 * dot as somebody you know.
 */
export function classifyContact(contact) {
  const name = contact?.full_name ?? contact?.name ?? "";
  if (hasRoleAddress(contact)) return "place";
  if (nameReadsAsOrganization(name)) return "place";
  return "person";
}
