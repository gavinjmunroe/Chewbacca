/**
 * A REALISTIC ADDRESS BOOK, NOT AN ADVERSARIAL ONE.
 *
 * The adversarial fixture (tab characters in names, full-width unicode, a bare
 * quote mark, every contact carrying the same five notes) did its job: it found
 * crashes and injection holes. It is useless for judging whether an ANSWER is
 * good, because every reply is about garbage and there is no way to tell a bad
 * answer from a faithful description of bad data. Two of the "defects" in the
 * live-model run turned out to be the fixture, not the app.
 *
 * So this builds a book that looks like a real person's: names that are names,
 * companies that exist, a long tail of people with nothing but a phone number,
 * notes on a minority rather than on everyone, duplicates of the kind phones
 * actually produce, and a planted cast the questions can be checked against.
 *
 * The distribution matters as much as the content. In a real book:
 *   - most contacts have a phone and nothing else
 *   - a small fraction have a company or title
 *   - a smaller fraction have anything the user actually wrote down
 *   - a handful of names repeat
 */

const FIRST = [
  "Ana", "Marcus", "Priya", "Daniel", "Leila", "Tom", "Yuki", "Hassan", "Grace",
  "Owen", "Mei", "Diego", "Ruth", "Sam", "Nadia", "Ben", "Ines", "Kwame",
  "Clara", "Raj", "Elena", "Josh", "Amara", "Peter", "Sofia", "Ravi", "Hana",
  "Luis", "Maya", "Ethan", "Zoe", "Omar", "Iris", "Caleb", "Nina", "Victor",
  "Lena", "Andre", "Rosa", "Simon", "Talia", "Jonas", "Kira", "Malik", "Freya",
  "Arjun", "Bea", "Noel", "Dara", "Emeka",
];
const LAST = [
  "Alvarez", "Bennett", "Cho", "Delgado", "Eriksen", "Farrell", "Gupta",
  "Hoffman", "Ibrahim", "Jensen", "Kaur", "Lindqvist", "Moreau", "Nakamura",
  "Okonkwo", "Petrov", "Quinn", "Ramirez", "Silva", "Tanaka", "Ueda", "Varga",
  "Whitfield", "Xu", "Yilmaz", "Zamora", "Brennan", "Castillo", "Duarte",
  "Fitzgerald", "Grant", "Haddad", "Ivanov", "Kellerman", "Larsen", "Mensah",
];
const COMPANIES = [
  ["Stripe", "tech"], ["Anthropic", "tech"], ["Datadog", "tech"],
  ["Figma", "tech"], ["Ramp", "tech"], ["Vercel", "tech"],
  ["Goldman Sachs", "finance"], ["Blackstone", "finance"], ["Citadel", "finance"],
  ["Bridgewater", "finance"], ["Evercore", "finance"],
  ["Mount Sinai", "healthcare"], ["Cedars-Sinai", "healthcare"],
  ["Kaiser Permanente", "healthcare"], ["Flatiron Health", "healthcare"],
  ["McKinsey", "consulting"], ["Bain", "consulting"], ["Deloitte", "consulting"],
  ["Ogilvy", "marketing"], ["Wieden+Kennedy", "marketing"],
  ["Cravath", "law"], ["Latham & Watkins", "law"],
  ["Sequoia", "investing"], ["a16z", "investing"], ["Union Square Ventures", "investing"],
];
const TITLES = {
  tech: ["Software Engineer", "Staff Engineer", "Engineering Manager", "VP of Engineering", "Product Manager", "Designer", "Data Scientist"],
  finance: ["Analyst", "Associate", "Vice President", "Managing Director", "Portfolio Manager"],
  healthcare: ["Nurse Practitioner", "Attending Physician", "Cardiologist", "Hospital Administrator", "Clinical Research Coordinator"],
  consulting: ["Consultant", "Engagement Manager", "Partner"],
  marketing: ["Brand Strategist", "Creative Director", "Marketing Manager"],
  law: ["Associate", "Partner", "Counsel"],
  investing: ["Investor", "Principal", "General Partner"],
};
// area code → the city the metro layer will infer, so location questions are checkable
const CITIES = [
  ["New York", "NY", "212"], ["New York", "NY", "646"], ["Brooklyn", "NY", "718"],
  ["Los Angeles", "CA", "213"], ["Los Angeles", "CA", "310"],
  ["San Francisco", "CA", "415"], ["Oakland", "CA", "510"],
  ["Chicago", "IL", "312"], ["Austin", "TX", "512"], ["Boston", "MA", "617"],
  ["Seattle", "WA", "206"], ["Miami", "FL", "305"], ["Denver", "CO", "303"],
];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {number} n how many contacts
 * @param {number} seed
 * @returns {{contacts: object[], index: Map<string, object>}}
 */
export function buildBook(n, seed = 7) {
  const rnd = mulberry32(seed);
  const pickOf = (arr) => arr[Math.floor(rnd() * arr.length)];
  const contacts = [];
  const usedPhones = new Set();
  const phoneIn = (area) => {
    for (;;) {
      const p = `+1${area}${String(Math.floor(rnd() * 9000000) + 1000000)}`;
      if (!usedPhones.has(p)) { usedPhones.add(p); return p; }
    }
  };

  for (let i = 0; i < n; i++) {
    const first = pickOf(FIRST);
    const last = pickOf(LAST);
    const [city, region, area] = pickOf(CITIES);
    const r = rnd();
    // THE LONG TAIL IS THE POINT. Most rows are a name and a number.
    const hasJob = r < 0.28;
    const hasCity = r < 0.18;
    const hasEmail = rnd() < 0.35;
    const hasNote = rnd() < 0.12;
    const [company, sector] = hasJob ? pickOf(COMPANIES) : [null, null];
    const title = hasJob ? pickOf(TITLES[sector]) : null;
    const c = {
      name: `${first} ${last}`,
      firstName: first,
      lastName: last,
      phoneNumbers: [phoneIn(area)],
      emails: hasEmail ? [`${first.toLowerCase()}.${last.toLowerCase()}${i}@example.com`] : [],
      company,
      title,
      city: hasCity ? city : null,
      region: hasCity ? region : null,
      source: "apple_contacts",
      externalId: `apple:gauntlet:${seed}:${i}`,
    };
    if (hasNote) {
      c.notes = pickOf([
        `met at a wedding in ${city}, has two kids`,
        `runs the ${pickOf(["Sunday", "Tuesday", "Thursday"])} climbing group`,
        `allergic to shellfish, do not book sushi`,
        `going through a divorce, be gentle`,
        `introduced me to ${pickOf(FIRST)}`,
        `${pickOf(["vegetarian", "gluten free", "does not drink"])}`,
        `wants to move into ${pickOf(["product", "design", "sales"])}`,
        `best reached on WhatsApp`,
      ]);
    }
    contacts.push(c);
  }

  // Duplicates of the kind a phone actually produces: same human, two cards,
  // one from a SIM import with only a number.
  for (let k = 0; k < Math.max(2, Math.floor(n * 0.01)); k++) {
    const src = contacts[Math.floor(rnd() * contacts.length)];
    contacts.push({
      name: src.name,
      firstName: src.firstName,
      lastName: src.lastName,
      phoneNumbers: [...src.phoneNumbers],
      emails: [],
      company: null, title: null, city: null, region: null,
      source: "apple_contacts",
      externalId: `apple:gauntlet:${seed}:dup:${k}`,
    });
  }
  return contacts;
}

/**
 * THE PLANTED CAST. Every question in the gauntlet can be checked against these,
 * because they are the only people whose attributes are known exactly.
 *
 * Includes the shapes that break things: two people who share a first name, a
 * person with an apostrophe, a person with a non-ASCII name, a person the user
 * will contradict themselves about mid-message, and a person who exists only in
 * an anecdote and must be CREATED by the capture rather than found.
 */
export const CAST = [
  {
    name: "Priya Raghunathan", firstName: "Priya", lastName: "Raghunathan",
    phoneNumbers: ["+12125550101"], emails: ["priya@flatironhealth.example"],
    company: "Flatiron Health", title: "Clinical Research Coordinator",
    city: "New York", region: "NY", source: "apple_contacts",
    externalId: "apple:cast:priya",
    notes: "oncology data, went to Michigan, keeps trying to get me to run the marathon",
  },
  {
    name: "Priya Sundaram", firstName: "Priya", lastName: "Sundaram",
    phoneNumbers: ["+13105550102"], emails: [],
    company: "Ramp", title: "Product Manager",
    city: "Los Angeles", region: "CA", source: "apple_contacts",
    externalId: "apple:cast:priya2",
    notes: "different Priya, the LA one, met through Marcus",
  },
  {
    name: "Marcus O'Dell", firstName: "Marcus", lastName: "O'Dell",
    phoneNumbers: ["+14155550103"], emails: ["marcus@sequoia.example"],
    company: "Sequoia", title: "Principal",
    city: "San Francisco", region: "CA", source: "apple_contacts",
    externalId: "apple:cast:marcus",
    notes: "invests in health infra, introduced me to Priya Sundaram",
  },
  {
    name: "Şirin Öztürk", firstName: "Şirin", lastName: "Öztürk",
    phoneNumbers: ["+16175550104"], emails: [],
    company: "Mount Sinai", title: "Attending Physician",
    city: "Boston", region: "MA", source: "apple_contacts",
    externalId: "apple:cast:sirin",
    notes: "cardiology, does the Boston hospital board thing",
  },
  {
    name: "Danielle Kwon", firstName: "Danielle", lastName: "Kwon",
    phoneNumbers: ["+12125550105"], emails: ["dkwon@cravath.example"],
    company: "Cravath", title: "Partner",
    city: "New York", region: "NY", source: "apple_contacts",
    externalId: "apple:cast:danielle",
    notes: "healthcare M&A, birthday in September, hates being called Dani",
  },
  {
    name: "Tobias Lindqvist", firstName: "Tobias", lastName: "Lindqvist",
    phoneNumbers: ["+15125550106"], emails: [],
    company: "Vercel", title: "VP of Engineering",
    city: "Austin", region: "TX", source: "apple_contacts",
    externalId: "apple:cast:tobias",
    notes: "hiring two staff engineers, said to ping him in the spring",
  },
  {
    // NO JOB, NO CITY, JUST A NUMBER. The most common kind of contact, and the
    // one the answers keep forgetting exists.
    name: "Hana Yilmaz", firstName: "Hana", lastName: "Yilmaz",
    phoneNumbers: ["+13125550107"], emails: [],
    company: null, title: null, city: null, region: null,
    source: "apple_contacts", externalId: "apple:cast:hana",
  },
];
