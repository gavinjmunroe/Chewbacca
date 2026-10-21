/**
 * CUTOVER SURVEY — what is actually in the old database, and where does it go?
 *
 *   railway run node scripts/cutover-survey.js              the report
 *   railway run node scripts/cutover-survey.js --json       machine-readable
 *
 * READ-ONLY. Counts rows and reads the catalog. Writes nothing, drops nothing,
 * and takes no locks worth the name. Safe against production, which is the point:
 * the database it needs to describe is the live one.
 *
 * WHY THIS EXISTS. "How far until the cutover" is not answerable without knowing
 * what has to move, and nobody has looked. amber is on the pre-rebuild schema;
 * amber_next has the new one and no rows. Between them sits work nobody has
 * scoped, and scoping it by guessing is how a migration eats a weekend or a
 * table.
 *
 * WHAT IT TELLS YOU, per table in the old database:
 *
 *   rows            how much there is to move
 *   verdict         CARRIES     same name in the new schema; columns compared
 *                   ABSORBED    known to have been folded into another table
 *                   GONE        no home in the new schema
 *                   NEW-ONLY    exists in the new schema and not the old
 *   columns         which ones would not survive as-is, and which are new
 *
 * A COLUMN THAT EXISTS IN BOTH IS NOT NECESSARILY COMPATIBLE. This reports the
 * TYPE on both sides, because that is exactly where this codebase has been
 * bleeding: bigint ids that became uuid, text that became uuid, a phone key that
 * changed shape. A rename is visible; a type change under the same name is not,
 * and it is the one that silently corrupts rather than loudly fails.
 *
 * IT DOES NOT MOVE ANYTHING. This is the survey you read before writing the
 * backfill, not the backfill.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// Credentials before sql.js, same as every other script that reaches the real
// database. See scripts/script-hygiene-audit.mjs for why this is checked.
const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-cutover-survey.json");
  fs.writeFileSync(tmp, credsJson, { mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { query, closePool } = await import("../src/db/sql.js");

const JSON_OUT = process.argv.includes("--json");

let exitCode = 0;

/**
 * Tables the rebuild deliberately folded into something else. From the NOT
 * CARRIED block in migration 012, which is the only written record of these
 * decisions -- so a table listed here is accounted for rather than lost, and one
 * that is NOT listed and NOT in the new schema is a genuine question.
 */
const ABSORBED = {
  contact_facts: "observations",
  contact_notes: "observations",
  contact_experiences: "observations",
  contact_name_memory: "observations / contact_name_memory",
  app_conversation_messages: "conversation_messages",
  note_audio: "media_assets",
  note_comments: "conversation_comments",
  note_reactions: "conversation_reactions",
  note_shares: "shares",
  user_facts: "observations",
  contact_embedding: "contact_embedding (kept)",
  pending_fact_context: "pending_fact_context (kept)",
};

const SCHEMA_FILE = path.join(ROOT, "db", "schema-columns.json");
if (!fs.existsSync(SCHEMA_FILE)) {
  console.error(`\n  No ${path.relative(ROOT, SCHEMA_FILE)} to compare against.\n` +
                `  Generate it from a migrated database first -- see the header of\n` +
                `  scripts/column-drift-audit.mjs.\n`);
  process.exit(2);
}
const NEW = JSON.parse(fs.readFileSync(SCHEMA_FILE, "utf8"));

try {
  const [{ db }] = (await query(`SELECT current_database() AS db`)).rows;

  const { rows: cols } = await query(
    `SELECT table_name, column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position`,
  );
  const old = new Map();
  for (const c of cols) {
    if (!old.has(c.table_name)) old.set(c.table_name, {});
    old.get(c.table_name)[c.column_name] = c.data_type;
  }

  // Real counts. reltuples is an estimate and an estimate is not a plan.
  const counts = new Map();
  for (const t of old.keys()) {
    try {
      const { rows } = await query(`SELECT count(*)::bigint AS n FROM "${t}"`);
      counts.set(t, Number(rows[0].n));
    } catch {
      counts.set(t, null);
    }
  }

  const report = [];
  for (const [table, oldCols] of [...old].sort()) {
    if (table === "schema_migrations" || table === "smoke_marker") continue;
    const newCols = NEW[table];
    let verdict, target = null;
    if (newCols) { verdict = "CARRIES"; target = table; }
    else if (ABSORBED[table]) { verdict = "ABSORBED"; target = ABSORBED[table]; }
    else verdict = "GONE";

    const dropped = [];
    const added = [];
    const retyped = [];
    if (newCols) {
      for (const [c, t] of Object.entries(oldCols)) {
        if (newCols[c] === undefined) dropped.push(c);
        else if (newCols[c] !== t) retyped.push(`${c}: ${t} -> ${newCols[c]}`);
      }
      for (const c of Object.keys(newCols)) if (oldCols[c] === undefined) added.push(c);
    }
    report.push({ table, rows: counts.get(table), verdict, target, dropped, added, retyped });
  }

  const newOnly = Object.keys(NEW)
    .filter((t) => !old.has(t) && t !== "schema_migrations")
    .sort();

  if (JSON_OUT) {
    console.log(JSON.stringify({ database: db, tables: report, newOnly }, null, 2));
    await closePool().catch(() => {});
    process.exit(0);
  }

  const withRows = report.filter((r) => (r.rows ?? 0) > 0);
  const totalRows = withRows.reduce((a, r) => a + (r.rows ?? 0), 0);

  console.log(`\n  CUTOVER SURVEY — "${db}"\n`);
  console.log(`  ${report.length} table(s), ${withRows.length} holding rows, ` +
              `${totalRows.toLocaleString()} rows in total.\n`);

  const group = (v) => report.filter((r) => r.verdict === v && (r.rows ?? 0) > 0)
                             .sort((a, b) => (b.rows ?? 0) - (a.rows ?? 0));

  const carries = group("CARRIES");
  if (carries.length) {
    console.log(`  CARRIES — same table in the new schema (${carries.length} with rows)\n`);
    for (const r of carries) {
      const flag = r.retyped.length ? "  ← TYPES CHANGED" : "";
      console.log(`    ${r.table.padEnd(30)}${String(r.rows).padStart(9)} rows${flag}`);
      for (const t of r.retyped)  console.log(`        retyped  ${t}`);
      for (const c of r.dropped)  console.log(`        dropped  ${c}`);
      if (r.added.length) console.log(`        new      ${r.added.join(", ")}`);
    }
    console.log("");
  }

  const absorbed = group("ABSORBED");
  if (absorbed.length) {
    console.log(`  ABSORBED — folded into another table, so the rows need rewriting\n`);
    for (const r of absorbed) {
      console.log(`    ${r.table.padEnd(30)}${String(r.rows).padStart(9)} rows  ->  ${r.target}`);
    }
    console.log("");
  }

  const gone = group("GONE");
  if (gone.length) {
    console.log(`  GONE — HOLDING ROWS AND NO HOME IN THE NEW SCHEMA.\n` +
                `  Every one of these is a decision: migrate it, or lose it on purpose.\n`);
    for (const r of gone) {
      console.log(`    ${r.table.padEnd(30)}${String(r.rows).padStart(9)} rows`);
    }
    console.log("");
  }

  const empty = report.filter((r) => (r.rows ?? 0) === 0);
  console.log(`  ${empty.length} old table(s) hold no rows at all, so they cost nothing to leave behind.`);
  if (newOnly.length) {
    console.log(`  ${newOnly.length} table(s) exist only in the new schema and start empty.`);
  }

  const risky = report.filter((r) => r.retyped.length && (r.rows ?? 0) > 0);
  if (risky.length) {
    console.log(`\n  READ THIS BEFORE WRITING THE BACKFILL: ${risky.length} table(s) with rows\n` +
                `  have a column whose TYPE changed under the same name. A rename is\n` +
                `  visible in a diff; a retype is not, and it is the one that moves bad\n` +
                `  data in quietly rather than failing.\n`);
    for (const r of risky) {
      console.log(`    ${r.table}  (${r.rows} rows)`);
      for (const t of r.retyped) console.log(`        ${t}`);
    }
  }
  console.log("");
} catch (err) {
  console.error("\n  ✗ cutover-survey failed:", err?.message || err, "\n");
  exitCode = 1;
} finally {
  await closePool().catch(() => {});
}

// Same reason as backfill-discovery-keys.js: this printed its whole report and
// then held the terminal, because the Cloud SQL connector's refresh timer keeps
// the event loop alive. sql.js closes it now; a report job still has no business
// waiting on the loop once its last line is out.
process.exit(exitCode);
