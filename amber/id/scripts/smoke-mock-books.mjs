/**
 * TEN MOCK ADDRESS BOOKS, NONE OF THEM SHAPED LIKE KARTHIK'S.
 *
 * "Why are responses so different for me and different users? ... it seems like
 *  you are just coding around my needs rather than coding in a logical way that
 *  makes it good for all users."
 *
 * The honest answer was: he has data in every column, so every phrasing he tried
 * hit something. Nobody else does. So this file deliberately builds books that
 * are each missing something different -- a book with no notes, a book with no
 * phone numbers, a book with nothing but names, a book with no US area codes --
 * because a retrieval mechanism that only works when all of it is populated is
 * the bug, and a fixture that populates all of it would hide the bug.
 *
 * Everything is generated from seeded PRNG, so a failing run is reproducible.
 */

/** Mulberry32. Deterministic, so "person 400 in book 3" is the same every run. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = "Aarav Aisha Alex Amara Andre Anika Arjun Ayaan Beatriz Ben Caleb Camila Carlos Chen Chloe Daniel Dev Diego Elena Eli Emma Ethan Fatima Felix Gabe Grace Hannah Hassan Ines Isabel Jack Jae Jamal Jasmine Javier Jia Jonas Jordan Jose Julia Kai Karim Kate Kenji Khalid Lars Laura Leila Leo Lin Liam Lucia Luis Maya Mark Marta Mateo Mei Mia Miguel Mina Nadia Nina Noah Nour Olga Omar Oscar Paulo Pedro Priya Rafael Ravi Reza Rohan Rosa Ruby Sagar Samir Sara Shirley Simon Sofia Sun Tara Ted Theo Tomas Uma Victor Wei Yara Yuki Zain Zara Zoe".split(" ");
const LAST = "Adeyemi Ahmed Alvarez Andersen Bakshi Barros Bennett Bhatt Brooks Cardoso Castro Chandra Chavez Chen Cohen Costa Diaz Dubois Eriksen Farah Ferreira Fischer Gallo Garcia Gupta Hansen Haddad Ibrahim Ito Iyer Jensen Johansson Kaplan Karim Khan Kim Kowalski Kumar Lam Larsen Lee Lima Lindqvist Lopez Lynn Mahmoud Marchetti Mehta Mendes Moreau Nakamura Nasser Navarro Nguyen Novak Okafor Oliveira Park Patel Pereira Petrov Qureshi Ramos Rao Reyes Rivera Rossi Ruiz Saito Salazar Santos Sato Schneider Shah Silva Singh Sokolov Sousa Suzuki Tanaka Torres Tran Vargas Vasquez Wang Weber Wu Yamada Yilmaz Zhang Zhao".split(" ");

/** Labels people type into a contact NAME. Not a vocabulary the code reads -- fixture data. */
const TAGLINES = ["USC", "BTG", "Plumber", "Dentist", "Gym", "Landlord", "Uber", "Realtor", "Hinge", "Work", "Kappa Sig", "Tepper", "Barry's", "Vet", "CPA", "Movers"];

const COMPANIES = ["Stripe", "Anthropic", "Snap", "Riot Games", "Kaiser Permanente", "Deloitte", "Blue Modern Advisory", "SpaceX", "Netflix", "Sweetgreen", "Cedars-Sinai", "Warner Bros", "Chipotle", "Fidelity", "Boeing"];
const TITLES = ["Software Engineer", "Nurse Practitioner", "Attorney", "Orthodontist", "Account Executive", "Product Manager", "Physical Therapist", "Realtor", "Line Cook", "Teacher", "Data Analyst", "Podcast Producer", "Plumber", "Recruiter", "Anesthesiologist"];

/** Real NANP area codes, so metroOf() has something true to resolve. */
const AREA = {
  "Los Angeles": ["213", "310", "323", "424", "562", "626", "818"],
  "New York": ["212", "347", "646", "718", "917", "929"],
  Chicago: ["312", "630", "708", "773", "847"],
  "San Francisco": ["415", "510", "650", "628"],
  Houston: ["281", "713", "832"],
};
const METROS = Object.keys(AREA);

/** Note text that reads like a person wrote it in the Notes field of a card. */
function noteFor(r, name, metro) {
  const bits = [
    `met at the ${metro} office`,
    `${name.split(" ")[0]}'s wife is a ${pick(r, TITLES).toLowerCase()}`,
    `roommate from sophomore year`,
    `intro'd by ${pick(r, FIRST)}`,
    `works in tech, was at ${pick(r, COMPANIES)} before`,
    `does not text back, call instead`,
    `plays pickup at the ${metro} rec center`,
    `knows everyone in ${metro} real estate`,
    `USC alum, class of ${2008 + Math.floor(r() * 14)}`,
    `owns the coffee place on 3rd`,
    `hiring for a ${pick(r, TITLES).toLowerCase()} role`,
    `has two kids, birthday party in ${pick(r, ["March", "July", "October"])}`,
  ];
  const n = 1 + Math.floor(r() * 2);
  const out = [];
  for (let i = 0; i < n; i++) out.push(pick(r, bits));
  return [...new Set(out)].join(". ");
}

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

function phoneIn(r, metro) {
  const ac = pick(r, AREA[metro]);
  return `+1${ac}${String(2000000 + Math.floor(r() * 7999999)).slice(0, 7)}`;
}

/**
 * One book. `p` is the profile: which fields exist at all, and how often.
 *
 * Every rate is a probability, not a count, because a real book is not evenly
 * distributed and a fixture that is even hides the sparse cases.
 */
function buildBook(profile, seed) {
  const r = rng(seed);
  const out = [];
  for (let i = 0; i < profile.count; i++) {
    const metro = profile.metros ? pick(r, profile.metros) : pick(r, METROS);
    const first = pick(r, FIRST);
    const last = pick(r, LAST);

    // The tagline goes in the NAME, the way people actually do it: "Shirley Park USC".
    const tagline = r() < profile.taglineRate ? pick(r, TAGLINES) : null;
    let fullName = `${first} ${last}`;
    if (tagline) fullName = `${fullName} ${tagline}`;
    if (profile.nameOnlyGarbage && r() < 0.06) fullName = first; // one-word cards exist
    if (profile.nameOnlyGarbage && r() < 0.03) fullName = `${first} ${last} ${pick(r, TAGLINES)} ${pick(r, TAGLINES)}`;

    const rec = {
      externalId: `${profile.key}:${i}`,
      name: fullName,
      firstName: first,
      lastName: last,
      source: profile.source,
    };

    if (r() < profile.phoneRate) {
      rec.phoneNumbers = [phoneIn(r, metro)];
      if (r() < 0.12) rec.phoneNumbers.push(phoneIn(r, metro));
    }
    if (profile.internationalRate && r() < profile.internationalRate) {
      rec.phoneNumbers = [`+44${String(7000000000 + Math.floor(r() * 999999999))}`];
    }
    if (r() < profile.emailRate) rec.emails = [`${first}.${last}@${pick(r, ["gmail.com", "icloud.com", "outlook.com", "hey.com"])}`.toLowerCase()];
    if (r() < profile.companyRate) {
      rec.company = pick(r, COMPANIES);
      if (r() < 0.7) rec.title = pick(r, TITLES);
      if (r() < 0.25) rec.department = pick(r, ["Engineering", "Sales", "Clinical", "Legal", "Marketing"]);
    }
    if (r() < profile.cityRate) {
      rec.city = metro;
      rec.region = { "Los Angeles": "CA", "New York": "NY", Chicago: "IL", "San Francisco": "CA", Houston: "TX" }[metro];
    }
    if (r() < profile.noteRate) rec.notes = noteFor(r, fullName, metro);
    if (r() < profile.birthdayRate) {
      const m = 1 + Math.floor(r() * 12);
      const d = 1 + Math.floor(r() * 28);
      rec.birthday = `${1975 + Math.floor(r() * 30)}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
    if (r() < 0.05) rec.nickname = first.slice(0, 3);
    out.push(rec);
  }

  // Duplicate pairs: the same person entered twice, the second card sparser.
  const dupes = Math.round(profile.count * (profile.dupeRate || 0));
  for (let i = 0; i < dupes; i++) {
    const src = out[Math.floor(r() * Math.min(out.length, profile.count))];
    if (!src) continue;
    out.push({
      externalId: `${profile.key}:dup:${i}`,
      name: src.name.split(" ").slice(0, 2).join(" "),
      firstName: src.firstName,
      lastName: src.lastName,
      source: profile.source,
      ...(r() < 0.6 && src.phoneNumbers ? { phoneNumbers: [src.phoneNumbers[0]] } : {}),
      ...(r() < 0.4 ? { emails: [`${src.firstName}${i}@gmail.com`.toLowerCase()] } : {}),
    });
  }
  return out;
}

/**
 * THE TEN. Each one is a real complaint or a real absence, not a variation.
 * `expect` is what a person with THAT book should be able to get an answer to --
 * it is the assertion, and it is deliberately not the same for every book.
 */
export const PROFILES = [
  {
    key: "caleb",
    label: "1,179 Apple contacts, ~30 USC taglines, notes on a third — the tester whose queries all failed",
    count: 1179, source: "apple_contacts",
    phoneRate: 0.97, emailRate: 0.18, companyRate: 0.08, cityRate: 0.05,
    noteRate: 0.34, birthdayRate: 0.07, taglineRate: 0.09, dupeRate: 0.04,
    nameOnlyGarbage: true,
  },
  {
    key: "brandnew",
    label: "brand-new user: 1,000 phone contacts, ZERO notes, no companies, no cities",
    count: 1000, source: "apple_contacts",
    phoneRate: 0.99, emailRate: 0.06, companyRate: 0.0, cityRate: 0.0,
    noteRate: 0.0, birthdayRate: 0.03, taglineRate: 0.05, dupeRate: 0.03,
  },
  {
    key: "cofounder",
    label: "the cofounder: notes on nearly every one of 2,000 cards",
    count: 1400, source: "apple_contacts",
    phoneRate: 0.95, emailRate: 0.4, companyRate: 0.3, cityRate: 0.2,
    noteRate: 0.92, birthdayRate: 0.2, taglineRate: 0.14, dupeRate: 0.02,
  },
  {
    key: "gmail",
    label: "Google contacts export: emails only, almost no phone numbers",
    count: 1100, source: "google_contacts",
    phoneRate: 0.08, emailRate: 0.99, companyRate: 0.22, cityRate: 0.03,
    noteRate: 0.05, birthdayRate: 0.02, taglineRate: 0.03, dupeRate: 0.05,
  },
  {
    key: "intl",
    label: "non-US book: area codes resolve to nothing at all",
    count: 900, source: "apple_contacts",
    phoneRate: 0.98, emailRate: 0.3, companyRate: 0.1, cityRate: 0.04,
    noteRate: 0.15, birthdayRate: 0.05, taglineRate: 0.07, dupeRate: 0.03,
    internationalRate: 0.94,
  },
  {
    key: "coldstart",
    label: "true cold start: 12 contacts, one note",
    count: 12, source: "apple_contacts",
    phoneRate: 1.0, emailRate: 0.2, companyRate: 0.1, cityRate: 0.0,
    noteRate: 0.08, birthdayRate: 0.0, taglineRate: 0.16, dupeRate: 0,
  },
  {
    key: "namesonly",
    label: "names and nothing else: no phone, no email, no note",
    count: 800, source: "apple_contacts",
    phoneRate: 0.0, emailRate: 0.0, companyRate: 0.0, cityRate: 0.0,
    noteRate: 0.0, birthdayRate: 0.0, taglineRate: 0.11, dupeRate: 0.02,
  },
  {
    key: "linkedin",
    label: "professional book: company and title on almost everyone, no notes",
    count: 1200, source: "csv_import",
    phoneRate: 0.35, emailRate: 0.85, companyRate: 0.94, cityRate: 0.55,
    noteRate: 0.02, birthdayRate: 0.01, taglineRate: 0.02, dupeRate: 0.06,
  },
  {
    key: "dupes",
    label: "duplicate-heavy: a fifth of the book is the same people twice",
    count: 950, source: "apple_contacts",
    phoneRate: 0.9, emailRate: 0.25, companyRate: 0.12, cityRate: 0.08,
    noteRate: 0.2, birthdayRate: 0.06, taglineRate: 0.1, dupeRate: 0.2,
    nameOnlyGarbage: true,
  },
  {
    key: "messy",
    label: "messy real book: everything a little bit, nothing reliably",
    count: 1050, source: "apple_contacts",
    phoneRate: 0.72, emailRate: 0.31, companyRate: 0.14, cityRate: 0.09,
    noteRate: 0.11, birthdayRate: 0.04, taglineRate: 0.12, dupeRate: 0.07,
    nameOnlyGarbage: true,
  },
];

export function bookFor(profile, seedBase = 7) {
  const seed = seedBase * 1000 + profile.key.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return buildBook(profile, seed);
}
