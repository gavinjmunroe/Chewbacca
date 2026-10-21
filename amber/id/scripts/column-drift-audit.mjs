/**
 * COLUMN-LEVEL DRIFT AUDIT. Does the code reference columns that exist?
 *
 *   node scripts/column-drift-audit.mjs                    summary
 *   node scripts/column-drift-audit.mjs --by-file          grouped by file
 *   node scripts/column-drift-audit.mjs --schema path.json use a different schema
 *
 * WHY THIS EXISTS. schema-drift-audit.mjs checks TABLE names and reported a clean
 * sweep -- while circles-store.js was selecting contact_identity_keys.key_value,
 * a column migration 003 deleted. Three authorization queries threw on every
 * call, and because those functions catch and return [] the symptom was circles
 * being empty rather than an error. A table-name check cannot see that, and
 * "nothing references a table that will not exist" reads as a much stronger
 * guarantee than it is.
 *
 * HOW IT WORKS, AND WHERE IT IS APPROXIMATE. For each SQL template literal it
 * binds aliases from FROM/JOIN/UPDATE/INTO/USING/DELETE FROM clauses, then checks
 * every `alias.column` against the real schema. It deliberately reports NOTHING
 * for an alias it could not bind -- a CTE, a subquery, a set-returning function,
 * a JS object that happens to look like a dotted name. The cost of guessing is a
 * wall of false positives that get ignored, and an ignored audit is worse than no
 * audit.
 *
 * So: findings here are real, and silence here is not proof. It catches the class
 * of mistake that just cost us three broken queries, which is the point.
 *
 * THE SCHEMA IS A FILE, not a live connection, so this runs in CI with no
 * database. Regenerate it after a migration:
 *
 *   railway run node scripts/regen-schema-columns.mjs
 *
 * The psql one-liner that used to be printed here CANNOT RUN against this
 * database and is kept below only so nobody reinvents it. Production is Cloud
 * SQL, reached through @google-cloud/cloud-sql-connector with the AMBER_SQL_*
 * variables; there is no DATABASE_URL, so psql tries the local unix socket and
 * fails with "No such file or directory", which reads as a broken machine
 * rather than a command that was never going to work.
 *
 *   psql -At -c "COPY (SELECT json_object_agg(t, cols) FROM (
 *     SELECT table_name AS t, json_object_agg(column_name, data_type) AS cols
 *       FROM information_schema.columns WHERE table_schema='public'
 *      GROUP BY table_name) x) TO STDOUT" > db/schema-columns.json
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const schemaArg = argv.indexOf("--schema");
const SCHEMA_PATH = schemaArg === -1
  ? path.join(ROOT, "db", "schema-columns.json")
  : argv[schemaArg + 1];

if (!fs.existsSync(SCHEMA_PATH)) {
  console.error(`\n  No schema file at ${SCHEMA_PATH}\n\n` +
    `  Generate one (see the header of this file) or pass --schema <path>.\n`);
  process.exit(2);
}
const SCHEMA = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
const TABLES = new Set(Object.keys(SCHEMA));

// IS THE SNAPSHOT OLDER THAN THE SCHEMA IT DESCRIBES? A stale file makes this
// audit confidently wrong in both directions -- it reported a brand-new column as
// missing the first time a migration added one, and it would just as happily miss
// a column a migration dropped. Cheap to check, so it is checked.
{
  const migDir = path.join(ROOT, "db", "migrations");
  const snap = fs.statSync(SCHEMA_PATH).mtimeMs;
  const newest = fs.existsSync(migDir)
    ? fs.readdirSync(migDir).filter((f) => f.endsWith(".sql"))
        .reduce((m, f) => Math.max(m, fs.statSync(path.join(migDir, f)).mtimeMs), 0)
    : 0;
  if (newest > snap) {
    console.error(
      `\n  STOP: ${path.relative(ROOT, SCHEMA_PATH)} is older than the newest migration.\n` +
      `  Every finding below may be an artefact of the stale snapshot.\n` +
      `  Regenerate it (see the header) and run again.\n`,
    );
    process.exit(2);
  }
}

const files = [];
(function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules") walk(p); }
    else if (
      (e.name.endsWith(".js") || e.name.endsWith(".mjs")) &&
      !e.name.endsWith(".test.js")
    ) {
      files.push(p);
    }
  }
  // scripts/ TOO, and this is not a nicety.
  //
  // For a month this audit walked src/ only, so a maintenance script could
  // reference a column that no longer existed and every gate stayed green.
  // contact_identity_keys went from a plaintext key_value to a salted key_hash;
  // src/ moved with it and scripts/contact-dedup-backfill.js did not, and the
  // way that was discovered was a 42703 in production credentials against a
  // real address book. A one-time repair script is exactly the code that gets
  // run under pressure and exactly the code nobody re-reads first.
})(path.join(ROOT, "src")) ?? undefined;
[path.join(ROOT, "src"), path.join(ROOT, "scripts")].forEach(function collect(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    // _superseded holds scripts kept for reference and deliberately not
    // maintained. Auditing them would mean a permanently red gate reporting
    // drift nobody intends to fix, which is how a gate stops being read.
    if (e.isDirectory()) {
      if (e.name !== "node_modules" && e.name !== "_superseded") collect(p);
    }
    else if (
      (e.name.endsWith(".js") || e.name.endsWith(".mjs")) &&
      !e.name.endsWith(".test.js") &&
      !files.includes(p)
    ) {
      files.push(p);
    }
  }
});

/** Same SQL extraction as schema-drift-audit: comments out, template literals in. */
function sqlChunks(text) {
  const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, " ");
  const noLine = noBlock.replace(/^[ \t]*\/\/.*$/gm, " ").replace(/([^:])\/\/.*$/gm, "$1");
  const out = [];
  for (const m of noLine.matchAll(/`([^`]*)`/g)) {
    const body = m[1];
    const looksSql = /\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/i.test(body);
    const isDdl = /\b(CREATE|ALTER)\s+TABLE\b/i.test(body);
    const binds = /\$\d/.test(body);
    if (isDdl || (looksSql && binds)) out.push(body.replace(/--[^\n]*/g, " "));
  }
  return out;
}

// Keywords that can follow a table name and are not an alias.
const NOT_AN_ALIAS = new Set([
  "on", "using", "where", "set", "values", "select", "group", "order", "limit",
  "left", "right", "inner", "outer", "full", "cross", "join", "and", "or",
  "returning", "as", "from", "into", "lateral", "natural", "union", "having",
  "window", "for", "offset", "with", "do", "conflict",
]);

/**
 * alias -> table, for one SQL statement. Unbindable aliases are simply absent.
 *
 * AN ALIAS BOUND TWICE TO DIFFERENT THINGS IS DROPPED, not resolved to the last
 * one. A statement can legitimately use `p` for a CTE in one scope and a table in
 * another, and picking either produces confident nonsense -- which is how this
 * audit would train someone to ignore it.
 */
function aliasMap(sql) {
  const map = new Map();
  const ambiguous = new Set();
  const re = /\b(?:FROM|JOIN|INTO|UPDATE|USING)\s+(?:ONLY\s+)?"?([a-z_][a-z0-9_]*)"?(?:\s+(?:AS\s+)?"?([a-z_][a-z0-9_]*)"?)?/gi;
  for (const m of sql.matchAll(re)) {
    const table = m[1].toLowerCase();
    if (!TABLES.has(table)) continue;      // CTE, function, or a table we do not know
    map.set(table, table);                 // the bare table name is always usable
    const alias = m[2]?.toLowerCase();
    if (alias && !NOT_AN_ALIAS.has(alias)) {
      if (map.has(alias) && map.get(alias) !== table) ambiguous.add(alias);
      map.set(alias, table);
    }
  }
  // `USING contacts c, circles ci` — the comma-separated tail of a USING/FROM list.
  const listRe = /\b(?:FROM|USING)\s+((?:[a-z_][a-z0-9_]*(?:\s+[a-z_][a-z0-9_]*)?\s*,\s*)+[a-z_][a-z0-9_]*(?:\s+[a-z_][a-z0-9_]*)?)/gi;
  for (const m of sql.matchAll(listRe)) {
    for (const part of m[1].split(",")) {
      const [t, a] = part.trim().split(/\s+/);
      const table = t?.toLowerCase();
      if (!table || !TABLES.has(table)) continue;
      map.set(table, table);
      const alias = a?.toLowerCase();
      if (alias && !NOT_AN_ALIAS.has(alias)) {
        if (map.has(alias) && map.get(alias) !== table) ambiguous.add(alias);
        map.set(alias, table);
      }
    }
  }
  // A name declared as a CTE anywhere in the statement is not a table reference,
  // whatever else it collides with.
  for (const m of sql.matchAll(/\b([a-z_][a-z0-9_]*)\s+AS\s*\(/gi)) {
    ambiguous.add(m[1].toLowerCase());
  }
  // CTEs, including recursive CTEs with an explicit column list, have their
  // own scope. Keep a null binding so their presence prevents the single-table
  // fallback below from attributing their unqualified columns to a nested
  // physical table (for example, `FROM walk` alongside a nested `connections`).
  const ctes = new Set();
  for (const m of sql.matchAll(
    /\bWITH\s+(?:RECURSIVE\s+)?([a-z_][a-z0-9_]*)\s*(?:\([^)]*\))?\s+AS\s*\(/gi,
  )) ctes.add(m[1].toLowerCase());
  for (const m of sql.matchAll(
    /,\s*([a-z_][a-z0-9_]*)\s*(?:\([^)]*\))?\s+AS\s*\(/gi,
  )) ctes.add(m[1].toLowerCase());
  for (const a of ambiguous) map.delete(a);
  for (const cte of ctes) map.set(cte, null);
  return map;
}

// EXCLUDED, and each for a reason. `excluded` is the ON CONFLICT pseudo-table and
// its columns are the target's, already checked on the INSERT list.
const PSEUDO = new Set(["excluded", "new", "old"]);

// SQL keywords and functions that appear where a bare column name would, in the
// clause shapes scanned below. Listed rather than guessed at, same as everywhere
// else in this file.
const NOT_A_COLUMN = new Set([
  "select", "distinct", "from", "where", "and", "or", "not", "null", "true",
  "false", "as", "on", "in", "is", "like", "ilike", "between", "case", "when",
  "then", "else", "end", "count", "sum", "min", "max", "avg", "coalesce",
  "nullif", "greatest", "least", "now", "current_timestamp", "exists", "any",
  "all", "cast", "extract", "interval", "asc", "desc", "limit", "offset",
  "order", "group", "by", "having", "returning", "into", "values", "set",
  "conflict", "do", "nothing", "update", "insert", "delete", "join", "left",
  "right", "inner", "outer", "full", "cross", "lateral", "using", "union",
  "except", "intersect", "with", "default", "unnest", "array", "row",
  // TYPE NAMES. `id = ANY($1::bigint[])` puts `bigint` where the unqualified
  // scan looks for a column, and it reported contacts.bigint as missing. A false
  // positive is how an audit teaches people to ignore it.
  "bigint", "int", "integer", "smallint", "text", "uuid", "boolean", "bool",
  "real", "numeric", "float8", "float4", "double", "precision", "jsonb", "json",
  "bytea", "timestamptz", "timestamp", "date", "time", "interval", "vector",
  "halfvec", "tsvector", "citext", "char", "varchar",
]);

const findings = [];
for (const file of files) {
  const rel = path.relative(ROOT, file);
  for (const sql of sqlChunks(fs.readFileSync(file, "utf8"))) {
    const map = aliasMap(sql);
    if (map.size === 0) continue;
    const seen = new Set();
    const add = (table, col, how) => {
      // ONLY REAL IDENTIFIERS. A template literal that interpolates a column
      // list -- `SELECT ${cols.join(", ")} FROM contacts` -- leaves fragments
      // like `contacts."` and `contacts.${cols.join("` in the extracted SQL,
      // and reporting those as missing columns is noise that trains people to
      // ignore this audit. The interpolated names cannot be checked statically,
      // which is the same reason unbindable aliases are skipped.
      if (!/^[a-z_][a-z0-9_]*$/i.test(col)) return;
      if (SCHEMA[table][col] !== undefined) return;
      const key = `${rel}|${table}.${col}`;
      if (seen.has(key)) return;
      seen.add(key);
      findings.push({ file: rel, table, col, alias: how });
    };

    for (const m of sql.matchAll(/\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/gi)) {
      const alias = m[1].toLowerCase();
      const col = m[2].toLowerCase();
      if (PSEUDO.has(alias)) continue;
      const table = map.get(alias);
      if (!table) continue;               // unbindable: say nothing
      add(table, col, alias);
    }

    // UNQUALIFIED COLUMNS, but only when the statement names exactly ONE table.
    //
    // This is the gap that let `SELECT id FROM connections WHERE ... AND
    // deleted_at IS NULL` through a clean run: neither column is qualified, so
    // the alias.column scan above never sees them, and connections has neither.
    // With one table in scope there is nothing else a bare name could belong to,
    // so the ambiguity that makes this dangerous elsewhere is absent.
    //
    // A DOTTED REFERENCE IS NOT A BARE ONE. Every pattern below is anchored so
    // the column half of `alias.column` cannot be harvested as an unqualified
    // name: a word boundary sits immediately after the dot, so `v.card IS NULL`
    // read as `card IS NULL` and blamed the only bound table for it. That is how
    // a VALUES alias -- `FROM (VALUES ...) AS v(external_id, city, notes, card)`,
    // whose alias this binder deliberately does not bind -- reported
    // contacts.notes and contacts.card as missing columns against code that has
    // been correct all along. A false positive here is expensive: it is the
    // second time this audit has cried wolf, and an audit nobody believes is off.
    //
    // Restricted to the clause shapes where a bare identifier is a column and
    // little else: the INSERT column list, SET assignments, and the left side of
    // a comparison or an IS.
    const tablesInScope = new Set(map.values());
    if (tablesInScope.size === 1) {
      const table = [...tablesInScope][0];
      const bare = new Set();
      for (const m of sql.matchAll(/INSERT\s+INTO\s+[a-z_][a-z0-9_]*\s*\(([^)]*)\)/gi)) {
        for (const c of m[1].split(",")) bare.add(c.trim().toLowerCase());
      }
      for (const m of sql.matchAll(/\bSET\s+(?<!\.)([a-z_][a-z0-9_]*)\s*=/gi)) bare.add(m[1].toLowerCase());
      for (const m of sql.matchAll(/,\s*(?<!\.)([a-z_][a-z0-9_]*)\s*=\s*/gi)) bare.add(m[1].toLowerCase());
      for (const m of sql.matchAll(/(?<![.\w])([a-z_][a-z0-9_]*)\s+IS\s+(?:NOT\s+)?NULL\b/gi)) bare.add(m[1].toLowerCase());
      for (const m of sql.matchAll(/\b(?:WHERE|AND|OR)\s+(?<!\.)([a-z_][a-z0-9_]*)\s*(?:=|<>|!=|>=|<=|>|<)\s*\$/gi)) {
        bare.add(m[1].toLowerCase());
      }
      for (const col of bare) {
        if (!col || NOT_A_COLUMN.has(col)) continue;
        add(table, col, "unqualified");
      }
    }
  }
}

console.log(`\n  ${TABLES.size} tables, ${files.length} files scanned.\n`);
if (findings.length === 0) {
  console.log("  Every column reference this audit could bind exists.\n");
  console.log("  Silence is not proof: aliases it cannot bind are skipped on purpose.\n");
  process.exit(0);
}

if (argv.includes("--by-file")) {
  const byFile = new Map();
  for (const f of findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }
  console.log(`  ${findings.length} reference(s) to columns that do not exist:\n`);
  for (const [file, list] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${file}  (${list.length})`);
    for (const f of list) console.log(`      ${f.table}.${f.col}   (as ${f.alias})`);
  }
} else {
  console.log(`  ${findings.length} reference(s) to columns that do not exist:\n`);
  for (const f of findings.sort((a, b) => `${a.table}.${a.col}`.localeCompare(`${b.table}.${b.col}`))) {
    console.log(`    ${`${f.table}.${f.col}`.padEnd(46)}${f.file}`);
  }
}
console.log("");
process.exit(1);
