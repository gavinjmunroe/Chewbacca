/**
 * BACKFILL discovery_keys — so shares and circles actually reach the people they
 * were shared with.
 *
 *   railway run node scripts/backfill-discovery-keys.js              DRY RUN
 *   railway run node scripts/backfill-discovery-keys.js --apply      write
 *   railway run node scripts/backfill-discovery-keys.js --apply --limit 500
 *
 * DRY RUN BY DEFAULT. It writes only with --apply, because it writes to the one
 * globally-indexed identity table in the system.
 *
 * WHY IT IS NEEDED. VIEWER_REACH_SQL and the circles membership predicate both
 * resolve a viewer through discovery_keys -- deliberately, so that identity comes
 * from something the account proved rather than something a caller asserted. The
 * only writer is the signup path in store.js. So every account that existed
 * before that path ran has NO KEY, and both predicates fail closed for them:
 * they cannot see notes shared to their number, and they are not members of
 * circles they are in.
 *
 * Failing closed was the right call -- the alternative is showing somebody else's
 * notes -- but it is not a state to ship. This is the other half.
 *
 * FIRST CLAIM WINS, AND CONFLICTS ARE REPORTED. discovery_keys is
 * PRIMARY KEY (key_hash), and setDiscoveryKeys refuses a key another account
 * already holds rather than stealing it. In a backfill the order is arbitrary, so
 * a conflict here is not "somebody lost" -- it is TWO ACCOUNTS WHOSE NUMBERS
 * COLLIDE, and every one printed is worth a human looking at. Since phoneKey now
 * keeps the country code, a genuine collision means two accounts really do share
 * a number.
 *
 * IT USES THE SAME CODE PATH AS SIGNUP. setDiscoveryKeys and phoneHash, not a
 * second implementation -- a backfill that hashes differently from the live
 * writer produces keys that match nothing, which is worse than no backfill.
 *
 * SAFE TO RUN AGAIN. Re-claiming your own key is not a conflict.
 *
 * ---------------------------------------------------------------------------
 * IT HUNG, AND THE REASON WAS NOT IN THIS FILE. The first version of this script
 * printed its whole report and then never returned the prompt. The cause was in
 * src/db/sql.js: the Cloud SQL Connector schedules its certificate refresh with a
 * self-rescheduling, non-unref'd setTimeout, nothing held a reference to the
 * connector, and so nothing ever called connector.close(). pool.end() is not
 * enough. Every other real-database script in this directory happens to end in an
 * explicit process.exit(), which hid it; this one did not, so it was the one that
 * showed the bug. sql.js now owns and closes the connector, and this script also
 * exits explicitly -- a report-and-exit job should never depend on the event loop
 * happening to drain.
 *
 * THREE OTHER THINGS CHANGED, all of them about not looking hung:
 *
 *   THE DRY RUN NO LONGER ISSUES ONE QUERY PER ACCOUNT. It read discovery_keys
 *   once per user, serially, over the connector. That is one network round trip
 *   per account with no output between them. It is now a single batched read.
 *
 *   IT PRINTS BEFORE IT WORKS, AND WHILE IT WORKS. The header used to come after
 *   two queries, so a slow connection produced a blank terminal. --apply prints
 *   progress with a rate and an estimate, because writes must stay serial (see
 *   below) and serial work with no output is the thing that looks broken.
 *
 *   IT CHECKS ITS PRECONDITIONS FIRST. The pepper, and the shape of the database
 *   it was pointed at. Pointed at the OLD schema this used to fail somewhere in
 *   the middle; now it refuses up front and names the database.
 *
 * WHY --apply STAYS SERIAL. Concurrency here would make first-claim-wins depend
 * on scheduling, so which of two colliding accounts keeps its number would change
 * between runs. Slower and deterministic is the right trade for the table that
 * decides who can read whose notes.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const flag = (n) => { const i = argv.indexOf(n); return i === -1 ? null : argv[i + 1]; };
const LIMIT = Math.max(1, Math.min(Number(flag("--limit")) || 100000, 1000000));

// PRECONDITION ONE, BEFORE ANY CONNECTION. phoneHash throws on a missing or short
// pepper, and it throws on the first account rather than the zeroth -- which
// reads as "it got somewhere and then broke" instead of "it was never configured".
const pepper = process.env.IDENTITY_KEY_PEPPER;
if (typeof pepper !== "string" || pepper.length < 32) {
  console.error(
    `\n  IDENTITY_KEY_PEPPER is ${pepper ? `${pepper.length} characters` : "not set"}; ` +
    `hashing needs at least 32.\n\n` +
    `  Nothing was read and nothing was written. Every key this script writes is\n` +
    `  HMAC(pepper, number), so a run with the wrong pepper produces keys that\n` +
    `  match nothing and cannot be told apart from correct ones afterwards.\n`,
  );
  process.exit(2);
}

// Credentials before sql.js, same as every other script that reaches the real
// database. See scripts/script-hygiene-audit.mjs for why this is checked.
const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-discovery-backfill.json");
  fs.writeFileSync(tmp, credsJson, { mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

/**
 * A DSN PATH, FOR TESTING THIS SCRIPT WITHOUT PRODUCTION. Gated exactly like
 * scripts/smoke-db.mjs: SMOKE_DATABASE_URL must be set AND the target must carry
 * a smoke_marker table. Neither is true of production by accident, and the app's
 * own pool is never reachable this way.
 */
let query, closePool;
const dsn = process.env.SMOKE_DATABASE_URL || null;
if (dsn) {
  const pg = (await import("pg")).default;
  const pool = new pg.Pool({ connectionString: dsn, max: 2 });
  const { rows } = await pool.query(
    `SELECT current_database() AS db,
            to_regclass('public.smoke_marker') IS NOT NULL AS marked`);
  if (!rows[0].marked) {
    console.error(`\n  Refusing SMOKE_DATABASE_URL "${rows[0].db}": no smoke_marker table.\n`);
    await pool.end();
    process.exit(2);
  }
  // discovery-store.js imports sql.js directly, so pointing only this file at the
  // scratch DSN would send its own queries to the scratch database and
  // setDiscoveryKeys to the real one. The injection hook exists for exactly this
  // and carries the same two locks.
  const { __injectPoolForSmokeTests } = await import("../src/db/sql.js");
  __injectPoolForSmokeTests(pool);
  query = (t, p) => pool.query(t, p);
  closePool = () => pool.end();
} else {
  ({ query, closePool } = await import("../src/db/sql.js"));
}

const { setDiscoveryKeys } = await import("../src/db/discovery-store.js");
const { phoneHash } = await import("../src/lib/identity-keys.js");

const pad = (s, n) => String(s).padStart(n);
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;

let exitCode = 0;
try {
  const t0 = Date.now();

  // PRECONDITION TWO: is this the database this script was written for? Pointed
  // at the pre-rebuild schema, every column below is wrong, and finding that out
  // one query at a time is how a migration script eats an afternoon.
  const [{ db, has_users, has_dk, has_cik }] = (await query(
    `SELECT current_database()                       AS db,
            to_regclass('public.users')      IS NOT NULL AS has_users,
            to_regclass('public.discovery_keys') IS NOT NULL AS has_dk,
            to_regclass('public.contact_identity_keys') IS NOT NULL AS has_cik`,
  )).rows;

  console.log(`\n  ${APPLY ? "BACKFILL" : "DRY RUN"} — discovery_keys on "${db}"`);
  console.log(`  connected in ${secs(Date.now() - t0)}\n`);

  const missing = [
    !has_users && "users",
    !has_dk && "discovery_keys",
    !has_cik && "contact_identity_keys",
  ].filter(Boolean);
  if (missing.length) {
    console.error(`  ✗ "${db}" has no ${missing.join(", ")}. This is not the new schema.\n`);
    process.exit(2);
  }

  const { rows: shape } = await query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'
        AND column_name IN ('amber_id','phone','deleted_at','created_at')`,
  );
  if (shape.length !== 4) {
    const have = new Set(shape.map((r) => r.column_name));
    console.error(
      `  ✗ users on "${db}" is missing ` +
      `${["amber_id","phone","deleted_at","created_at"].filter((c) => !have.has(c)).join(", ")}.\n` +
      `    That is the pre-rebuild schema. Point this at the migrated database.\n`,
    );
    process.exit(2);
  }

  const t1 = Date.now();
  // Accounts with a phone. The key check is on the HASH rather than on amber_id:
  // an account can hold an email key and still be missing its phone one, and that
  // account is still unreachable by phone.
  const { rows: users } = await query(
    `SELECT amber_id, phone FROM users
      WHERE deleted_at IS NULL AND phone IS NOT NULL AND phone <> ''
      ORDER BY created_at ASC
      LIMIT $1`,
    [LIMIT],
  );
  const [{ before }] = (await query(
    `SELECT count(*)::int AS before FROM discovery_keys`)).rows;
  console.log(`  ${users.length} account(s) with a phone, read in ${secs(Date.now() - t1)}.`);
  console.log(`  ${before} key(s) already recorded.\n`);

  // Hash everything first, in memory. No database involved, so a bad pepper or an
  // unusable number surfaces before a single write.
  const hashed = [];
  let unhashable = 0;
  for (const u of users) {
    const h = phoneHash(u.phone);
    if (!h) { unhashable += 1; continue; }
    hashed.push({ amberId: String(u.amber_id), phone: u.phone, hash: h, hex: h.toString("hex") });
  }

  // ONE QUERY, NOT ONE PER ACCOUNT. This is the read that used to be a loop.
  const t2 = Date.now();
  const holders = new Map();
  if (hashed.length) {
    const { rows: held } = await query(
      `SELECT key_hash, amber_id FROM discovery_keys WHERE key_hash = ANY($1::bytea[])`,
      [hashed.map((h) => h.hash)],
    );
    for (const r of held) holders.set(r.key_hash.toString("hex"), String(r.amber_id));
  }
  console.log(`  checked ${hashed.length} hash(es) against discovery_keys in ${secs(Date.now() - t2)}.\n`);

  // A DRY RUN THAT CANNOT SEE ITS OWN COLLISIONS IS WORSE THAN NO DRY RUN. It
  // writes nothing, so the second account with a colliding number still reads the
  // table as empty and reports "would claim". The number a person needs before
  // deciding to --apply is exactly the conflict count, so the run tracks what it
  // would have taken as though it had taken it.
  const wouldHold = new Map();
  const todo = [];
  const conflicts = [];
  let already = 0;

  for (const h of hashed) {
    const holder = holders.get(h.hex) ?? wouldHold.get(h.hex) ?? null;
    if (holder === h.amberId) { already += 1; continue; }
    if (holder) { conflicts.push({ amberId: h.amberId, heldBy: holder, phone: h.phone }); continue; }
    wouldHold.set(h.hex, h.amberId);
    todo.push(h);
  }

  let claimed = 0;
  if (APPLY && todo.length) {
    console.log(`  claiming ${todo.length} key(s), one account at a time...\n`);
    const started = Date.now();
    for (let i = 0; i < todo.length; i++) {
      const h = todo[i];
      // setDiscoveryKeys answers a bare 0 when it declines before touching the
      // database -- a non-uuid amber_id, or no usable key. Reading .conflicts off
      // that is a TypeError, and a TypeError in a backfill loop is a half-finished
      // backfill, so the shape is checked rather than assumed.
      const res = await setDiscoveryKeys(h.amberId, { phones: [h.phone] });
      if (!res || typeof res !== "object") {
        conflicts.push({ amberId: h.amberId, heldBy: "refused-before-write", phone: h.phone });
      } else if (res.conflicts.length) {
        conflicts.push({ amberId: h.amberId, heldBy: "race", phone: h.phone });
      } else {
        claimed += 1;
      }
      const n = i + 1;
      if (n % 25 === 0 || n === todo.length) {
        const per = (Date.now() - started) / n;
        const left = Math.round((per * (todo.length - n)) / 1000);
        console.log(`    ${pad(n, 7)} / ${todo.length}   ${(per).toFixed(0)}ms each` +
                    (n === todo.length ? "" : `   ~${left}s left`));
      }
    }
    console.log("");
  }

  const [{ after }] = (await query(
    `SELECT count(*)::int AS after FROM discovery_keys`)).rows;

  console.log(`  ${"already held".padEnd(18, ".")} ${pad(already, 7)}`);
  console.log(`  ${(APPLY ? "claimed" : "would claim").padEnd(18, ".")} ${pad(APPLY ? claimed : todo.length, 7)}`);
  console.log(`  ${"unusable number".padEnd(18, ".")} ${pad(unhashable, 7)}   too short to identify a person`);
  console.log(`  ${"CONFLICTS".padEnd(18, ".")} ${pad(conflicts.length, 7)}`);
  console.log(`\n  discovery_keys: ${before} -> ${after}\n`);

  if (conflicts.length) {
    console.log(`  EVERY CONFLICT IS TWO ACCOUNTS WHOSE NUMBERS HASH THE SAME.\n` +
                `  Since phoneKey keeps the country code, that means they really do share\n` +
                `  a number -- a recycled line, a duplicate signup, or something worth\n` +
                `  knowing. Nothing was taken from anybody; the later account simply has\n` +
                `  no key. Move one deliberately with reassignDiscoveryKey().\n`);
    for (const c of conflicts.slice(0, 25)) {
      console.log(`    ${c.amberId}  (${c.phone})  collides with  ${c.heldBy}`);
    }
    if (conflicts.length > 25) console.log(`    ... and ${conflicts.length - 25} more`);
    console.log("");
  }

  // WHAT THE BACKFILL IS ACTUALLY FOR: contacts that can now be reached.
  const t3 = Date.now();
  const { rows: reach } = await query(
    `SELECT count(*)::int AS n FROM contacts c
      WHERE c.deleted_at IS NULL AND c.linked_amber_id IS NULL
        AND EXISTS (
          SELECT 1 FROM contact_identity_keys k
            JOIN discovery_keys d ON d.key_hash = k.key_hash
           WHERE k.owner_id = c.owner_id AND k.contact_id = c.id)`,
  );
  console.log(`  ${reach[0].n} contact card(s) now resolve to an account through a key\n` +
              `  without being linked yet -- these are the people who can suddenly see\n` +
              `  what was shared with them.  (${secs(Date.now() - t3)})\n`);

  if (!APPLY) {
    console.log(`  Nothing was written. Re-run with --apply.\n`);
  }
  console.log(`  done in ${secs(Date.now() - t0)}\n`);
} catch (err) {
  console.error("\n  ✗ backfill-discovery-keys failed:", err?.stack || err?.message || err, "\n");
  exitCode = 1;
} finally {
  await closePool().catch(() => {});
}

// EXIT EXPLICITLY. sql.js now closes the Cloud SQL connector, so the loop should
// drain on its own -- but a reporting job whose last line has printed has nothing
// left to wait for, and "finished, then sat there" is the failure this run was
// reported for. Belt and braces, on purpose.
process.exit(exitCode);
