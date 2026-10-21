/**
 * DID THE CUTOVER ACTUALLY BRING EVERYTHING? A completeness audit, not a survey.
 *
 *   railway run node scripts/cutover-completeness.js --from amber_pre_cutover
 *   railway run node scripts/cutover-completeness.js --from amber_pre_cutover --table users
 *   railway run node scripts/cutover-completeness.js --from amber_pre_cutover --json
 *   railway run node scripts/cutover-completeness.js --from amber_pre_cutover --rowdiff users:amber_id
 *
 * READ-ONLY. Every statement on both databases is a SELECT. It writes nothing.
 *
 * WHY THIS EXISTS. cutover-survey.js answers "what SHOULD move" by reading the two
 * catalogs. It cannot answer "what DID move", and the difference is where this
 * migration has been bleeding: phaseUsers SELECTs 18 of the users table's 27
 * columns, so nine were never in flight -- and the ones that were in flight were
 * written with ON CONFLICT (amber_id) DO NOTHING, which means a target row that
 * already existed blocked ALL 18. Neither failure raises an error, neither shows
 * up in a row count, and the symptom is a profile that renders as "Your name".
 *
 * WHAT IT COMPARES, per table that exists in both databases:
 *
 *   rows          source vs target
 *   per column    non-null count on each side, for columns present in both
 *
 * and it flags three distinct things, because they have three different fixes:
 *
 *   MISSING ROWS      target has fewer rows than source
 *   EMPTY COLUMN      source has values, target has none  -> never copied
 *   THINNER COLUMN    target has some but materially fewer -> partially copied
 *   SOURCE-ONLY COL   column exists in source and not target -> deliberate or not
 *
 * A CLEAN REPORT IS NOT PROOF OF A CORRECT MIGRATION. Non-null counts cannot see
 * a value that crossed as the wrong value, and a table that was intentionally left
 * behind (the conversational and media tables) shows as missing rows by design.
 * This finds data that silently did not arrive, which is the failure we actually
 * had.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i === -1 ? null : argv[i + 1]; };
const SOURCE_DB = flag("--from");
const ONLY_TABLE = flag("--table");
const AS_JSON = argv.includes("--json");
const THIN_RATIO = Number(flag("--thin")) || 0.9;

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-completeness.json");
  fs.writeFileSync(tmp, credsJson, { mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const pg = (await import("pg")).default;

const sqlEarly = await import("../src/db/sql.js");

/**
 * --from IS OPTIONAL. Without it we ask the target which other databases exist on
 * the instance and pick the one that is plainly the pre-cutover snapshot. If that
 * is ambiguous we print the list and stop rather than auditing against a guess --
 * naming the wrong source would report the whole migration as lost.
 */
let sourceDb = SOURCE_DB;
if (!sourceDb && !process.env.CUTOVER_SOURCE_URL) {
  const { rows } = await sqlEarly.query(
    `SELECT datname FROM pg_database
      WHERE datistemplate = false AND datname <> current_database()
      ORDER BY datname`);
  const names = rows.map((r) => r.datname).filter((n) => n !== "postgres");
  const likely = names.filter((n) => /pre_?cutover|_old|_pre|_backup/i.test(n));
  if (likely.length === 1) {
    sourceDb = likely[0];
    console.log(`\n  --from not given; using ${sourceDb} (the only pre-cutover snapshot on the instance).`);
  } else {
    console.error(
      `\n  Could not tell which database is the pre-cutover snapshot.\n` +
      `  Databases on this instance: ${names.join(", ") || "(none besides the current one)"}\n\n` +
      `  Re-run with --from <database>.\n`);
    await sqlEarly.closePool().catch(() => {});
    process.exit(2);
  }
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
    ...opts,
    database: sourceDb,
    user: process.env.AMBER_SQL_USER,
    password: process.env.AMBER_SQL_PASSWORD,
    max: 2,
    statement_timeout: 120000,
  });
  srcPool.__connector = connector;
}
const src = (t, p) => srcPool.query(t, p);

const sql = sqlEarly;
const tgt = sql.query;

const CATALOG = `
  SELECT table_name, column_name
    FROM information_schema.columns
   WHERE table_schema = 'public'
   ORDER BY table_name, ordinal_position`;

const quote = (id) => `"${String(id).replace(/"/g, '""')}"`;

function byTable(rows) {
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.table_name)) m.set(r.table_name, []);
    m.get(r.table_name).push(r.column_name);
  }
  return m;
}

async function counts(runner, table, cols) {
  const projection = ["count(*) AS __rows", ...cols.map((c) => `count(${quote(c)}) AS ${quote(c)}`)];
  const { rows } = await runner(`SELECT ${projection.join(", ")} FROM ${quote(table)}`);
  const out = {};
  for (const [k, v] of Object.entries(rows[0])) out[k] = Number(v);
  return out;
}

const srcCat = byTable((await src(CATALOG)).rows);
const tgtCat = byTable((await tgt(CATALOG)).rows);

/**
 * A TABLE THAT EXISTS ON ONLY ONE SIDE IS NOT A COMPARISON, IT IS A DECISION, and
 * the first version of this audit compared the intersection and said nothing about
 * either end -- so a table full of rows in the old database with no home in the new
 * one produced a clean report.
 *
 * SOURCE-ONLY IS NOT AUTOMATICALLY LOST. Four of these tables -- contact_facts,
 * contact_notes, contact_experiences, user_facts -- were COLLAPSED into
 * observations on purpose, and the cutover recorded every row it moved in
 * cutover_map keyed by the source table it came from. So the honest verdict is
 * "N of M rows mapped", and only zero mapped rows means nowhere to go. Saying
 * otherwise would report a deliberate reshape as data loss, and next to a real
 * loss that is the difference nobody would look for twice.
 *
 * TARGET-ONLY is the new schema, and empty there means one of two very different
 * things: not populated YET, or nothing will ever populate it. The only honest way
 * to tell them apart without a running app is whether any code path writes to it,
 * so each empty target-only table is reported with the number of times src/
 * mentions it. Zero mentions and zero rows is a dead table; mentions and zero rows
 * is a feature nobody has exercised.
 */
const SRC_ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "src");

function srcMentions(name) {
  let n = 0;
  const re = new RegExp(`\\b${name}\\b`, "g");
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!/\.(js|ts|mjs)$/.test(e.name) || /\.test\./.test(e.name)) continue;
      n += (fs.readFileSync(full, "utf8").match(re) || []).length;
    }
  };
  try { walk(SRC_ROOT); } catch { return null; }
  return n;
}

async function rowCount(runner, table) {
  try {
    const { rows } = await runner(`SELECT count(*) AS n FROM ${quote(table)}`);
    return Number(rows[0].n);
  } catch { return null; }
}

const sourceOnlyTables = [...srcCat.keys()].filter((t) => !tgtCat.has(t)).sort();
const targetOnlyTables = [...tgtCat.keys()].filter((t) => !srcCat.has(t)).sort();

const tables = [...srcCat.keys()]
  .filter((t) => tgtCat.has(t))
  .filter((t) => !ONLY_TABLE || t === ONLY_TABLE)
  .sort();

const ROWDIFF = flag("--rowdiff");
if (ROWDIFF) {
  const [rdTable, rdKey = "id"] = ROWDIFF.split(":");
  if (!srcCat.has(rdTable) || !tgtCat.has(rdTable)) {
    console.error(`\n  ${rdTable} is not in both databases.\n`);
    process.exit(2);
  }
  const shared = srcCat.get(rdTable).filter((c) => new Set(tgtCat.get(rdTable)).has(c));
  const cols = shared.map(quote).join(", ");
  const sRows = (await src(`SELECT ${cols} FROM ${quote(rdTable)} ORDER BY ${quote(rdKey)}`)).rows;
  const tRows = (await tgt(`SELECT ${cols} FROM ${quote(rdTable)} ORDER BY ${quote(rdKey)}`)).rows;
  const tById = new Map(tRows.map((r) => [String(r[rdKey]), r]));
  const norm = (v) => (v == null ? null : v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v));

  console.log(`\n  ROW DIFF   ${rdTable}   keyed on ${rdKey}   source ${sRows.length} rows, target ${tRows.length} rows\n`);
  for (const sRow of sRows) {
    const key = String(sRow[rdKey]);
    const tRow = tById.get(key);
    if (!tRow) { console.log(`  ${key}   ABSENT FROM TARGET\n`); continue; }
    const diffs = shared
      .map((c) => [c, norm(sRow[c]), norm(tRow[c])])
      .filter(([, a, b]) => a !== b);
    if (diffs.length === 0) { console.log(`  ${key}   identical`); continue; }
    console.log(`  ${key}   ${diffs.length} column(s) differ`);
    for (const [c, a, b] of diffs) {
      const lost = a != null && b == null;
      console.log(`      ${lost ? "LOST " : "     "}${c.padEnd(26)} ${String(a).slice(0, 48).padEnd(50)} -> ${b === null ? "NULL" : String(b).slice(0, 48)}`);
    }
    console.log("");
  }
  const srcKeys = new Set(sRows.map((r) => String(r[rdKey])));
  const extra = tRows.filter((r) => !srcKeys.has(String(r[rdKey])));
  if (extra.length) console.log(`  ${extra.length} row(s) in target with no source row: ${extra.map((r) => String(r[rdKey])).join(", ")}\n`);
  const soCols = srcCat.get(rdTable).filter((c) => !new Set(tgtCat.get(rdTable)).has(c));
  if (soCols.length) console.log(`  source-only columns (not compared): ${soCols.join(", ")}\n`);
  await srcPool.end().catch(() => {});
  if (srcPool.__connector) srcPool.__connector.close();
  await sql.closePool().catch(() => {});
  process.exit(0);
}

const report = [];
for (const table of tables) {
  const sCols = srcCat.get(table);
  const tCols = new Set(tgtCat.get(table));
  const shared = sCols.filter((c) => tCols.has(c));
  const sourceOnly = sCols.filter((c) => !tCols.has(c));

  let s, t;
  try {
    s = await counts(src, table, shared);
    t = await counts(tgt, table, shared);
  } catch (e) {
    report.push({ table, error: e.message });
    continue;
  }

  const findings = [];
  for (const c of shared) {
    if (s[c] === 0) continue;
    if (t[c] === 0) findings.push({ column: c, kind: "EMPTY", source: s[c], target: t[c] });
    else if (t[c] < s[c] * THIN_RATIO) findings.push({ column: c, kind: "THINNER", source: s[c], target: t[c] });
  }

  report.push({
    table,
    sourceRows: s.__rows,
    targetRows: t.__rows,
    missingRows: Math.max(0, s.__rows - t.__rows),
    findings,
    sourceOnly,
  });
}

const interesting = report.filter(
  (r) => r.error || r.missingRows > 0 || r.findings.length > 0 || r.sourceOnly.length > 0,
);

if (AS_JSON) {
  console.log(JSON.stringify({ sourceDb, tables: report }, null, 2));
} else {
  console.log(`\n  CUTOVER COMPLETENESS   source=${sourceDb || "CUTOVER_SOURCE_URL"}   ${tables.length} tables in both\n`);
  for (const r of interesting) {
    if (r.error) { console.log(`  ${r.table}\n      ERROR  ${r.error}\n`); continue; }
    console.log(`  ${r.table}   rows ${r.sourceRows} -> ${r.targetRows}${r.missingRows ? `   MISSING ${r.missingRows}` : ""}`);
    for (const f of r.findings) {
      console.log(`      ${f.kind.padEnd(8)} ${f.column.padEnd(28)} ${f.source} -> ${f.target}`);
    }
    if (r.sourceOnly.length) console.log(`      source-only columns: ${r.sourceOnly.join(", ")}`);
    console.log("");
  }
  const clean = report.length - interesting.length;
  console.log(`  ${interesting.length} table(s) with findings, ${clean} clean.\n`);

  if (!ONLY_TABLE) {
    const mapped = new Map();
    const reviewed = new Map();
    try {
      for (const r of (await tgt(
        `SELECT source_table, count(*) AS n FROM cutover_map GROUP BY source_table`)).rows) {
        mapped.set(r.source_table, Number(r.n));
      }
      for (const r of (await tgt(
        `SELECT source_table, count(*) AS n FROM cutover_review GROUP BY source_table`)).rows) {
        reviewed.set(r.source_table, Number(r.n));
      }
    } catch { /* no cutover bookkeeping in this database */ }

    /**
     * A SOFT-DELETED SOURCE ROW IS NOT A MISSING ROW. The observations phase
     * skips `deleted_at IS NOT NULL` deliberately -- carrying it would resurrect
     * something the user removed -- and it does NOT write a cutover_review entry
     * for that, correctly, because there is nothing to review.
     *
     * Counting all source rows therefore reports the user's own deletions as
     * unaccounted-for data. The denominator is LIVE rows, with deleted ones shown
     * beside it so the number is visible rather than hidden.
     */
    console.log(`  SOURCE-ONLY TABLES   ${sourceOnlyTables.length}   (no table of this name in the new schema)\n`);
    for (const t of sourceOnlyTables) {
      const n = await rowCount(src, t);
      const hasDeleted = (srcCat.get(t) || []).includes("deleted_at");
      let live = n, gone = 0;
      if (hasDeleted && n !== null) {
        try {
          const { rows } = await src(
            `SELECT count(*) FILTER (WHERE deleted_at IS NULL) AS live,
                    count(*) FILTER (WHERE deleted_at IS NOT NULL) AS gone
               FROM ${quote(t)}`);
          live = Number(rows[0].live); gone = Number(rows[0].gone);
        } catch { /* leave the totals as they are */ }
      }
      const m = mapped.get(t) ?? 0;
      const rev = reviewed.get(t) ?? 0;
      const verdict = live === 0 ? ""
        : m === 0 ? "   NOTHING MAPPED -- data with nowhere to go"
        : m >= live ? `   absorbed, all ${live} live row(s) mapped`
        : `   absorbed, ${m} of ${live} live -- ${live - m} UNACCOUNTED FOR`;
      const shape = n === null ? "unreadable"
        : gone ? `${live} live +${gone} del` : `${live} row(s)`;
      console.log(`      ${t.padEnd(34)} ${shape.padEnd(18)}${verdict}${rev ? `   (${rev} in cutover_review)` : ""}`);
    }
    console.log("");

    console.log(`  TARGET-ONLY TABLES   ${targetOnlyTables.length}   (new schema; empty is not the same as wrong)\n`);
    for (const t of targetOnlyTables) {
      const n = await rowCount(tgt, t);
      const m = srcMentions(t);
      const verdict = n === null ? "unreadable"
        : n > 0 ? "populated"
        : m === 0 ? "EMPTY AND NEVER REFERENCED BY src/ -- dead table"
        : `empty, but src/ mentions it ${m}x -- a feature nobody has exercised`;
      console.log(`      ${t.padEnd(34)} ${n === null ? "?" : `${n} row(s)`.padEnd(12)} ${verdict}`);
    }
    console.log("");
  }
}

await srcPool.end().catch(() => {});
if (srcPool.__connector) srcPool.__connector.close();
await sql.closePool().catch(() => {});
