/**
 * TEN MOCK USERS, TEN DIFFERENT ADDRESS BOOKS, A REAL POSTGRES.
 *
 * "Can you audit and make sure that other users will also be able to get the
 *  same experience that I'm getting? Can you do a mock user and go through the
 *  full flow and run through everything yourself, pretending to be a mock user,
 *  and see if you run into any issues? ... make up a mock 1,000 contact dataset
 *  with some with notes and some without notes, pretty sparse. Then you just go
 *  through a bunch of scenarios ... Do that for 10 people."
 *
 * Every migration applied to an empty database, ten books seeded through the
 * REAL sync path (upsertContactsForOwner -> storeAppleCardDetails ->
 * retagAddressBook), then every book asked the questions real testers asked,
 * through the REAL retrieval path (gatherEverything).
 *
 * NO FAKES ANYWHERE, AND THAT IS THE ENTIRE POINT. sql-fake.js pattern-matches
 * SQL instead of parsing it: it does not model CTEs, unnest, array containment,
 * window functions or EXTRACT. So the unit suite was green, on 1,263 tests,
 * while three things were true of every fresh database:
 *
 *   1. migration 041 could not be applied at all -- EXTRACT on a timestamptz is
 *      STABLE, so Postgres refuses it in an index expression;
 *   2. the contacts upsert could not insert a single row, because the UNIQUE
 *      index its ON CONFLICT clause names is not created by any live migration
 *      (see 20260909_042);
 *   3. storeAppleCardDetails wrote nothing for anybody, because a backtick in a
 *      comment had truncated its statement (see sql-template-integrity.test.js).
 *
 * All three are invisible to a fake and instant against a real engine.
 *
 * ── HOW TO RUN ──────────────────────────────────────────────────────────────
 *
 *   initdb -U postgres -A trust -D /tmp/amberpg
 *   pg_ctl -D /tmp/amberpg -l /tmp/pg.log -o "-p 5433 -k /tmp" start
 *   createdb -h /tmp -p 5433 -U postgres amber
 *   for f in db/migrations/*.sql; do psql -h /tmp -p 5433 -U postgres -d amber \
 *     -v ON_ERROR_STOP=1 -q -f "$f" || echo "MIGRATION FAILED: $f"; done
 *   SMOKE_PGHOST=/tmp SMOKE_PGPORT=5433 IDENTITY_KEY_PEPPER=$(openssl rand -hex 24) \
 *     node scripts/smoke-real-postgres.mjs
 *
 * It NEVER reaches production: the pool is built here, by hand, from
 * SMOKE_PG* variables only, and handed to __injectPoolForSmokeTests. There is
 * no code path by which an AMBER_SQL_* variable can influence it.
 */
import pg from "pg";
import { __injectPoolForSmokeTests } from "../src/db/sql.js";

if (!process.env.IDENTITY_KEY_PEPPER) {
  // The sync hashes identity keys, so it cannot run without one. Any value
  // works here; it must NOT be the production pepper.
  console.error("Set IDENTITY_KEY_PEPPER (any 32+ chars) -- see the header of this file.");
  process.exit(2);
}

const pool = new pg.Pool({
  host: process.env.SMOKE_PGHOST || "/tmp",
  port: Number(process.env.SMOKE_PGPORT || 5433),
  user: process.env.SMOKE_PGUSER || "postgres",
  database: process.env.SMOKE_PGDATABASE || "amber",
  max: 8,
});
__injectPoolForSmokeTests(pool);

const { upsertContactsForOwner, listContactsForOwnerAppShape } = await import("../src/db/store.js");
const { storeAppleCardDetails, retagAddressBook } = await import("../src/db/address-book-store.js");
const { gatherEverything } = await import("../src/db/gather.js");
const { normalizeIncomingContact } = await import("../src/routes/profile.js");
const { PROFILES, bookFor } = await import("./smoke-mock-books.mjs");

/**
 * THE QUESTIONS. Every one of these is a real question a real tester typed and
 * got "I don't have any information" back for.
 */
const QUERIES = [
  "Who do I know that goes to USC?",
  "Who do I know in my contacts?",
  "How many people do I know?",
  "Do I know anyone in New York?",
  "Whose birthday is it today?",
  "Who in my contacts has worked at a tech company?",
  "Do you know anything about any of my contacts?",
  "Do I know any lawyers?",
  "anyone in podcasting?",
  "who works at Stripe",
  "Do I know anyone in Los Angeles?",
  "What do you know about my roommate?",
  "who do I know that is a plumber",
  "anyone who went to grad school",
];

const CHUNK = 200; // the iOS client batches at 200; sync the same way it does

function line(...a) {
  process.stdout.write(a.join(" ") + "\n");
}

async function seedOwner(profile) {
  const phone = `+1555${String(1000000 + PROFILES.indexOf(profile) * 111).slice(0, 7)}`;
  const u = await pool.query(
    `INSERT INTO users (phone, full_name, status) VALUES ($1, $2, 'active')
     ON CONFLICT (phone) DO UPDATE SET full_name = EXCLUDED.full_name
     RETURNING amber_id`,
    [phone, `Mock ${profile.key}`],
  );
  const ownerId = u.rows[0].amber_id;

  const raw = bookFor(profile);
  const valid = [];
  for (const c of raw) {
    const n = normalizeIncomingContact(c);
    if (n) valid.push(n);
  }

  const t0 = Date.now();
  let upserted = 0;
  let failed = 0;
  const failures = [];
  for (let i = 0; i < valid.length; i += CHUNK) {
    const batch = valid.slice(i, i + CHUNK);
    const res = await upsertContactsForOwner({
      ownerId,
      ownerPhone: phone,
      contacts: batch,
      mode: "three_way",
    });
    upserted += res.upserted || 0;
    failed += res.failed || 0;
    for (const f of res.failures || []) failures.push(f);
  }
  const details = await storeAppleCardDetails(ownerId, valid);
  const retagged = await retagAddressBook(ownerId);
  const ms = Date.now() - t0;

  const counts = await pool.query(
    `SELECT count(*) AS total,
            count(phone_primary) AS with_phone,
            count(emails) AS with_email,
            count(company) AS with_company,
            count(NULLIF(apple_notes, '')) AS with_note,
            count(birthday) AS with_birthday,
            count(area_metro) AS with_metro,
            count(*) FILTER (WHERE contact_tags IS NOT NULL AND cardinality(contact_tags) > 0) AS with_tags
       FROM contacts WHERE owner_id = $1 AND deleted_at IS NULL`,
    [ownerId],
  );

  return {
    ownerId, phone, profile,
    sent: valid.length, dropped: raw.length - valid.length,
    upserted, failed, failures: failures.slice(0, 6), details,
    retagged, ms, db: counts.rows[0],
  };
}

// ── seed ────────────────────────────────────────────────────────────────────
line("=".repeat(78));
line("SEEDING TEN BOOKS THROUGH THE REAL SYNC PATH");
line("=".repeat(78));

const owners = [];
for (const p of PROFILES) {
  const o = await seedOwner(p);
  owners.push(o);
  const d = o.db;
  line(
    `\n[${p.key}] ${p.label}` +
      `\n   sent=${o.sent} dropped=${o.dropped} upserted=${o.upserted} failed=${o.failed} in ${o.ms}ms` +
      `\n   in db: total=${d.total} phone=${d.with_phone} email=${d.with_email} company=${d.with_company}` +
      ` note=${d.with_note} bday=${d.with_birthday} metro=${d.with_metro} tags=${d.with_tags}` +
      `\n   details_written=${o.details} retag_scanned=${o.retagged.scanned} retag_changed=${o.retagged.changed}`,
  );
  if (o.failures.length) line(`   FAILURES: ${o.failures.map((f) => `${f.name}: ${f.reason}`).join(" | ")}`);
}

// ── query ───────────────────────────────────────────────────────────────────
line("\n" + "=".repeat(78));
line("QUERYING EVERY BOOK THROUGH gatherEverything()");
line("=".repeat(78));

const problems = [];

for (const o of owners) {
  line(`\n${"-".repeat(78)}\n### ${o.profile.key} — ${o.db.total} contacts\n${"-".repeat(78)}`);
  for (const q of QUERIES) {
    let g;
    const t0 = Date.now();
    try {
      g = await gatherEverything(o.ownerId, q);
    } catch (err) {
      problems.push({ owner: o.profile.key, q, kind: "THREW", detail: err?.message });
      line(`  ✖ THREW  "${q}" -> ${err?.message}`);
      continue;
    }
    const ms = Date.now() - t0;
    const L = g.layers;
    const inv = g.inventory;
    const total = L.stated.length + L.labeled.length + L.implied.length;
    const bd = g.birthdays == null ? "-" : String(g.birthdays.length);
    const shape = g.shape ? `${g.shape.total}c/${(g.shape.tags || []).length}tags/${(g.shape.metros || []).length}metros` : "NO SHAPE";
    // • answered from the layers   ▣ answered from the shape   ○ genuinely thin
    const mark = total > 0 ? "\u2022" : g.aboutTheBook ? "\u25a3" : inv.thin ? "\u25cb" : "?";
    const cap = (n, t) => (t > n ? `${n}/${t}` : String(n));
    line(
      `  ${mark} ${String(ms).padStart(4)}ms  stated=${cap(L.stated.length, g.totals.stated).padStart(6)}` +
        ` labeled=${cap(L.labeled.length, g.totals.labeled).padStart(6)} implied=${cap(L.implied.length, g.totals.implied).padStart(6)}` +
        ` bday=${bd.padStart(2)} thin=${inv.thin ? "Y" : "n"}  shape=${shape}  "${q}"`,
    );
    if (g.aboutTheBook && total === 0) {
      const s2 = g.shape;
      line(
        `       shape answers it: ${s2.total} contacts, ${s2.withSyncedNote} with synced notes,` +
          ` ${s2.withBirthday} birthdays | labels: ${(s2.tags || []).slice(0, 3).map((t) => `${t.tag}(${t.count})`).join(" ")}` +
          ` | metros: ${(s2.metros || []).slice(0, 3).map((m) => `${m.metro}(${m.count})`).join(" ")}` +
          ` | titles: ${(s2.titles || []).slice(0, 3).map((t) => `${t.title}(${t.count})`).join(" ")}`,
      );
    }
    // A question that matched nothing but sits next to job titles the user
    // synced is the "any lawyers?" case: report what IS there.
    if (total === 0 && !g.aboutTheBook && (g.shape?.titles || []).length > 0) {
      line(`       nothing matched; book holds titles: ${g.shape.titles.slice(0, 5).map((t) => `${t.title}(${t.count})`).join(" ")}`);
    }
    // Show what a layer actually matched, for the first hit, so this is
    // reviewable rather than a count.
    const sample = L.stated[0] || L.labeled[0] || L.implied[0];
    if (sample) {
      const ex = sample.excerpts?.[0] || (sample.tags ? `tags=[${sample.tags}]` : "") || (sample.metro ? `${sample.areaCode}->${sample.metro}` : "");
      line(`       e.g. ${sample.name} ${sample.where ? `(${sample.where})` : ""} ${String(ex).slice(0, 90)}`);
    }
    if (!g.shape) problems.push({ owner: o.profile.key, q, kind: "NO SHAPE", detail: "bookShape returned null" });
    if (ms > 1500) problems.push({ owner: o.profile.key, q, kind: "SLOW", detail: `${ms}ms` });
  }
}

// ── the name a person actually reads ───────────────────────────────────────
//
// People write annotations into the name field, so "Shirley Park USC" is what is
// stored. The list endpoint has to show "Shirley Park" and hand back "USC"
// separately -- and it has to do it without ever changing full_name, because
// that is what the user typed.
//
// Checked here rather than against sql-fake.js on purpose: this needs the whole
// book in one query to build the name corpus, which is exactly the shape a fake
// does not model, and a fake is what hid every other bug this script found.
line("\n" + "=".repeat(78));
line("THE NAME SHOWN vs THE NAME STORED");
line("=".repeat(78));

for (const o of owners) {
  const t0 = Date.now();
  const list = await listContactsForOwnerAppShape(o.ownerId);
  const ms = Date.now() - t0;
  const labeled = list.filter((c) => c.tags?.length > 0);

  if (list.length !== Number(o.db.total)) {
    problems.push({
      owner: o.profile.key, q: "listContactsForOwnerAppShape",
      kind: "COUNT", detail: `returned ${list.length}, database holds ${o.db.total}`,
    });
  }
  // NOBODY MAY LOSE THEIR NAME. A split that returns nothing must fall back, or
  // the contact list renders blank rows -- worse than the annotation it removed.
  const nameless = list.filter((c) => !c.name || !String(c.name).trim());
  if (nameless.length > 0) {
    problems.push({
      owner: o.profile.key, q: "listContactsForOwnerAppShape",
      kind: "NO NAME", detail: `${nameless.length} contact(s) came back with no name at all`,
    });
  }
  // And the annotation must still be reachable, not deleted.
  const droppedLabel = list.filter(
    (c) => c.tags?.length > 0 && !c.tags.every((t) => String(t).trim().length > 0),
  );
  if (droppedLabel.length > 0) {
    problems.push({
      owner: o.profile.key, q: "listContactsForOwnerAppShape",
      kind: "BLANK TAG", detail: `${droppedLabel.length} contact(s) carry an empty label`,
    });
  }
  if (ms > 1500) {
    problems.push({ owner: o.profile.key, q: "listContactsForOwnerAppShape", kind: "SLOW", detail: `${ms}ms` });
  }

  line(`\n  [${o.profile.key}] ${list.length} contacts in ${ms}ms, ${labeled.length} carrying a label`);
  for (const c of labeled.slice(0, 3)) {
    const raw = await pool.query(`SELECT full_name FROM contacts WHERE id = $1`, [c.id]);
    line(
      `     stored ${JSON.stringify(raw.rows[0]?.full_name ?? null).padEnd(32)}` +
        ` shown ${JSON.stringify(c.name).padEnd(26)} tags ${JSON.stringify(c.tags)}`,
    );
  }
  if (labeled.length === 0) line("     (no annotated names in this book)");
}

// ── report ──────────────────────────────────────────────────────────────────
line("\n" + "=".repeat(78));
line("PROBLEMS");
line("=".repeat(78));
if (problems.length === 0) line("none");
for (const p of problems) line(`  ${p.kind.padEnd(9)} [${p.owner}] "${p.q}" ${p.detail}`);

await pool.end();
