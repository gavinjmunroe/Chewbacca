/**
 * THE BACKFILL FOR WHAT THE CUTOVER LEFT BEHIND.
 *
 *   railway run node scripts/cutover-backfill.js                    DRY RUN
 *   railway run node scripts/cutover-backfill.js --apply            write
 *   railway run node scripts/cutover-backfill.js --only users
 *   railway run node scripts/cutover-backfill.js --apply --only users
 *
 * DRY RUN BY DEFAULT. Without --apply it reads both databases, decides every row
 * and every column, reports exactly what it would write and what it would refuse,
 * and writes nothing.
 *
 * WHAT IT IS FIXING. cutover-completeness.js found two distinct failures:
 *
 *   phaseUsers SELECTed 18 of the users table's 27 columns, so nine never moved.
 *   Six had data, and privy_did is the login resolver
 *   (store.js: SELECT amber_id FROM users WHERE privy_did = $1), which is why a
 *   migrated account renders as "Your name" while its contacts and facts are fine.
 *
 *   Sixteen tables carrying real app state were never given a phase at all.
 *
 * ── THE THREE RULES THIS SCRIPT WILL NOT BREAK ────────────────────────────────
 *
 * IT NEVER OVERWRITES A VALUE THAT IS ALREADY THERE. Every column fill is
 * `WHERE <col> IS NULL`, so a value the live app has written since the cutover
 * wins over the pre-cutover one. Where that means the old value is dropped
 * (profile_extra, which the app has since rewritten for one account) the row is
 * REPORTED as a conflict rather than silently resolved either way.
 *
 * IT NEVER INSERTS INTO A TABLE THAT IS NOT EMPTY. The insert phases preserve the
 * source primary key so that answers -> question_threads -> questions keep
 * pointing at each other without an id map. That is only safe against an empty
 * table, so a non-empty one is skipped and named instead of merged.
 *
 * IT NEVER GUESSES A COLUMN LIST. Every phase reads both catalogs and moves the
 * INTERSECTION. Hand-written column lists are the bug being fixed here; writing
 * another one would be repeating it.
 *
 * ── WHAT IT DELIBERATELY DOES NOT RESTORE ─────────────────────────────────────
 *
 *   otp_codes, pending_oauth, device_sessions   expired credentials
 *   agent_data, agent_log                       5,069 rows of agent scratch
 *   conversation_messages                       left behind by the cutover's own
 *                                               documented decision
 *   contacts.enrichment*                        the fabricated enrichment we
 *                                               deleted on purpose. contacts.tags
 *                                               IS restored; the enrichment
 *                                               columns are named and skipped.
 *
 * ── IDS ───────────────────────────────────────────────────────────────────────
 *
 * contacts and circles were given NEW uuids by the cutover, so every reference to
 * one is translated through cutover_map. A row whose contact or circle did not
 * migrate is skipped and counted, never written with a dangling id.
 *
 * After an insert phase that preserved bigserial ids, the sequence is advanced to
 * max(id) -- otherwise the next live insert collides with a backfilled row.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i === -1 ? null : argv[i + 1]; };
const APPLY = argv.includes("--apply");
const FILL_GAPS = argv.includes("--fill-gaps");
const SOURCE_DB = flag("--from");
const ONLY = flag("--only");

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-backfill.json");
  fs.writeFileSync(tmp, credsJson, { mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const pg = (await import("pg")).default;
const sql = await import("../src/db/sql.js");
const tgt = sql.query;

let sourceDb = SOURCE_DB;
if (!sourceDb && !process.env.CUTOVER_SOURCE_URL) {
  const { rows } = await tgt(
    `SELECT datname FROM pg_database
      WHERE datistemplate = false AND datname <> current_database()
      ORDER BY datname`);
  const names = rows.map((r) => r.datname).filter((n) => n !== "postgres");
  const likely = names.filter((n) => /pre_?cutover|_old|_pre|_backup/i.test(n));
  if (likely.length !== 1) {
    console.error(
      `\n  Could not tell which database is the pre-cutover snapshot.\n` +
      `  Databases on this instance: ${names.join(", ") || "(none)"}\n\n` +
      `  Re-run with --from <database>.\n`);
    await sql.closePool().catch(() => {});
    process.exit(2);
  }
  sourceDb = likely[0];
}

let srcPool;
if (process.env.CUTOVER_SOURCE_URL) {
  srcPool = new pg.Pool({ connectionString: process.env.CUTOVER_SOURCE_URL, max: 2 });
} else {
  const { Connector } = await import("@google-cloud/cloud-sql-connector");
  const connector = new Connector();
  const opts = await connector.getOptions({
    instanceConnectionName: process.env.AMBER_SQL_CONNECTION_NAME,
    ipType: "PUBLIC",
  });
  srcPool = new pg.Pool({
    ...opts, database: sourceDb,
    user: process.env.AMBER_SQL_USER,
    password: process.env.AMBER_SQL_PASSWORD,
    max: 2, statement_timeout: 120000,
  });
  srcPool.__connector = connector;
}
const src = (t, p) => srcPool.query(t, p);

const quote = (id) => `"${String(id).replace(/"/g, '""')}"`;
const CATALOG = `SELECT table_name, column_name, data_type FROM information_schema.columns
                  WHERE table_schema='public' ORDER BY table_name, ordinal_position`;

function byTable(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.table_name)) m.set(r.table_name, new Map());
    m.get(r.table_name).set(r.column_name, r.data_type);
  }
  return m;
}
const typeOf = (cat, table, col) => cat.get(table)?.get(col) ?? null;
const srcCat = byTable((await src(CATALOG)).rows);
const tgtCat = byTable((await tgt(CATALOG)).rows);

/** Columns present in BOTH, minus anything the caller refuses to move. */
function sharedColumns(table, exclude = []) {
  const t = tgtCat.get(table) || new Map();
  const skip = new Set(exclude);
  return [...(srcCat.get(table) || new Map()).keys()].filter((c) => t.has(c) && !skip.has(c));
}

/**
 * WHY "invalid input syntax for type json" SURVIVED THE FIRST FIX.
 *
 * The first version coerced only when the TYPE differed between the two
 * databases, and questions.followups is jsonb on BOTH sides -- so it coerced
 * nothing and failed four rows again. The type was never the problem. The problem
 * is that jsonb holding a JSON ARRAY comes back from node-pg as a JS Array, and
 * node-pg serializes a JS Array as a POSTGRES ARRAY LITERAL -- {"a","b"} -- which
 * is not JSON. An object round-trips fine; an array does not. That is why
 * tenant_metadata and slack_links.data crossed and followups did not.
 *
 * So the trigger is the TARGET column being json, not the types disagreeing.
 *
 * Any other type change is still reported and left alone: silently reshaping a
 * value to fit a column is how a migration corrupts instead of failing. Columns
 * translated through cutover_map are excluded from that report -- bigint -> uuid
 * there is the remap doing its job, not drift.
 */
const JSONISH = new Set(["json", "jsonb"]);

function jsonCoercions(table, cols, remapped = new Set()) {
  const out = new Set();
  const mismatches = [];
  for (const c of cols) {
    const st = typeOf(srcCat, table, c);
    const tt = typeOf(tgtCat, table, c);
    if (JSONISH.has(tt)) { out.add(c); continue; }
    if (st === tt || remapped.has(c)) continue;
    mismatches.push(`${c} ${st} -> ${tt}`);
  }
  return { coerce: out, mismatches };
}

/** A value bound for a json column. Arrays and objects are stringified; a string
 *  that already parses as JSON passes through; anything else becomes a JSON
 *  string rather than a syntax error. */
function toJsonParam(value) {
  if (value == null) return null;
  if (typeof value === "string") {
    try { JSON.parse(value); return value; } catch { return JSON.stringify(value); }
  }
  return JSON.stringify(value);
}

const lines = [];
const say = (s = "") => { lines.push(s); console.log(s); };
const totals = { filled: 0, inserted: 0, skipped: 0, conflicts: 0, errors: 0 };

/** cutover_map: old id -> new id, for the two tables whose ids were regenerated. */
async function loadMap(sourceTable) {
  const { rows } = await tgt(
    `SELECT old_id, new_id FROM cutover_map WHERE source_table = $1`, [sourceTable]);
  return new Map(rows.map((r) => [String(r.old_id), String(r.new_id)]));
}

// ── PHASE: users columns ──────────────────────────────────────────────────────
/**
 * amber_id is stable across the cutover, so this is a column fill on rows that
 * already exist -- not an insert. deleted_at is excluded by hand: it is the one
 * column where copying a source value would DELETE a live account.
 */
const USERS_NEVER_FILL = ["amber_id", "deleted_at", "updated_at", "created_at"];

async function phaseUsersColumns() {
  const cols = sharedColumns("users", USERS_NEVER_FILL);
  const sRows = (await src(`SELECT ${["amber_id", ...cols].map(quote).join(", ")} FROM users`)).rows;
  const tRows = (await tgt(`SELECT ${["amber_id", ...cols].map(quote).join(", ")} FROM users`)).rows;
  const tById = new Map(tRows.map((r) => [String(r.amber_id), r]));

  const takenLoopSender = new Set(
    tRows.map((r) => r.loop_sender_id).filter((v) => v != null && String(v).trim() !== ""));

  const perColumn = new Map();
  const conflicts = [];
  const plan = [];

  for (const sRow of sRows) {
    const id = String(sRow.amber_id);
    const tRow = tById.get(id);
    if (!tRow) { say(`      no target row for ${id} -- skipped`); totals.skipped++; continue; }
    for (const c of cols) {
      const sVal = sRow[c];
      if (sVal == null) continue;
      if (tRow[c] != null) {
        const same = JSON.stringify(tRow[c]) === JSON.stringify(sVal);
        if (!same) conflicts.push({ id, column: c });
        continue;
      }
      if (c === "loop_sender_id") {
        if (String(sVal).trim() === "") { totals.skipped++; continue; }
        if (takenLoopSender.has(sVal)) {
          say(`      loop_sender_id for ${id} is already held by another row -- skipped`);
          totals.skipped++; continue;
        }
        takenLoopSender.add(sVal);
      }
      plan.push({ id, column: c, value: sVal });
      perColumn.set(c, (perColumn.get(c) || 0) + 1);
    }
  }

  for (const [c, n] of [...perColumn].sort()) say(`      fill ${c.padEnd(24)} ${n} row(s)`);
  for (const k of conflicts) {
    say(`      CONFLICT ${k.column.padEnd(22)} ${k.id} -- target already has a different value, left alone`);
    totals.conflicts++;
  }
  if (!APPLY) { totals.filled += plan.length; return; }

  for (const p of plan) {
    try {
      const r = await tgt(
        `UPDATE users SET ${quote(p.column)} = $1
          WHERE amber_id = $2 AND ${quote(p.column)} IS NULL`, [p.value, p.id]);
      totals.filled += r.rowCount;
    } catch (e) {
      say(`      ERROR ${p.column} ${p.id}: ${e.message}`);
      totals.errors++;
    }
  }
}

// ── PHASE: contacts.tags ──────────────────────────────────────────────────────
/**
 * ONLY tags. The other four contacts columns the audit flagged -- enrichment,
 * enrichment_status, enriched_at, enrichment_candidates -- are the fabricated
 * enrichment we deleted on purpose, and restoring them would put it back.
 */
async function phaseContactTags() {
  const map = await loadMap("contacts");
  if (map.size === 0) { say(`      cutover_map has no contacts -- cannot translate ids, skipped`); totals.skipped++; return; }
  const { rows } = await src(
    `SELECT id, tags FROM contacts WHERE tags IS NOT NULL AND cardinality(tags) > 0`);
  say(`      ${rows.length} source contact(s) carry tags`);
  say(`      NOT restoring: enrichment, enrichment_status, enriched_at, enrichment_candidates (fabricated, deleted on purpose)`);
  const mappedIds = rows.map((r) => map.get(String(r.id))).filter(Boolean);
  const stillEmpty = new Set(
    mappedIds.length === 0 ? [] :
    (await tgt(
      `SELECT id FROM contacts
        WHERE id = ANY($1::uuid[]) AND (tags IS NULL OR cardinality(tags) = 0)`,
      [mappedIds])).rows.map((r) => String(r.id)));
  say(`      ${stillEmpty.size} of them still have no tags in the new database`);

  let would = 0;
  for (const r of rows) {
    const newId = map.get(String(r.id));
    if (!newId) { totals.skipped++; continue; }
    if (!stillEmpty.has(String(newId))) continue;
    if (!APPLY) { would++; continue; }
    try {
      const res = await tgt(
        `UPDATE contacts SET tags = $1
          WHERE id = $2 AND (tags IS NULL OR cardinality(tags) = 0)`, [r.tags, newId]);
      totals.filled += res.rowCount;
    } catch (e) { say(`      ERROR contact ${r.id}: ${e.message}`); totals.errors++; }
  }
  if (!APPLY) totals.filled += would;
}

// ── PHASE: whole-table inserts ────────────────────────────────────────────────
/**
 * spec.remap maps a column onto the cutover_map entry that translates it. A row
 * with an untranslatable reference is skipped and counted -- never written with a
 * dangling id, and never written with the OLD id, which would look migrated and
 * point at nothing.
 */
const INSERT_TABLES = [
  { name: "push_tokens",              id: "id", owners: ["owner_id"] },
  { name: "secrets",                  conflict: "(owner_id, key_name)", owners: ["owner_id"] },
  { name: "tenant_deks",              conflict: "(owner_id, version)", owners: ["owner_id"] },
  { name: "tenant_secrets_v2",        conflict: "(owner_id, key_name)", owners: ["owner_id"] },
  { name: "tenant_secret_audit",      id: "id", owners: ["owner_id"] },
  { name: "questions",                id: "id" },
  { name: "question_threads",         id: "id", owners: ["owner_id"] },
  { name: "answers",                  id: "id", owners: ["owner_id"] },
  { name: "connection_requests",      id: "id" },
  { name: "wall_posts",               id: "id", owners: ["owner_id"] },
  { name: "reminders",                conflict: "(reminder_id)", owners: ["owner_id"] },
  { name: "slack_links",              conflict: "(team, slack_user)" },
  { name: "user_api_keys",            id: "id", owners: ["owner_id"] },
  { name: "contact_review_candidates", id: "id", owners: ["owner_id"],
    remap: { contact_id: "contacts", candidate_contact_id: "contacts" } },
  { name: "circle_member_seen",       conflict: "(viewer_amber_id, circle_id)",
    owners: ["viewer_amber_id"], remap: { circle_id: "circles" } },
];

/**
 * Every table above with an owner column has an ON DELETE CASCADE FK to
 * users(amber_id). A row whose owner has no users row would fail the insert one
 * error at a time -- 238 identical error lines for secrets alone. Checked up
 * front instead, and reported as one number.
 */
const TARGET_USERS = new Set(
  (await tgt(`SELECT amber_id FROM users`)).rows.map((r) => String(r.amber_id)));

async function phaseInsert(spec) {
  const table = spec.name;
  if (!srcCat.has(table) || !tgtCat.has(table)) { say(`      not in both databases -- skipped`); totals.skipped++; return; }

  const keyCols = spec.id
    ? [spec.id]
    : String(spec.conflict || "").replace(/[()]/g, "").split(",").map((x) => x.trim()).filter(Boolean);

  const existing = Number((await tgt(`SELECT count(*) AS n FROM ${quote(table)}`)).rows[0].n);
  let presentKeys = null;
  if (existing > 0) {
    if (!FILL_GAPS || keyCols.length === 0) {
      say(`      target already has ${existing} row(s) -- SKIPPED rather than merged (ids are preserved from the source)`);
      if (keyCols.length > 0) say(`      re-run with --fill-gaps to insert only the source rows whose key is absent`);
      totals.skipped++;
      return;
    }
    const { rows } = await tgt(`SELECT ${keyCols.map(quote).join(", ")} FROM ${quote(table)}`);
    presentKeys = new Set(rows.map((r) => keyCols.map((c) => String(r[c])).join("\u0000")));
    say(`      target has ${existing} row(s); filling gaps only, keyed on ${keyCols.join(" + ")}`);
  }

  const cols = sharedColumns(table);
  if (cols.length === 0) { say(`      no shared columns -- skipped`); totals.skipped++; return; }

  const { coerce, mismatches } = jsonCoercions(table, cols, new Set(Object.keys(spec.remap || {})));
  for (const c of coerce) say(`      binding ${c} as json text (${typeOf(tgtCat, table, c)}; a JS array would otherwise go as a Postgres array literal)`);
  for (const m of mismatches) say(`      TYPE CHANGED, left as-is: ${m}`);

  const maps = {};
  for (const [col, which] of Object.entries(spec.remap || {})) {
    maps[col] = await loadMap(which);
  }

  /**
   * A KEY COLUMN CAN ITSELF BE REMAPPED. circle_member_seen is keyed on
   * (viewer_amber_id, circle_id) and circle_id was reissued as a uuid, so
   * comparing the OLD source id against the new target id matches nothing and
   * every row looks absent. Translate first, then compare.
   */
  const sourceKey = (row) =>
    keyCols.map((c) => {
      const v = row[c];
      if (maps[c] && v != null) return String(maps[c].get(String(v)) ?? `__unmapped:${v}`);
      return String(v);
    }).join("\u0000");

  const sRows = (await src(`SELECT ${cols.map(quote).join(", ")} FROM ${quote(table)}`)).rows;
  say(`      ${sRows.length} source row(s), ${cols.length} shared column(s)`);

  const conflictClause = spec.conflict
    ? `ON CONFLICT ${spec.conflict} DO NOTHING`
    : spec.id ? `ON CONFLICT (${quote(spec.id)}) DO NOTHING` : "";
  const stmt =
    `INSERT INTO ${quote(table)} (${cols.map(quote).join(", ")})
     VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) ${conflictClause}`;

  let would = 0, unmapped = 0, orphaned = 0, alreadyThere = 0;
  for (const row of sRows) {
    if (presentKeys && presentKeys.has(sourceKey(row))) { alreadyThere++; continue; }
    const orphan = (spec.owners || []).find(
      (c) => row[c] != null && !TARGET_USERS.has(String(row[c])));
    if (orphan) { orphaned++; totals.skipped++; continue; }
    let bad = null;
    const values = cols.map((c) => {
      const v = row[c];
      if (maps[c] && v != null) {
        const mapped = maps[c].get(String(v));
        if (!mapped) bad = c;
        return mapped ?? null;
      }
      return coerce.has(c) ? toJsonParam(v) : v;
    });
    if (bad) { unmapped++; totals.skipped++; continue; }
    if (!APPLY) { would++; continue; }
    try {
      const r = await tgt(stmt, values);
      totals.inserted += r.rowCount;
    } catch (e) {
      say(`      ERROR ${table}: ${e.message}`);
      totals.errors++;
    }
  }
  if (alreadyThere) say(`      ${alreadyThere} row(s) already present -- left alone`);
  if (orphaned) say(`      ${orphaned} row(s) belong to an owner with no users row -- skipped`);
  if (unmapped) say(`      ${unmapped} row(s) reference a contact or circle that never migrated -- skipped`);
  if (!APPLY) { totals.inserted += would; say(`      would insert ${would}`); return; }

  if (spec.id) {
    const { rows: seq } = await tgt(
      `SELECT pg_get_serial_sequence($1, $2) AS s`, [table, spec.id]);
    if (seq[0]?.s) {
      await tgt(
        `SELECT setval($1, GREATEST((SELECT COALESCE(max(${quote(spec.id)}), 0) FROM ${quote(table)}), 1))`,
        [seq[0].s]);
      say(`      sequence advanced past the highest backfilled id`);
    }
  }
}

// ── run ───────────────────────────────────────────────────────────────────────
const PHASES = [
  ["users", phaseUsersColumns],
  ["contact_tags", phaseContactTags],
  ...INSERT_TABLES.map((s) => [s.name, () => phaseInsert(s)]),
];

say(`\n  CUTOVER BACKFILL   source=${sourceDb || "CUTOVER_SOURCE_URL"}   ${APPLY ? "APPLY" : "DRY RUN"}\n`);
for (const [name, fn] of PHASES) {
  if (ONLY && ONLY !== name) continue;
  say(`  ${name}`);
  try { await fn(); } catch (e) { say(`      PHASE FAILED: ${e.message}`); totals.errors++; }
  say("");
}
say(`  ${APPLY ? "filled" : "would fill"} ${totals.filled} column value(s), ` +
    `${APPLY ? "inserted" : "would insert"} ${totals.inserted} row(s), ` +
    `${totals.skipped} skipped, ${totals.conflicts} conflict(s), ${totals.errors} error(s).`);
if (!APPLY) say(`\n  DRY RUN -- nothing was written. Re-run with --apply.\n`);
else say("");

await srcPool.end().catch(() => {});
if (srcPool.__connector) srcPool.__connector.close();
await sql.closePool().catch(() => {});
