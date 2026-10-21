/**
 * A HUNDRED AND FIFTY BOOKS, DESIGNED TO BREAK THIS CODE.
 *
 * "Dont make the tests something you can pass inherently. Write difficult mock
 *  scenarios that are designed to find edge cases and fails so you can expose
 *  your own code and make fixes. Be very very critical."
 *
 * So the data here is hostile on purpose and the assertions are invariants that
 * can actually come out false. Nothing in this file restates what the code does.
 *
 * ── WHAT IS HOSTILE ABOUT THE DATA ─────────────────────────────────────────
 *
 *   Regex metacharacters in names        "Bob (Bobby) Smith [work] *|+"
 *   SQL in names                          "Robert'); DROP TABLE contacts;--"
 *   500-character names, 1-character names, names that are only punctuation
 *   Emoji, CJK, RTL Arabic, combining diacritics, zero-width joiners
 *   Contacts with 20 phone numbers, and contacts with nothing but a name
 *   Names that are ONLY a tagline           "USC USC USC"
 *   THE SAME PHONE NUMBERS AND THE SAME NAMES REUSED ACROSS DIFFERENT OWNERS,
 *   which is the setup for the single most important assertion in the file.
 *
 * ── THE ASSERTION THAT MATTERS MOST ────────────────────────────────────────
 *
 * Every contact id any layer returns is checked against the database to confirm
 * it belongs to the owner who asked. With 150 owners deliberately sharing phone
 * numbers and names, a single missing `owner_id` in a WHERE clause shows up here
 * as one person reading another person's address book. That cannot be caught by
 * a fixture with one owner in it, which is how a bug like that survives.
 *
 * ── HOW TO RUN ─────────────────────────────────────────────────────────────
 *
 *   initdb -U postgres -A trust -D /tmp/amberpg
 *   pg_ctl -D /tmp/amberpg -l /tmp/pg.log -o "-p 5433 -k /tmp" start
 *   createdb -h /tmp -p 5433 -U postgres fleet
 *   for f in db/migrations/*.sql; do psql -h /tmp -p 5433 -U postgres -d fleet \
 *     -v ON_ERROR_STOP=1 -q -f "$f" || echo "MIGRATION FAILED: $f"; done
 *   SMOKE_PGDATABASE=fleet SMOKE_PGHOST=/tmp SMOKE_PGPORT=5433 \
 *     IDENTITY_KEY_PEPPER=$(openssl rand -hex 24) \
 *     node scripts/adversarial-fleet.mjs
 *
 * Env knobs: FLEET_OWNERS (default 150), FLEET_MIN_CONTACTS (default 500),
 * FLEET_SEED (default 1) so a failure is reproducible exactly.
 */
import pg from "pg";
import { __injectPoolForSmokeTests } from "../src/db/sql.js";

if (!process.env.IDENTITY_KEY_PEPPER) {
  console.error("Set IDENTITY_KEY_PEPPER (any 32+ chars). See the header.");
  process.exit(2);
}

const OWNERS = Number(process.env.FLEET_OWNERS || 150);
const MIN_CONTACTS = Number(process.env.FLEET_MIN_CONTACTS || 500);
const SEED = Number(process.env.FLEET_SEED || 1);

const pool = new pg.Pool({
  host: process.env.SMOKE_PGHOST || "/tmp",
  port: Number(process.env.SMOKE_PGPORT || 5433),
  user: process.env.SMOKE_PGUSER || "postgres",
  database: process.env.SMOKE_PGDATABASE || "fleet",
  max: Number(process.env.SMOKE_POOL_MAX || 16),
});
__injectPoolForSmokeTests(pool);

const { upsertContactsForOwner, listContactsForOwnerAppShape } = await import("../src/db/store.js");
const { storeAppleCardDetails, retagAddressBook } = await import("../src/db/address-book-store.js");
const { gatherEverything } = await import("../src/db/gather.js");
const { normalizeIncomingContact } = await import("../src/routes/profile.js");

const line = (...a) => process.stdout.write(a.join(" ") + "\n");
const pctl = (a, p) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : 0);

function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];

// ── FAILURES ────────────────────────────────────────────────────────────────
const failures = [];
const fail = (kind, detail, ctx = {}) => failures.push({ kind, detail, ...ctx });

// ── HOSTILE NAME MATERIAL ───────────────────────────────────────────────────
//
// Each of these is a real shape that has broken something somewhere: a regex
// built from user text, a name split, a display path, a JSON encoder.
const NASTY_NAMES = [
  "Bob (Bobby) Smith [work] *|+",           // regex metacharacters, every kind
  "Robert'); DROP TABLE contacts;--",         // SQL, in a name
  "a|b|.*|(((",                               // an alternation that would break a bad regex
  "%_\\\\ Wildcard Person",                    // LIKE wildcards and a backslash
  "李明",                                      // CJK, no spaces, two chars
  "محمد عبد الله",                             // RTL
  "Müller-Lüdenscheidt Ægir Þórsdóttir",      // diacritics and non-ASCII letters
  "Ｆｕｌｌｗｉｄｔｈ Ｎａｍｅ",                 // fullwidth forms
  "🎉 Party Planner 🎊",                       // emoji only + words
  "🙂",                                        // a name that is one emoji
  "...",                                       // only punctuation
  "-",                                         // a single separator
  "'",                                         // a single apostrophe
  "USC USC USC",                               // nothing but a tagline, three times
  "Jr",                                        // nothing but name furniture
  "de la",                                     // nothing but joiners
  "A",                                         // one character
  "  Padded   Spaces  ",                       // leading/trailing/inner whitespace
  "Zero​Width​Joined",               // zero-width spaces inside
  "Combininǵ Diacritic̈",           // combining marks
  "X".repeat(500),                             // a 500-character single token
  ("Long Name ".repeat(50)).trim(),            // a 500-character multi-token name
  "NULL",
  "undefined",
  "null null",
  "0",
  "Şahin Öztürk",
  "O'Brien-Smith Jr. III, PhD",
  "Contact With\nNewline",
  "Tab\tSeparated Name",
];

const FIRST = "Maya Dev Nina Arjun Shirley Ravi Sagar Caleb Priya Omar Will May Art Rose Grant Mark Park Chen Kim Lee".split(" ");
const LAST = "Park Kumar Chen Lopez Okafor Silva Tanaka Weber Nguyen Patel Cohen Ibrahim Rossi Novak Diaz Sato".split(" ");
const TAGS = ["USC", "BTG", "Plumber", "Dentist", "Kappa Sig", "Barry's", "Tepper", "Realtor", "Vet", "CPA", "Landlord"];
const COMPANIES = ["Stripe", "Anthropic", "Kaiser Permanente", "Deloitte", "Blue Modern Advisory", "C++ Systems", "AT&T", "Yahoo!"];
const TITLES = ["Attorney", "Software Engineer", "Nurse Practitioner", "Podcast Producer", "Orthodontist", "VP of Engineering", "Plumber"];
const AREA = {
  "Los Angeles": ["213", "310", "323", "424", "562", "626", "818"],
  "New York": ["212", "347", "646", "718", "917", "929"],
  Chicago: ["312", "630", "708", "773", "847"],
  "San Francisco": ["415", "510", "650", "628"],
  Houston: ["281", "713", "832"],
};
const METROS = Object.keys(AREA);

// SHARED IDENTIFIERS ACROSS OWNERS. The cross-owner leak detector needs these:
// if two owners hold the same phone and the same name, a query that forgets
// `owner_id` returns the wrong person and the assertion below sees it.
const SHARED_PHONES = Array.from({ length: 40 }, (_, i) => `+1213555${String(1000 + i).padStart(4, "0")}`);
const SHARED_NAMES = ["Shirley Park USC", "Sagar Patel", "Caleb Newton", "Maya Chen BTG", "Mark Lynn"];

function bookFor(ownerIndex) {
  const r = rng(SEED * 100003 + ownerIndex * 7919);
  // Deliberately uneven: a couple of huge books, a couple of nearly empty ones,
  // and the rest in between. "Works the same for a 10-year user" is only
  // testable if both extremes are present in the same run.
  let count = MIN_CONTACTS + Math.floor(r() * 400);
  if (ownerIndex === 0) count = 4000;            // the ten-year book
  if (ownerIndex === 1) count = 3000;
  if (ownerIndex === 2) count = 1;               // one single contact
  if (ownerIndex === 3) count = 2;
  const sparse = ownerIndex % 7 === 0;           // a fifth of owners have almost no detail
  const out = [];

  for (let i = 0; i < count; i++) {
    // 8% of every book is hostile material.
    const nasty = r() < 0.08;
    let name;
    if (nasty) name = pick(r, NASTY_NAMES);
    else if (r() < 0.05) name = pick(r, SHARED_NAMES); // reused across owners on purpose
    else {
      // A DISTINCT SURNAME PER CONTACT, and this is not cosmetic.
      //
      // The first version of this fixture drew every name from 20 first names
      // and 16 surnames -- 320 combinations -- and gave owner 0 a SPARSE book:
      // 4,000 contacts with no phone, no email, nothing but a name. The
      // identity resolver correctly collapsed same-source, same-name cards with
      // no corroborating signal, and 4,000 contacts became 788. The test passed,
      // because it only compared the contact list against the database and the
      // two agreed with each other.
      //
      // That is a fixture that tests the deduper instead of the retrieval, and
      // hides four fifths of the book while doing it. Real collisions still
      // exist below, deliberately and in known quantity; the bulk is unique.
      name = `${pick(r, FIRST)} ${pick(r, LAST)}${i % 3 === 0 ? "" : `-${i.toString(36)}`}`;
      if (r() < 0.12) name += ` ${pick(r, TAGS)}`;
    }

    const metro = pick(r, METROS);
    const rec = { externalId: `o${ownerIndex}:c${i}`, name, source: "apple_contacts" };

    // A shared phone for 3% of rows, so owners genuinely collide on identifiers.
    if (r() < 0.03) rec.phoneNumbers = [pick(r, SHARED_PHONES)];
    else if (!sparse && r() < 0.9) {
      rec.phoneNumbers = [`+1${pick(r, AREA[metro])}${String(2000000 + Math.floor(r() * 7999999)).slice(0, 7)}`];
      // One contact in every few hundred carries twenty numbers.
      if (r() < 0.004) {
        rec.phoneNumbers = Array.from(
          { length: 20 },
          () => `+1${pick(r, AREA[metro])}${String(2000000 + Math.floor(r() * 7999999)).slice(0, 7)}`,
        );
      }
    }
    if (!sparse && r() < 0.3) rec.emails = [`u${i}.o${ownerIndex}@example.com`];
    if (!sparse && r() < 0.12) {
      rec.company = pick(r, COMPANIES);
      rec.title = pick(r, TITLES);
    }
    if (!sparse && r() < 0.08) {
      rec.city = metro;
      rec.region = { "Los Angeles": "CA", "New York": "NY", Chicago: "IL", "San Francisco": "CA", Houston: "TX" }[metro];
    }
    if (!sparse && r() < 0.25) {
      rec.notes = pick(r, [
        `works in tech, was at ${pick(r, COMPANIES)} before`,
        `met at the ${metro} office, knows everyone in real estate`,
        `USC alum, class of ${2005 + Math.floor(r() * 18)}`,
        `her sister is an ${pick(r, TITLES).toLowerCase()} in ${metro}`,
        `roommate from sophomore year`,
        `C++ and Rust, hiring for a VP of Engineering role`,
        `don't call after 9, text only`,
      ]);
    }
    if (r() < 0.06) {
      const m = 1 + Math.floor(r() * 12);
      const d = 1 + Math.floor(r() * 28);
      rec.birthday = `${1970 + Math.floor(r() * 40)}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
    out.push(rec);
  }
  return out;
}

// ── THE QUERIES. Twenty-five, and most are trying to break something. ──────
const LONG_PASTE =
  "I was thinking about the meeting yesterday and all the people who were there and " +
  "what they said about the roadmap and the hiring plan and ".repeat(14);

const QUERIES = [
  // 1-2: the shapes he named
  { q: "tell me about my network and who is all in NYC working in tech", why: "his own example, two asks in one" },
  {
    q: "find me VPs of engineering in New York, tell me who I already know there, recommend a coffee shop near Union Square, whose birthday is coming up, and draft an intro to the best one",
    why: "five asks: web people, own network, places, dates, drafting",
  },
  // 3-8: injection and metacharacters
  { q: "who do I know at C++ (the language) [seriously]?", why: "regex metacharacters in the question" },
  { q: "who do I know'); DROP TABLE contacts;--", why: "SQL injection through the question" },
  { q: "a|b|.*|(((", why: "an alternation that breaks a naively built regex" },
  { q: "%_\\ who has a wildcard", why: "LIKE wildcards and a backslash" },
  { q: "'; SELECT * FROM users; --", why: "second injection shape" },
  { q: "$1 $2 ${terms} {{name}}", why: "placeholder syntax, in case anything interpolates" },
  // 9-13: degenerate input
  { q: "", why: "empty string" },
  { q: "   \t\n  ", why: "whitespace only" },
  { q: "?", why: "one character" },
  { q: "who do I know about the thing", why: "nothing but stopwords" },
  { q: LONG_PASTE, why: "a 2,000-character paste" },
  // 14-18: unicode and script
  { q: "who do I know 🇯🇵 in 東京", why: "emoji and CJK" },
  { q: "من أعرف في نيويورك", why: "RTL Arabic" },
  { q: "wer kennt Müller-Lüdenscheidt", why: "diacritics" },
  { q: "X".repeat(120), why: "one 120-character word" },
  { q: "🙂🙂🙂", why: "emoji only" },
  // 19-25: real questions with sharp edges
  { q: "do I know anyone called Will or May or Art", why: "names that are also common words" },
  { q: "who's at Barry's? and o'brien?", why: "apostrophes" },
  { q: "anyone in bio-tech or e-commerce", why: "hyphenated compounds" },
  { q: "WHO DO I KNOW THAT GOES TO usc", why: "case chaos against a stored uppercase tag" },
  { q: "any lawyers, doctors, dentists, plumbers, or orthodontists", why: "five plurals at once" },
  { q: "who do I know named Park", why: "a term that is a surname, not a tag" },
  { q: "how many people do I know", why: "the book itself, no terms at all" },
];

// ── SEED ────────────────────────────────────────────────────────────────────
line("=".repeat(78));
line(`SEEDING ${OWNERS} OWNERS, >=${MIN_CONTACTS} CONTACTS EACH, THROUGH THE REAL SYNC PATH`);
line("=".repeat(78));

const owners = [];
const seedStart = Date.now();
for (let i = 0; i < OWNERS; i++) {
  const phone = `+1888${String(1000000 + i).slice(0, 7)}`;
  const u = await pool.query(
    `INSERT INTO users (phone, full_name, status) VALUES ($1, $2, 'active')
     ON CONFLICT (phone) DO UPDATE SET full_name = EXCLUDED.full_name RETURNING amber_id`,
    [phone, `Fleet ${i}`],
  );
  const ownerId = u.rows[0].amber_id;

  const raw = bookFor(i);
  const valid = [];
  for (const c of raw) {
    const n = normalizeIncomingContact(c);
    if (n) valid.push(n);
  }

  let upserted = 0;
  let failed = 0;
  const firstFailures = [];
  for (let k = 0; k < valid.length; k += 200) {
    const res = await upsertContactsForOwner({
      ownerId, ownerPhone: phone, contacts: valid.slice(k, k + 200), mode: "three_way",
    });
    upserted += res.upserted || 0;
    failed += res.failed || 0;
    for (const f of res.failures || []) if (firstFailures.length < 3) firstFailures.push(f);
  }
  if (failed > 0) {
    fail("UPSERT FAILED", `${failed} of ${valid.length} contacts did not write: ` +
      firstFailures.map((f) => `${JSON.stringify(f.name)}: ${f.reason}`).join(" | "), { owner: i });
  }
  await storeAppleCardDetails(ownerId, valid);
  await retagAddressBook(ownerId);

  // WHAT THE USER HAS TOLD AMBER, which the first version of this file never
  // seeded at all -- so the STRONGEST layer read an empty table for every one
  // of 250 queries and the p50 came out at 5ms instead of the ~50ms a real book
  // costs. A fleet test that leaves the primary evidence source empty is
  // measuring the wrong thing quickly.
  //
  // Two thirds of owners get facts, at varying density, so both "a decade of
  // notes" and "nothing yet" are present in one run.
  if (i % 3 !== 0) {
    const perContact = i % 9 === 1 ? 5 : 1;
    await pool.query(
      `INSERT INTO observations (owner_id, contact_id, kind, body, observed_at, status, source)
       SELECT $1, c.id, 'fact',
              (ARRAY[
                'went to USC, class of 2014',
                'lives in New York now, moved from Chicago',
                'works in tech, hiring for a VP of Engineering role',
                'her sister is an attorney in Los Angeles',
                'said not to call after 9, text only'
              ])[1 + ((n + length(c.full_name)) % 5)],
              now() - (n || ' days')::interval, 'resolved', 'manual'
         FROM contacts c, generate_series(1, $2::int) AS n
        WHERE c.owner_id = $1 AND c.deleted_at IS NULL`,
      [ownerId, perContact],
    );
  }

  const n = await pool.query(
    `SELECT count(*)::int AS n FROM contacts WHERE owner_id = $1 AND deleted_at IS NULL`, [ownerId],
  );
  const live = n.rows[0].n;
  // A BOOK MAY NOT QUIETLY LOSE MOST OF ITSELF.
  //
  // Merging genuine duplicates is the job; turning 4,000 cards into 788 is a
  // book the user cannot find their people in. The threshold is deliberately
  // generous -- this fixture still plants real collisions -- but it is an
  // assertion, so the next time a dedup change starts eating address books this
  // says so instead of agreeing with itself.
  if (valid.length >= 50 && live < valid.length * 0.6) {
    fail(
      "BOOK COLLAPSED",
      `sent ${valid.length} cards and ${live} contacts survived (${Math.round((100 * live) / valid.length)}%)`,
      { owner: i },
    );
  }
  owners.push({ i, ownerId, phone, sent: valid.length, dropped: raw.length - valid.length, live });
  if (i % 25 === 0 || i === OWNERS - 1) {
    line(`  owner ${String(i).padStart(3)}  sent=${String(valid.length).padStart(4)} live=${String(live).padStart(4)}  (${Math.round((Date.now() - seedStart) / 1000)}s elapsed)`);
  }
}
const totals = await pool.query(`SELECT count(*)::int AS n FROM contacts WHERE deleted_at IS NULL`);
line(`\nseeded ${owners.length} owners, ${totals.rows[0].n} live contacts, in ${Math.round((Date.now() - seedStart) / 1000)}s`);

// Every live contact id, mapped to its owner. This is the ground truth the
// cross-owner assertion is checked against, read once rather than per query.
line("building the id -> owner map for the leak check...");
const ownerOf = new Map();
{
  const res = await pool.query(`SELECT id, owner_id FROM contacts WHERE deleted_at IS NULL`);
  for (const row of res.rows) ownerOf.set(String(row.id), String(row.owner_id));
}
line(`  ${ownerOf.size} contact ids mapped`);

// ── QUERY EVERY BOOK ────────────────────────────────────────────────────────
line("\n" + "=".repeat(78));
line(`ASKING ${OWNERS} OWNERS ${QUERIES.length} QUESTIONS EACH = ${OWNERS * QUERIES.length} QUERIES`);
line("=".repeat(78));

const CAP = 25; // MAX_PER_LAYER in db/gather.js
const latencies = [];
let answered = 0;
let thinCount = 0;
const queryStart = Date.now();

// PER QUESTION, NOT JUST IN AGGREGATE.
//
// "returned people 70 of 250" told me nothing about WHICH questions never work.
// A question that comes back empty for all 150 owners is a finding -- the
// retrieval is missing a whole shape of question -- and it is completely
// invisible in a total. So every question keeps its own scoreboard.
const perQuery = new Map(QUERIES.map(({ q, why }) => [q, { why, hit: 0, thin: 0, book: 0, ms: [], sample: null }]));

for (const o of owners) {
  const liveForOwner = await pool.query(
    `SELECT count(*)::int AS n FROM contacts WHERE owner_id = $1 AND deleted_at IS NULL`, [o.ownerId],
  );
  const liveN = liveForOwner.rows[0].n;

  for (const { q, why } of QUERIES) {
    const ctx = { owner: o.i, query: JSON.stringify(q).slice(0, 60), why };
    let g;
    const t0 = process.hrtime.bigint();
    try {
      g = await gatherEverything(o.ownerId, q);
    } catch (err) {
      fail("THREW", err?.message ?? String(err), ctx);
      continue;
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    latencies.push(ms);

    // A. THE CONTRACT IS ALWAYS THE CONTRACT, whatever the input.
    if (!g || !g.layers || !g.inventory || !g.totals) {
      fail("SHAPE", "gatherEverything returned something that is not the contract", ctx);
      continue;
    }
    for (const k of ["stated", "labeled", "implied"]) {
      if (!Array.isArray(g.layers[k])) fail("SHAPE", `layers.${k} is not an array`, ctx);
    }

    const all = [...g.layers.stated, ...g.layers.labeled, ...g.layers.implied];

    // B. NOBODY EVER SEES ANOTHER PERSON'S CONTACT. The one that matters most.
    for (const row of all) {
      const real = ownerOf.get(String(row.contactId));
      if (real === undefined) {
        fail("PHANTOM", `returned contact ${row.contactId} that is not a live row`, ctx);
      } else if (real !== String(o.ownerId)) {
        fail("CROSS-OWNER LEAK", `owner ${o.i} was handed contact ${row.contactId}, which belongs to another owner`, ctx);
      }
    }

    // C. The shape must describe THIS book, not the table.
    if (g.shape && g.shape.total !== liveN) {
      fail("SHAPE COUNT", `shape.total=${g.shape.total} but the database holds ${liveN} for this owner`, ctx);
    }

    // D. One person is never listed twice across layers.
    const ids = all.map((r) => String(r.contactId));
    if (new Set(ids).size !== ids.length) {
      fail("DUPLICATE", "the same contact appears in more than one layer", ctx);
    }

    // E. The cap is a cap, and a total is never smaller than what it counted.
    for (const k of ["stated", "labeled", "implied"]) {
      if (g.layers[k].length > CAP) fail("CAP", `layers.${k} returned ${g.layers[k].length} > ${CAP}`, ctx);
      if (g.totals[k] < g.layers[k].length) {
        fail("TOTAL", `totals.${k}=${g.totals[k]} is less than the ${g.layers[k].length} rows returned`, ctx);
      }
    }

    // F. `thin` means "looked for something specific and did not find it".
    const strong = g.layers.stated.length + g.layers.labeled.length;
    if (strong > 0 && g.inventory.thin) {
      fail("THIN", `thin=true while holding ${strong} strong-layer rows`, ctx);
    }
    if (g.aboutTheBook && g.inventory.thin) {
      fail("THIN", "thin=true on a question the shape answers in full", ctx);
    }

    // G. Nobody is returned without a name to show.
    for (const row of all) {
      if (!row.name || !String(row.name).trim()) {
        fail("NAMELESS", `contact ${row.contactId} came back with no name`, ctx);
      }
    }

    // H. Terms are bounded no matter what was pasted in.
    if (g.terms.length > 12) fail("TERMS", `${g.terms.length} terms from one question`, ctx);

    const score = perQuery.get(q);
    score.ms.push(ms);
    if (all.length > 0) {
      score.hit++;
      if (!score.sample) {
        const r0 = all[0];
        score.sample = `${r0.name}${r0.where ? ` [${r0.where}]` : ""}${r0.matched?.length ? ` [tagged ${r0.matched.join(",")}]` : ""}${r0.metro ? ` [${r0.areaCode}->${r0.metro}]` : ""}`;
      }
    }
    if (g.inventory.thin) score.thin++;
    if (g.aboutTheBook) score.book++;

    if (all.length > 0) answered++;
    if (g.inventory.thin) thinCount++;
  }
  if (o.i % 25 === 0) {
    line(`  ...owner ${String(o.i).padStart(3)} done, ${latencies.length} queries run, ${failures.length} failure(s) so far (${Math.round((Date.now() - queryStart) / 1000)}s)`);
  }
}

// ── THE DISPLAY NAME, ACROSS EVERY BOOK ─────────────────────────────────────
line("\n" + "=".repeat(78));
line("THE CONTACT LIST, FOR EVERY OWNER");
line("=".repeat(78));
let listChecked = 0;
for (const o of owners) {
  let list;
  try {
    list = await listContactsForOwnerAppShape(o.ownerId);
  } catch (err) {
    fail("LIST THREW", err?.message ?? String(err), { owner: o.i });
    continue;
  }
  listChecked++;
  if (list.length !== o.live) {
    fail("LIST COUNT", `returned ${list.length}, database holds ${o.live}`, { owner: o.i });
  }
  for (const c of list) {
    if (!c.name || !String(c.name).trim()) {
      fail("LIST NAMELESS", `contact ${c.id} renders with no name`, { owner: o.i });
    }
    if (ownerOf.get(String(c.id)) !== String(o.ownerId)) {
      fail("LIST CROSS-OWNER LEAK", `contact ${c.id} is not this owner's`, { owner: o.i });
    }
    // The annotation must be removed from the name AND still reachable.
    for (const t of c.tags ?? []) {
      if (!String(t).trim()) fail("LIST BLANK TAG", `contact ${c.id} carries an empty label`, { owner: o.i });
    }
  }
}
line(`  ${listChecked} contact lists rendered and checked`);

// ── WHICH QUESTIONS ACTUALLY WORK ───────────────────────────────────────────
line("\n" + "=".repeat(78));
line("EVERY QUESTION, AND HOW MANY OF THE " + owners.length + " BOOKS IT REACHED");
line("=".repeat(78));
for (const [q, sc] of perQuery) {
  const label = q.length > 46 ? q.slice(0, 43).replace(/\s+$/, "") + "..." : q;
  const mark = sc.hit > 0 ? "\u2022" : sc.book === owners.length ? "\u25a3" : "\u25cb";
  line(
    `  ${mark} people ${String(sc.hit).padStart(3)}/${owners.length}` +
      `  thin ${String(sc.thin).padStart(3)}` +
      `  book ${String(sc.book).padStart(3)}` +
      `  p95 ${String(Math.round(pctl(sc.ms, 0.95))).padStart(4)}ms  ${JSON.stringify(label)}`,
  );
  if (sc.sample) line(`      e.g. ${String(sc.sample).slice(0, 96)}`);
  else line(`      no book answered this  (${sc.why})`);
}

// ── EVERYONE AT ONCE ────────────────────────────────────────────────────────
//
// Every measurement above is one owner at a time, which is not how a hundred
// thousand users behave. The pool is capped at 20 in production, and one turn is
// eight queries, so this is where saturation would show.
line("\n" + "=".repeat(78));
line("CONCURRENCY — N OWNERS ASKING AT THE SAME INSTANT");
line("=".repeat(78));
const HARD_ASKS = QUERIES.filter((x) => x.q.trim().length > 12).slice(0, 6).map((x) => x.q);
for (const n of [10, 50, 100, 150]) {
  if (n > owners.length) continue;
  const t0 = process.hrtime.bigint();
  const each = await Promise.all(
    Array.from({ length: n }, (_, k) => {
      const o = owners[k % owners.length];
      const q = HARD_ASKS[k % HARD_ASKS.length];
      const s0 = process.hrtime.bigint();
      return gatherEverything(o.ownerId, q)
        .then((g) => {
          // Under load the answer must still be the right owner's answer.
          for (const row of [...g.layers.stated, ...g.layers.labeled, ...g.layers.implied]) {
            if (ownerOf.get(String(row.contactId)) !== String(o.ownerId)) {
              fail("CROSS-OWNER LEAK UNDER LOAD", `at n=${n}, owner ${o.i} got contact ${row.contactId}`, { owner: o.i });
            }
          }
          return Number(process.hrtime.bigint() - s0) / 1e6;
        })
        .catch((err) => {
          fail("THREW UNDER LOAD", `at n=${n}: ${err?.message ?? err}`, { owner: o.i });
          return NaN;
        });
    }),
  );
  const wall = Number(process.hrtime.bigint() - t0) / 1e6;
  const ok = each.filter(Number.isFinite);
  line(
    `  ${String(n).padStart(3)} at once  wall ${String(Math.round(wall)).padStart(6)}ms` +
      `  per-turn p50 ${String(Math.round(pctl(ok, 0.5))).padStart(5)}ms` +
      `  p95 ${String(Math.round(pctl(ok, 0.95))).padStart(6)}ms` +
      `  failed ${each.length - ok.length}`,
  );
}

// ── REPORT ──────────────────────────────────────────────────────────────────
line("\n" + "=".repeat(78));
line("RESULT");
line("=".repeat(78));
line(`queries run        ${latencies.length}`);
line(`returned people    ${answered}`);
line(`thin (nothing hit) ${thinCount}`);
line(`latency            p50 ${Math.round(pctl(latencies, 0.5))}ms  p95 ${Math.round(pctl(latencies, 0.95))}ms  max ${Math.round(Math.max(...latencies))}ms`);
line(`contact lists       ${listChecked}`);
line("");

if (failures.length === 0) {
  line("PASS -- no invariant broken.");
} else {
  // Grouped, because one bug produces thousands of identical lines.
  const byKind = new Map();
  for (const f of failures) {
    const key = `${f.kind}`;
    if (!byKind.has(key)) byKind.set(key, []);
    byKind.get(key).push(f);
  }
  line(`FAIL -- ${failures.length} broken invariant(s), ${byKind.size} distinct kind(s):\n`);
  for (const [kind, list] of [...byKind.entries()].sort((a, b) => b[1].length - a[1].length)) {
    line(`  ${kind}  (${list.length})`);
    const seen = new Set();
    for (const f of list) {
      const k = f.detail.replace(/[0-9a-f-]{36}/g, "<id>").replace(/\d+/g, "N");
      if (seen.has(k)) continue;
      seen.add(k);
      line(`     owner ${f.owner}  ${f.query ?? ""}`);
      line(`       ${f.detail}`);
      if (f.why) line(`       (${f.why})`);
      if (seen.size >= 4) break;
    }
    line("");
  }
}

await pool.end();
process.exit(failures.length === 0 ? 0 : 1);
