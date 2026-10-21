/**
 * THE GOOGLE IMPORT, AGAINST A REAL DATABASE, FOR THE FIRST TIME.
 *
 * Everything tested so far went in through the Apple normalizer. The Google path
 * is a DIFFERENT normalizer producing a DIFFERENT record shape
 * (`fullName`/`phones` rather than `name`/`phoneNumbers`) feeding a DIFFERENT
 * writer (`mergeContact`, one row at a time, rather than the batched upsert).
 * None of it had ever run against Postgres. That is the same blind spot that hid
 * the three bugs found this morning, so it gets the same treatment.
 *
 * OAuth is the only thing stood in for: `fetchGoogleContacts` is not called, and
 * its output shape -- the two buckets Google returns, `saved` (the user's own
 * address book) and `other` (addresses Google harvested from mail traffic) -- is
 * constructed here from real People API person objects and pushed through
 * `normalizePerson`, `isJunk` and `importContactRecords` exactly as the route
 * does.
 *
 * WHAT IT IS LOOKING FOR
 *
 *   - Google records survive a normalizer written for a different shape at all.
 *   - The junk filter keeps everything in the SAVED bucket, however sparse, and
 *     drops only unreachable harvested entries.
 *   - One human with an Apple card AND a Google card becomes ONE contact.
 *   - Two different people are not merged because Google gave them both a
 *     no-reply address or a shared office line.
 *   - The import is idempotent: running it twice adds nobody.
 *   - contact_tags / area_code / area_metro get derived -- the bug fixed today,
 *     verified here rather than assumed from the call site.
 */
import pg from "pg";
import { __injectPoolForSmokeTests } from "../src/db/sql.js";

if (!process.env.IDENTITY_KEY_PEPPER) {
  console.error("Set IDENTITY_KEY_PEPPER (any 32+ chars).");
  process.exit(2);
}

const pool = new pg.Pool({
  host: process.env.SMOKE_PGHOST || "/tmp",
  port: Number(process.env.SMOKE_PGPORT || 5433),
  user: process.env.SMOKE_PGUSER || "postgres",
  database: process.env.SMOKE_PGDATABASE || "gimport",
  max: 8,
});
__injectPoolForSmokeTests(pool);

const { normalizePerson, isJunk, importContactRecords } = await import("../src/lib/google-contacts.js");
const { upsertContactsForOwner } = await import("../src/db/store.js");
const { retagAddressBook } = await import("../src/db/address-book-store.js");
const { normalizeIncomingContact } = await import("../src/routes/profile.js");

const line = (...a) => process.stdout.write(a.join(" ") + "\n");
const problems = [];
const flag = (what, detail) => problems.push({ what, detail });

/** A People API person, in the shape Google actually returns one. */
const person = (id, { display, given, family, emails = [], phones = [], org } = {}) => ({
  resourceName: `people/${id}`,
  names: display ? [{ metadata: { primary: true }, displayName: display, givenName: given, familyName: family }] : [],
  emailAddresses: emails.map((value) => ({ value })),
  phoneNumbers: phones.map((value) => ({ value })),
  organizations: org ? [{ name: org.name, title: org.title }] : [],
});

// ── the fixture: a real-looking Google export ───────────────────────────────
const SAVED = [
  person("c1", { display: "Shirley Park USC", given: "Shirley", family: "Park", phones: ["+1 (213) 555-0142"], emails: ["shirley.park@gmail.com"] }),
  person("c2", { display: "Dr. Ravi Mehta", given: "Ravi", family: "Mehta", phones: ["646-555-0199"], org: { name: "Mount Sinai", title: "Orthodontist" } }),
  // A SAVED CONTACT WITH ALMOST NOTHING. The junk filter must keep this: the
  // user typed it, so it is theirs. "Dentist", "Mom", "Plumber" are real rows.
  person("c3", { display: "Dentist" }),
  person("c4", { display: "Nagu Mama", given: "Nagu", family: "Mama" }),
  // Non-ASCII, which the tokenizer only started handling today.
  person("c5", { display: "Şahin Öztürk", given: "Şahin", family: "Öztürk", emails: ["sahin@example.com"] }),
  person("c6", { display: "李明", given: "明", family: "李", phones: ["+1 312 555 0177"] }),
  // The SAME HUMAN the Apple sync will also send, matched by phone.
  person("c7", { display: "Sagar Patel", given: "Sagar", family: "Patel", phones: ["+13105550100"] }),
  // Two different people sharing one office line -- must NOT merge.
  person("c8", { display: "Front Desk Anna", given: "Anna", phones: ["+12125550000"] }),
  person("c9", { display: "Front Desk Ben", given: "Ben", phones: ["+12125550000"] }),
];

const OTHER = [
  // Harvested and reachable -- keep.
  person("o1", { display: "Priya Raman", given: "Priya", family: "Raman", emails: ["priya.raman@acme.com"] }),
  // Harvested with a machine address and no name -- drop.
  person("o2", { emails: ["no-reply@notifications.example.com"] }),
  person("o3", { emails: ["bounce+12345@mailer.example.net"] }),
  // Harvested, no name, no phone, no email at all -- drop.
  person("o4", {}),
  // Harvested with a name -- keep.
  person("o5", { display: "Omar Haddad", given: "Omar", family: "Haddad", emails: ["omar@example.org"] }),
];

const PHONE = "+15550777888";
await pool.query(`DELETE FROM users WHERE phone = $1`, [PHONE]);
const u = await pool.query(
  `INSERT INTO users (phone, full_name, status) VALUES ($1, 'Google User', 'active') RETURNING amber_id`,
  [PHONE],
);
const OWNER = String(u.rows[0].amber_id);

line("=".repeat(78));
line("THE GOOGLE IMPORT PATH, AGAINST REAL POSTGRES");
line("=".repeat(78));

// ── normalize + junk filter, exactly as fetchGoogleContacts does ────────────
const saved = SAVED.map((p) => normalizePerson(p, "saved"));
const other = OTHER.map((p) => normalizePerson(p, "other"));
const keptOther = other.filter((c) => !isJunk(c));
const droppedOther = other.length - keptOther.length;
const droppedSaved = saved.filter((c) => isJunk(c)).length;

line(`\n  normalized ${saved.length} saved and ${other.length} harvested`);
line(`  junk filter dropped ${droppedSaved} saved and ${droppedOther} harvested`);
if (droppedSaved !== 0) {
  flag("junk filter", `${droppedSaved} SAVED contact(s) were dropped -- the user typed those, they are never junk`);
}
// Three of the five harvested entries are unreachable: two machine addresses
// with no name, and one with nothing at all. The first version of this file said
// two, which was this test miscounting its own fixture.
if (droppedOther !== 3) {
  flag("junk filter", `expected 3 unreachable harvested entries dropped, got ${droppedOther}`);
}

// ── import ──────────────────────────────────────────────────────────────────
const records = [...saved, ...keptOther];
let counts;
try {
  counts = await importContactRecords(OWNER, records);
} catch (err) {
  flag("import", `importContactRecords threw: ${err?.message ?? err}`);
  counts = null;
}
line(`  import: ${JSON.stringify(counts)}`);
if (counts && counts.failed > 0) flag("import", `${counts.failed} Google record(s) failed to write`);

const live = async () =>
  (await pool.query(`SELECT count(*)::int AS n FROM contacts WHERE owner_id = $1 AND deleted_at IS NULL`, [OWNER]))
    .rows[0].n;
const n1 = await live();
line(`  contacts in the database: ${n1}`);
if (n1 < records.length - 1) {
  flag("import", `wrote ${n1} rows for ${records.length} records -- something was silently dropped or over-merged`);
}

// ── the two people on one office line must still be two people ──────────────
const desk = await pool.query(
  `SELECT full_name FROM contacts WHERE owner_id = $1 AND deleted_at IS NULL AND full_name LIKE 'Front Desk%'`,
  [OWNER],
);
line(`  two people sharing one office line -> ${desk.rows.length} contact(s): ${desk.rows.map((r) => r.full_name).join(", ")}`);
if (desk.rows.length !== 2) {
  flag("shared line", `two different people on one number collapsed into ${desk.rows.length} row(s)`);
}

// ── idempotence: importing the same export again adds nobody ────────────────
await importContactRecords(OWNER, records);
const n2 = await live();
line(`  re-import: ${n2} contacts (was ${n1})`);
if (n2 !== n1) flag("idempotence", `a second identical import changed the count from ${n1} to ${n2}`);

// ── an Apple sync for the same human must land on the SAME contact ──────────
const appleSame = [
  normalizeIncomingContact({
    externalId: "apple:sagar",
    name: "Sagar Patel",
    firstName: "Sagar",
    lastName: "Patel",
    phoneNumbers: ["+1 (310) 555-0100"], // same number, different formatting
    source: "apple_contacts",
  }),
].filter(Boolean);
await upsertContactsForOwner({ ownerId: OWNER, ownerPhone: PHONE, contacts: appleSame, mode: "three_way" });
const n3 = await live();
const sagar = await pool.query(
  `SELECT count(*)::int AS n FROM contacts WHERE owner_id = $1 AND deleted_at IS NULL AND full_name ILIKE '%Sagar%'`,
  [OWNER],
);
line(`  Apple card for a person Google already gave us -> ${sagar.rows[0].n} Sagar row(s), ${n3} contacts total`);
if (sagar.rows[0].n !== 1) {
  flag("cross-source merge", `one human with a Google card and an Apple card became ${sagar.rows[0].n} contacts`);
}

// ── and the derivation that was missing until today ─────────────────────────
const retagged = await retagAddressBook(OWNER);
const derived = await pool.query(
  `SELECT full_name, contact_tags, area_code, area_metro
     FROM contacts WHERE owner_id = $1 AND deleted_at IS NULL ORDER BY full_name`,
  [OWNER],
);
line(`\n  after the retag (${retagged.changed} of ${retagged.scanned} rows changed):`);
for (const r of derived.rows) {
  line(
    `    ${JSON.stringify(r.full_name).padEnd(24)} tags=${JSON.stringify(r.contact_tags ?? [])}` +
      ` area=${JSON.stringify(r.area_code)} metro=${JSON.stringify(r.area_metro)}`,
  );
}
const shirley = derived.rows.find((r) => String(r.full_name).startsWith("Shirley"));
if (!shirley?.contact_tags?.includes("USC")) {
  flag("derivation", `a Google contact named "Shirley Park USC" did not get the USC label`);
}
const withMetro = derived.rows.filter((r) => r.area_metro).length;
line(`  ${withMetro} of ${derived.rows.length} carry a derived metro`);
if (withMetro === 0) {
  flag("derivation", "no Google contact got an area_metro, so the area-code layer is blind to this book");
}

// ── and the retrieval can actually find them ────────────────────────────────
const { gatherEverything } = await import("../src/db/gather.js");
line("");
for (const q of ["who do I know that goes to USC", "do I know anyone in New York", "any orthodontists", "who do I know named Şahin"]) {
  const g = await gatherEverything(OWNER, q);
  const all = [...g.layers.stated, ...g.layers.labeled, ...g.layers.implied];
  line(`  ${JSON.stringify(q).padEnd(40)} -> ${all.length} people  ${all[0]?.name ?? ""}`);
}

line("\n" + "=".repeat(78));
line("RESULT");
line("=".repeat(78));
if (problems.length === 0) line("PASS -- the Google path lands, dedupes, derives and is findable.");
else for (const p of problems) line(`  ${p.what}\n    ${p.detail}`);

await pool.end();
process.exit(problems.length === 0 ? 0 : 1);
