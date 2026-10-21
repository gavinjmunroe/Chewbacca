/**
 * CUTOVER PLAN — the numbers that decide how the old data moves.
 *
 *   railway run node scripts/cutover-plan.js           the report
 *   railway run node scripts/cutover-plan.js --json    machine-readable
 *
 * READ-ONLY. Counts and catalog reads. Writes nothing, locks nothing worth the
 * name, and is safe against the live database -- which it has to be, because the
 * database it must describe is the live one.
 *
 * WHY A SECOND SURVEY. cutover-survey.js answers "what tables exist and which
 * columns changed shape". That was enough to see the size of the job and not
 * nearly enough to write it. This answers the four questions that actually
 * decide the migration, and every one of them is a question whose wrong answer
 * corrupts data silently rather than failing:
 *
 *   1. THE CONTACT ID REMAP. contacts.id is bigserial in the old schema and uuid
 *      in the new one. ELEVEN columns across TEN tables carry that id, and every
 *      one of them has to end up with the SAME uuid for the same old row or the
 *      graph tears: a favorite pointing at nobody, an identity key attached to
 *      the wrong person. This counts each of them and, more importantly, counts
 *      the rows that ALREADY point at a contact that does not exist.
 *
 *      SIX of the eleven are protected by a foreign key today and cannot be
 *      orphaned: circle_members, contact_facts, contact_identity_keys,
 *      contact_sources, and both columns of contact_review_candidates. The
 *      report marks them, because a zero there is a guarantee rather than a
 *      measurement. The other FIVE -- contact_embedding, contact_favorites,
 *      intro_requests, people_rank_feedback and voice_vocabulary -- have no
 *      constraint at all, and contact_favorites keeps the id as TEXT, so a
 *      non-numeric value is possible there and nothing has ever objected. Those
 *      five are where orphans can actually be, and the new schema's FKs will
 *      reject every one of them.
 *
 *   2. THE TEXT OWNER IDS. Eight tables store owner_id as text where the new
 *      schema wants uuid. A text column can hold anything, and a cast that fails
 *      on one row fails the whole statement. This counts how many parse as a uuid
 *      and how many do not, WITHOUT printing any of them: an owner_id that is not
 *      a uuid is quite possibly a phone number, and this report should not become
 *      a place where phone numbers are written down.
 *
 *   3. THE IDENTITY KEY COLLAPSE. Old contact_identity_keys has a surrogate id
 *      and stores key_value IN THE CLEAR. New is PRIMARY KEY
 *      (owner_id, key_type, key_hash) with no plaintext. So the move is a hash of
 *      every value -- and the new primary key can hold FEWER rows than the old
 *      table does. Two old rows collapse into one, and when they belonged to two
 *      DIFFERENT contact cards, that is the owner having two cards for one human
 *      and the migration having to choose. Choosing without counting first is how
 *      somebody's contact quietly loses its phone number.
 *
 *   4. ORPHANED OWNERS. Rows owned by an amber_id with no users row. Same story
 *      as the orphaned contacts: tolerated by the old schema, rejected by the new.
 *
 * IT PLANS NOTHING BY ITSELF. Read the output, then decide. The two decisions it
 * exists to inform are written at the bottom of the report.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const JSON_OUT = process.argv.includes("--json");

// The pepper is needed to MEASURE the collapse, because the collapse is defined
// by the hash. Same refusal as the backfill and for the same reason: a run with
// the wrong pepper produces a plausible number that is wrong.
const pepper = process.env.IDENTITY_KEY_PEPPER;
if (typeof pepper !== "string" || pepper.length < 32) {
  console.error(
    `\n  IDENTITY_KEY_PEPPER is ${pepper ? `${pepper.length} characters` : "not set"}; ` +
    `hashing needs at least 32.\n\n` +
    `  This report measures how many identity keys collapse under the new primary\n` +
    `  key, and that is decided by the hash. Without the real pepper the number\n` +
    `  would be arithmetically fine and factually meaningless.\n`,
  );
  process.exit(2);
}

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-cutover-plan.json");
  fs.writeFileSync(tmp, credsJson, { mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

let query, closePool;
const dsn = process.env.SMOKE_DATABASE_URL || null;
if (dsn) {
  const pg = (await import("pg")).default;
  const pool = new pg.Pool({ connectionString: dsn, max: 2 });
  query = (t, p) => pool.query(t, p);
  closePool = () => pool.end();
} else {
  ({ query, closePool } = await import("../src/db/sql.js"));
}

const { hashIdentityKey, KEY_TYPE_BY_NAME } = await import("../src/lib/identity-keys.js");
const { phoneKey, emailKey } = await import("../src/lib/contact-identity.js");

/**
 * Every column in the old schema that holds a contacts.id, from the catalog dump.
 * contact_review_candidates carries TWO, which is the kind of thing a remap
 * written from memory misses.
 */
const CONTACT_ID_COLUMNS = [
  // table                      column                  type      FK today?
  ["circle_members",            "contact_id",           "bigint", true],
  ["contact_embedding",         "contact_id",           "bigint", false],
  ["contact_facts",             "contact_id",           "bigint", true],
  ["contact_favorites",         "contact_id",           "text",   false],
  ["contact_identity_keys",     "contact_id",           "bigint", true],
  ["contact_review_candidates", "contact_id",           "bigint", true],
  ["contact_review_candidates", "candidate_contact_id", "bigint", true],
  ["contact_sources",           "contact_id",           "bigint", true],
  ["intro_requests",            "contact_id",           "bigint", false],
  ["people_rank_feedback",      "contact_id",           "bigint", false],
  ["voice_vocabulary",          "contact_id",           "bigint", false],
];

/** Tables whose owner_id is text in the old schema and uuid in the new one. */
const TEXT_OWNER_TABLES = [
  "answers", "contact_embedding", "contact_favorites", "contact_sources",
  "question_threads", "user_api_keys", "voice_vocabulary", "wall_posts",
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pad = (s, n) => String(s).padStart(n);
const out = { database: null, users: {}, contactIds: [], textOwners: [], keys: {}, owners: [] };

async function tableExists(t) {
  const { rows } = await query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${t}`]);
  return rows[0].ok;
}
async function columnExists(t, c) {
  const { rows } = await query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1 AND column_name=$2) AS ok`, [t, c]);
  return rows[0].ok;
}

let exitCode = 0;
try {
  const t0 = Date.now();
  const [{ db }] = (await query(`SELECT current_database() AS db`)).rows;
  out.database = db;

  // REFUSE THE WRONG DATABASE, IN BOTH DIRECTIONS. Pointed at the new schema this
  // would report a clean, empty, meaningless plan -- which is worse than an error,
  // because it looks like good news.
  const isNew = await tableExists("discovery_keys");
  const isOld = await columnExists("contact_identity_keys", "key_value");
  if (isNew || !isOld) {
    console.error(
      `\n  "${db}" is not the OLD schema.\n\n` +
      `  This report describes data that has to MOVE, so it only means anything\n` +
      `  against the pre-rebuild database. ${isNew
        ? "This one has discovery_keys, so it is the new schema."
        : "This one has no contact_identity_keys.key_value."}\n`,
    );
    process.exit(2);
  }

  if (!JSON_OUT) {
    console.log(`\n  CUTOVER PLAN — "${db}"   (read-only, ${((Date.now() - t0) / 1000).toFixed(1)}s to connect)\n`);
  }

  // ── 1. THE ANCHOR ──────────────────────────────────────────────────────────
  const [u] = (await query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE deleted_at IS NULL)::int AS live,
            count(*) FILTER (WHERE phone IS NOT NULL AND phone <> '')::int AS with_phone
       FROM users`)).rows;
  out.users = u;
  if (!JSON_OUT) {
    console.log(`  THE ANCHOR — users\n`);
    console.log(`    users.amber_id is ALREADY uuid and already the primary key, so accounts`);
    console.log(`    carry over unchanged. Everything else is remapped relative to them.\n`);
    console.log(`    ${pad(u.total, 8)} rows   ${u.live} live, ${u.with_phone} with a phone\n`);
  }

  // ── 2. THE CONTACT ID REMAP ────────────────────────────────────────────────
  const [c] = (await query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE deleted_at IS NULL)::int AS live,
            count(*) FILTER (WHERE owner_id IS NULL)::int AS no_owner,
            count(DISTINCT owner_id)::int AS owners,
            min(id)::bigint AS min_id, max(id)::bigint AS max_id
       FROM contacts`)).rows;

  if (!JSON_OUT) {
    console.log(`  1. THE CONTACT ID REMAP — contacts.id bigserial -> uuid\n`);
    console.log(`    ${pad(c.total, 8)} contact rows (${c.live} live) across ${c.owners} owner(s), ids ${c.min_id}..${c.max_id}`);
    if (c.no_owner > 0) {
      console.log(`    ${pad(c.no_owner, 8)} WITH NO owner_id — the new schema's owner_id is NOT NULL`);
    }
    console.log(`\n    Every column below has to receive the SAME uuid for the same old id.`);
    console.log(`    "orphans" already point at a contact row that does not exist. A column`);
    console.log(`    marked (fk) is protected by a foreign key today, so its zero is a`);
    console.log(`    guarantee; the unmarked ones have no constraint and never have.\n`);
    console.log(`      ${"table.column".padEnd(46)}${pad("rows", 8)}${pad("orphans", 9)}`);
  }

  for (const [table, col, type, hasFk] of CONTACT_ID_COLUMNS) {
    if (!(await tableExists(table)) || !(await columnExists(table, col))) {
      out.contactIds.push({ table, column: col, type, present: false });
      if (!JSON_OUT) console.log(`      ${`${table}.${col}`.padEnd(46)}${pad("—", 8)}   not present`);
      continue;
    }
    // The text column is compared as text on both sides so a non-numeric value
    // cannot abort the count -- a non-numeric contact_id is itself a finding.
    const join = type === "text"
      ? `c.id::text = t.${col}`
      : `c.id = t.${col}`;
    const [r] = (await query(
      `SELECT count(*)::int AS rows,
              count(*) FILTER (WHERE t.${col} IS NOT NULL
                AND NOT EXISTS (SELECT 1 FROM contacts c WHERE ${join}))::int AS orphans,
              count(*) FILTER (WHERE t.${col} IS NULL)::int AS nulls
         FROM ${table} t`)).rows;
    out.contactIds.push({ table, column: col, type, present: true, hasFk, ...r });
    if (!JSON_OUT) {
      const mark = r.orphans > 0 ? "  ← REJECTED BY THE NEW FK" : hasFk ? "  (fk)" : "";
      console.log(`      ${`${table}.${col}`.padEnd(46)}${pad(r.rows, 8)}${pad(r.orphans, 9)}${mark}`);
    }
  }

  // ── 3. THE TEXT OWNER IDS ──────────────────────────────────────────────────
  if (!JSON_OUT) {
    console.log(`\n  2. THE TEXT OWNER IDS — owner_id text -> uuid\n`);
    console.log(`    A cast that fails on one row fails the whole statement. Values are`);
    console.log(`    COUNTED, never printed: an owner_id that is not a uuid is quite possibly`);
    console.log(`    a phone number, and this report is not a place to write those down.\n`);
    console.log(`      ${"table".padEnd(30)}${pad("rows", 8)}${pad("uuid", 8)}${pad("NOT uuid", 10)}${pad("unknown", 9)}`);
  }
  for (const table of TEXT_OWNER_TABLES) {
    if (!(await tableExists(table)) || !(await columnExists(table, "owner_id"))) {
      out.textOwners.push({ table, present: false });
      if (!JSON_OUT) console.log(`      ${table.padEnd(30)}${pad("—", 8)}   not present`);
      continue;
    }
    const [r] = (await query(
      `SELECT count(*)::int AS rows,
              count(*) FILTER (WHERE owner_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')::int AS ok,
              count(*) FILTER (WHERE owner_id IS NOT NULL
                AND owner_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')::int AS bad,
              count(*) FILTER (WHERE owner_id IS NULL)::int AS nulls
         FROM ${table}`)).rows;
    // Is the non-uuid owner recoverable? If it matches a users.phone it is, which
    // turns "we lose these rows" into "we join through users".
    let recoverable = 0;
    if (r.bad > 0) {
      const [rec] = (await query(
        `SELECT count(*)::int AS n FROM ${table} t
          WHERE t.owner_id IS NOT NULL
            AND t.owner_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            AND EXISTS (SELECT 1 FROM users u WHERE u.phone = t.owner_id)`)).rows;
      recoverable = rec.n;
    }
    out.textOwners.push({ table, present: true, ...r, recoverableViaPhone: recoverable });
    if (!JSON_OUT) {
      const note = r.bad > 0
        ? (recoverable === r.bad
            ? `  all ${recoverable} resolve via users.phone`
            : `  ← ${r.bad - recoverable} resolve to NOTHING`)
        : "";
      console.log(`      ${table.padEnd(30)}${pad(r.rows, 8)}${pad(r.ok, 8)}${pad(r.bad, 10)}${pad(r.nulls, 9)}${note}`);
    }
  }

  // ── 4. THE IDENTITY KEY COLLAPSE ───────────────────────────────────────────
  // Hashing happens in JS because that is where the pepper and the normalization
  // live. Doing it in SQL would be a second implementation of the thing that must
  // not have two implementations.
  if (!JSON_OUT) {
    console.log(`\n  3. THE IDENTITY KEY COLLAPSE — (owner, type, value) -> (owner, type, hash)\n`);
  }
  const { rows: keys } = await query(
    `SELECT owner_id, key_type, key_value, contact_id FROM contact_identity_keys`);

  const seen = new Map();          // "owner|type|hex" -> first contact_id
  let unhashable = 0, sourceKeys = 0;
  const collapseSameCard = new Set();
  const collapseDifferentCards = new Map();  // key -> Set(contact_id)
  for (const k of keys) {
    const typeName = String(k.key_type);
    const t = KEY_TYPE_BY_NAME[typeName];
    if (!t) { unhashable += 1; continue; }
    if (typeName === "source") sourceKeys += 1;
    const normalized = typeName === "phone" ? phoneKey(k.key_value)
                     : typeName === "email" ? emailKey(k.key_value)
                     : String(k.key_value ?? "");
    const buf = normalized ? hashIdentityKey(t, normalized) : null;
    if (!buf) { unhashable += 1; continue; }
    const id = `${k.owner_id}|${t}|${buf.toString("hex")}`;
    if (!seen.has(id)) { seen.set(id, String(k.contact_id)); continue; }
    if (seen.get(id) === String(k.contact_id)) { collapseSameCard.add(id); continue; }
    if (!collapseDifferentCards.has(id)) {
      collapseDifferentCards.set(id, new Set([seen.get(id)]));
    }
    collapseDifferentCards.get(id).add(String(k.contact_id));
  }
  out.keys = {
    oldRows: keys.length,
    unhashable,
    sourceKeys,
    newRows: seen.size,
    collapseSameCard: collapseSameCard.size,
    collapseDifferentCards: collapseDifferentCards.size,
    cardsInvolved: [...collapseDifferentCards.values()].reduce((a, s) => a + s.size, 0),
  };
  if (!JSON_OUT) {
    const k = out.keys;
    console.log(`      ${"old rows".padEnd(40, ".")} ${pad(k.oldRows, 7)}`);
    console.log(`      ${"key_type = source, hashed like the rest".padEnd(40, ".")} ${pad(k.sourceKeys, 7)}   see identity-keys.js for why`);
    console.log(`      ${"DROPPED, cannot be hashed".padEnd(40, ".")} ${pad(k.unhashable, 7)}   unusable value, or an unknown key_type`);
    console.log(`      ${"NEW rows after the collapse".padEnd(40, ".")} ${pad(k.newRows, 7)}`);
    console.log(`      ${"duplicates on the SAME card".padEnd(40, ".")} ${pad(k.collapseSameCard, 7)}   harmless: two spellings, one person`);
    console.log(`      ${"duplicates across DIFFERENT cards".padEnd(40, ".")} ${pad(k.collapseDifferentCards, 7)}   ← A DECISION, see below`);
    console.log(`      ${"contact cards caught in those".padEnd(40, ".")} ${pad(k.cardsInvolved, 7)}`);
  }

  // ── 5. ORPHANED OWNERS ─────────────────────────────────────────────────────
  if (!JSON_OUT) {
    console.log(`\n  4. ORPHANED OWNERS — rows owned by an amber_id with no users row\n`);
    console.log(`      ${"table".padEnd(30)}${pad("orphaned rows", 15)}${pad("owners", 9)}`);
  }
  for (const table of ["contacts", "contact_identity_keys", "circles", "circle_members", "shares"]) {
    if (!(await tableExists(table)) || !(await columnExists(table, "owner_id"))) continue;
    const { rows: ct } = await query(
      `SELECT data_type FROM information_schema.columns
        WHERE table_schema='public' AND table_name=$1 AND column_name='owner_id'`, [table]);
    const cast = ct[0]?.data_type === "uuid" ? "t.owner_id" : "t.owner_id::uuid";
    let r;
    try {
      [r] = (await query(
        `SELECT count(*)::int AS rows, count(DISTINCT t.owner_id)::int AS owners
           FROM ${table} t
          WHERE t.owner_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM users u WHERE u.amber_id = ${cast})`)).rows;
    } catch (e) {
      // A text owner_id that will not cast is already reported in section 2.
      if (!JSON_OUT) console.log(`      ${table.padEnd(30)}${pad("—", 15)}   ${e.code === "22P02" ? "owner_id will not cast to uuid" : e.message}`);
      continue;
    }
    out.owners.push({ table, ...r });
    if (!JSON_OUT) {
      console.log(`      ${table.padEnd(30)}${pad(r.rows, 15)}${pad(r.owners, 9)}${r.rows ? "  ← REJECTED BY THE NEW FK" : ""}`);
    }
  }

  if (JSON_OUT) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(`\n  ──────────────────────────────────────────────────────────────────────\n`);
    console.log(`  TWO DECISIONS THIS REPORT EXISTS TO INFORM:\n`);
    console.log(`  A. HOW THE OLD id BECOMES A uuid.`);
    console.log(`     A uuid derived deterministically from the old id (uuidv5 of a constant`);
    console.log(`     namespace) needs no map table and converges on a re-run -- but it makes`);
    console.log(`     every contact id in the system computable by anyone who has the repo,`);
    console.log(`     permanently. A random uuid written to a contact_id_map table keeps ids`);
    console.log(`     unguessable and is the only way to trace a new row back to its old one`);
    console.log(`     if something looks wrong after the cutover. The map costs one table and`);
    console.log(`     a join in each of the ${CONTACT_ID_COLUMNS.length} statements above.\n`);
    console.log(`  B. WHO WINS A COLLAPSED IDENTITY KEY.`);
    console.log(`     ${out.keys.collapseDifferentCards} key(s) are held by two different contact cards under one owner,`);
    console.log(`     and the new primary key can only keep one. That is the owner having two`);
    console.log(`     cards for one person. Keeping the oldest card is deterministic and`);
    console.log(`     re-runnable; the alternative is keeping whichever card has more filled`);
    console.log(`     in, which is friendlier and is not reproducible.\n`);
    console.log(`  Nothing was written. This report reads.\n`);
  }
} catch (err) {
  console.error("\n  ✗ cutover-plan failed:", err?.stack || err?.message || err, "\n");
  exitCode = 1;
} finally {
  await closePool().catch(() => {});
}

process.exit(exitCode);
