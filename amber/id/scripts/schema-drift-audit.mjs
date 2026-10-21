/**
 * WHAT STILL POINTS AT A TABLE THAT WILL NOT EXIST.
 *
 * Teardown drops everything and the 16 new migrations build 62 tables. Any SQL
 * left in src/ naming a table outside that set is a 500 waiting for the first
 * request that reaches it -- and because most of these stores swallow their
 * errors, it is a 500 that will look like an empty list.
 *
 * This reads the migrations for the truth about what will exist, then reads every
 * .js file in src/ for the tables they name, and prints the difference. Static
 * and approximate by nature: it finds table names in FROM / JOIN / INTO /
 * UPDATE / DELETE FROM positions, which is where they are.
 *
 *     node scripts/schema-drift-audit.mjs
 *     node scripts/schema-drift-audit.mjs --by-table
 *
 * Exit code 1 when anything references a missing table, so it can gate a deploy.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const MIGRATIONS = path.join(ROOT, "db", "migrations");
const SRC = path.join(ROOT, "src");

// ── what the new schema will contain ─────────────────────────────────────────
// EVERY migration, not a date prefix.
//
// This used to filter on `20260828_`, the date of the rebuild, which was the
// whole set on the day it was written. It has not been the whole set since the
// first migration after it: blocked_handles (20260913), calendar_accounts
// (20260911) and every other table added in the last month were reported as
// MISSING by a gate whose entire job is spotting missing tables. An audit that
// cries wolf about real tables gets ignored, and then it is not an audit.
//
// db/migrations/_archive is not read, matching scripts/migrate.js: only *.sql
// directly in the directory is ever applied.
// Read like tables to a FROM/INTO scanner, are not tables. Postgres system
// catalogs and the set-returning functions used to turn jsonb back into rows.
const NOT_TABLES = new Set([
  "pg_index", "pg_attribute", "pg_constraint", "pg_class", "pg_namespace",
  "pg_indexes", "pg_type", "information_schema",
  "jsonb_populate_record", "jsonb_populate_recordset", "jsonb_array_elements",
  "jsonb_to_recordset", "json_populate_recordset", "unnest", "generate_series",
  "regexp_split_to_table", "amber_membership_bootstrap",
]);

const willExist = new Set(["schema_migrations", "smoke_marker"]);
for (const f of fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
  const sql = fs.readFileSync(path.join(MIGRATIONS, f), "utf8");
  for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_]*)"?/gi)) {
    willExist.add(m[1].toLowerCase());
  }
}

// ── what src/ asks for ───────────────────────────────────────────────────────
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".js") && !e.name.endsWith(".test.js")) files.push(p);
  }
})(SRC);

/**
 * ONLY LOOK INSIDE SQL. The first version of this scanned whole files and
 * reported 266 "missing tables" including `the`, `a`, `your` and `anthropic` --
 * because prose in a comment says "update set" and "from the" as readily as SQL
 * does. Strip the comments, then look only inside template literals, which is
 * where every query in this codebase lives.
 */
function sqlChunks(text) {
  const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, " ");
  const noLine = noBlock.replace(/^[ \t]*\/\/.*$/gm, " ").replace(/([^:])\/\/.*$/gm, "$1");
  const out = [];
  for (const m of noLine.matchAll(/`([^`]*)`/g)) {
    const body = m[1];
    // A template literal is SQL if it reads like SQL. Without this every
    // backticked log line joins the scan.
    // A prompt string can say SELECT and FROM as easily as a query can, and
    // several in routes/chat.js do. Real SQL here either binds a parameter or is
    // DDL; prose does neither, and requiring that removed every false positive
    // (`the`, `a`, `training`, `knowledge`) without hiding a single real one.
    const looksSql = /\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/i.test(body);
    const isDdl = /\b(CREATE|ALTER)\s+TABLE\b/i.test(body);
    const binds = /\$\d/.test(body);
    if (isDdl || (looksSql && binds)) {
      // Strip SQL's own -- comments. The prose inside them says "from the" too,
      // and this file's whole job is to not report `the` as a missing table.
      out.push(defuseOperatorFrom(body.replace(/--[^\n]*/g, " ")));
    }
  }
  return out;
}

/**
 * SQL SPELLS SEVERAL THINGS THAT ARE NOT TABLES WITH THE WORD `FROM`, and this
 * audit assumes the next identifier after FROM is a table. Two of them turned up
 * in contact-rollup.js and were reported as missing tables:
 *
 *   extract(epoch FROM now() - x)   ->  `now`
 *   a IS DISTINCT FROM b.contact_id ->  `b`
 *
 * Both are correct, ordinary SQL. The fix belongs here rather than in the query,
 * because the alternative is writing worse SQL to satisfy a grep.
 *
 * This is the complete list of SQL's non-table FROMs: the IS DISTINCT FROM
 * operator, and the four functions whose arguments are separated by keywords
 * instead of commas. Gluing an underscore to the front of the keyword kills the
 * \b in the scanning pattern without changing any identifier around it.
 *
 * The function form stops at a parenthesis, so `extract(epoch FROM f(x))` is
 * handled and a FROM behind a nested call is not. That fails toward a false
 * positive -- a name reported that is not a table -- never toward missing a real
 * one, which is the direction this audit should fail in.
 */
function defuseOperatorFrom(sql) {
  return sql
    .replace(/\bIS(\s+NOT)?\s+DISTINCT\s+FROM\b/gi, (s) => s.replace(/FROM$/i, "_FROM"))
    .replace(/\b(EXTRACT|SUBSTRING|TRIM|OVERLAY)(\s*\([^()]*?)\bFROM\b/gi, "$1$2_FROM");
}

// Words that follow FROM/JOIN but are not tables: subqueries, VALUES lists, the
// set-returning functions, and CTE names defined in the same statement.
const NOT_A_TABLE = new Set([
  "select", "values", "unnest", "lateral", "jsonb_array_elements", "generate_series",
  "jsonb_to_recordset", "json_array_elements", "regexp_split_to_table", "string_to_table",
  "dual", "only",
  // `ON CONFLICT ... DO UPDATE SET` puts SET where a table name goes, and
  // `FOR UPDATE SKIP LOCKED` puts SKIP there.
  "set", "skip", "of", // FOR UPDATE OF alias locks rows; OF is not a table.
]);

/**
 * The last of the prose. An LLM prompt that binds a parameter and contains the
 * word SELECT clears every other filter -- fact-capture.js has one that says
 * "extract EVERYTHING from the body". A table name in this schema is a lowercase
 * identifier that is not an ordinary English word, so the handful of words that
 * can follow FROM in a sentence are listed rather than guessed at.
 */
const ENGLISH = new Set([
  "the", "a", "an", "that", "this", "these", "those", "it", "its", "them",
  "their", "your", "our", "his", "her", "empty", "here", "there", "one", "two",
  "both", "each", "any", "all", "in", "with", "what", "which", "when", "where",
  "memory", "knowledge", "training", "general", "small", "soft", "live",
]);

const PATTERN =
  /\b(?:FROM|JOIN|INTO|UPDATE|DELETE\s+FROM)\s+(?:ONLY\s+)?"?([a-z_][a-z0-9_]*)"?/gi;

const hits = new Map(); // table -> Map(file -> count)
for (const file of files) {
  const text = sqlChunks(fs.readFileSync(file, "utf8")).join("\n;\n");
  if (!text) continue;
  // CTE names are locally defined and must not be reported as missing tables.
  const ctes = new Set(
    [...text.matchAll(/\bWITH\s+([a-z_][a-z0-9_]*)\s+AS\s*\(/gi)].map((m) => m[1].toLowerCase()),
  );
  for (const m of text.matchAll(/,\s*([a-z_][a-z0-9_]*)\s+AS\s*\(\s*SELECT/gi)) {
    ctes.add(m[1].toLowerCase());
  }
  // A CTE built from a template fragment: `WITH ${SOME_CTE}` puts the name a
  // line later than the two patterns above expect. retrieval.js does exactly
  // that, and the audit called its own CTE a missing table.
  for (const m of text.matchAll(/^\s*([a-z_][a-z0-9_]*)\s+AS\s*\(/gim)) {
    ctes.add(m[1].toLowerCase());
  }
  // `AS v(id, ...)` and friends: an alias for a VALUES list, not a table.
  for (const m of text.matchAll(/\bAS\s+([a-z_][a-z0-9_]*)\s*\(/gi)) ctes.add(m[1].toLowerCase());
  // A RECURSIVE CTE, which declares its columns before AS:
  //   WITH RECURSIVE walk(amber_id, degree) AS (...)
  // None of the patterns above see that name -- they all expect AS to follow
  // the identifier directly -- so the graph traversal in network-degree.js had
  // its own CTE reported as a missing table, twice, along with its alias.
  for (const m of text.matchAll(/\bWITH\s+RECURSIVE\s+([a-z_][a-z0-9_]*)\s*\(/gi)) {
    ctes.add(m[1].toLowerCase());
  }
  // The short alias a recursive CTE is joined back to itself under: `FROM walk w`
  // and `FROM w`. Only for names already known to be a CTE, so this cannot
  // excuse a real table.
  for (const name of [...ctes]) {
    for (const m of text.matchAll(new RegExp(`\\b${name}\\s+([a-z_][a-z0-9_]{0,2})\\b`, "gi"))) {
      ctes.add(m[1].toLowerCase());
    }
  }
  for (const m of text.matchAll(PATTERN)) {
    const t = m[1].toLowerCase();
    if (NOT_A_TABLE.has(t) || ENGLISH.has(t) || ctes.has(t)) continue;
    if (willExist.has(t) || NOT_TABLES.has(t)) continue;
    if (!hits.has(t)) hits.set(t, new Map());
    const per = hits.get(t);
    const rel = path.relative(ROOT, file);
    per.set(rel, (per.get(rel) ?? 0) + 1);
  }
}

// ── report ───────────────────────────────────────────────────────────────────
const byTable = process.argv.includes("--by-table");
const tables = [...hits.entries()].sort((a, b) => {
  const ca = [...a[1].values()].reduce((x, y) => x + y, 0);
  const cb = [...b[1].values()].reduce((x, y) => x + y, 0);
  return cb - ca;
});

console.log(`\n  ${willExist.size - 2} tables will exist after migrate.`);
if (tables.length === 0) {
  console.log(`  Nothing in src/ references a table outside that set.\n`);
  process.exit(0);
}

const totalRefs = tables.reduce(
  (a, [, per]) => a + [...per.values()].reduce((x, y) => x + y, 0), 0);
console.log(
  `  ${tables.length} missing tables, ${totalRefs} references, ` +
  `across ${new Set(tables.flatMap(([, per]) => [...per.keys()])).size} files.\n`);

if (byTable) {
  for (const [t, per] of tables) {
    const n = [...per.values()].reduce((x, y) => x + y, 0);
    console.log(`  ${t}  (${n})`);
    for (const [f, c] of [...per.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`      ${String(c).padStart(3)}  ${f}`);
    }
  }
} else {
  const byFile = new Map();
  for (const [t, per] of tables) {
    for (const [f, c] of per) {
      if (!byFile.has(f)) byFile.set(f, new Map());
      byFile.get(f).set(t, c);
    }
  }
  const ordered = [...byFile.entries()].sort((a, b) => {
    const sa = [...a[1].values()].reduce((x, y) => x + y, 0);
    const sb = [...b[1].values()].reduce((x, y) => x + y, 0);
    return sb - sa;
  });
  for (const [f, ts] of ordered) {
    const n = [...ts.values()].reduce((x, y) => x + y, 0);
    console.log(`  ${f}  (${n})`);
    console.log(`      ${[...ts.keys()].sort().join(", ")}`);
  }
}
console.log("");
process.exit(1);
