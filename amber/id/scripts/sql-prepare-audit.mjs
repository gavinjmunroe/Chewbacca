/**
 * SQL PREPARE AUDIT — hand every query in the codebase to Postgres and see if it
 * is even legal.
 *
 *   SMOKE_DATABASE_URL=postgres://.../scratch node scripts/sql-prepare-audit.mjs
 *   ... --verbose      every failure with its SQL
 *   ... --skipped      what it could not check, and why
 *
 * WHY THIS EXISTS, WHEN TWO OTHER AUDITS ALREADY DO. schema-drift-audit checks
 * table names. column-drift-audit checks column names. Both are regexes over
 * source text, and between them they still missed:
 *
 *   circles.id is uuid and the code coerced it with Number() -> NaN
 *   ANY($1::bigint[]) against a uuid column
 *   LEAST($1, $2) typing its parameters as text, then assigned to uuid
 *
 * None of those are wrong NAMES. They are wrong TYPES, and no amount of grepping
 * for identifiers will ever see them. Karthik's words: "this UUID stuff is
 * causing issues everywhere, we need to make sure that's fully fixed."
 *
 * PREPARE IS THE FIX, and it is not a heuristic. Postgres parses the statement,
 * resolves every name against the real catalog, infers every parameter type and
 * checks every assignment and cast -- then throws the statement away. No rows are
 * read, nothing is written, and it needs no test data. If a query would fail at
 * runtime for any reason the schema can know about, it fails here first.
 *
 * WHAT IT CANNOT CHECK, stated plainly because a silent gap is how the last three
 * bugs survived. Queries are assembled with ${...} interpolation, so they are not
 * literal SQL. Two kinds are reconstructed: numeric constants (KEY_TYPE.PHONE and
 * friends) and module-level SQL fragments resolved by name -- which is what brings
 * VIEWER_REACH_SQL, _VIEWER_REACH, INTERACTION_STREAM and QUERY_WEIGHTS_CTE under
 * the check, and those are the statements that decide who can read what.
 *
 * What remains skipped is SQL built from a runtime expression -- a column list
 * chosen by a variable, a UNION whose arms are joined from an array. Those are
 * COUNTED on every run and listed by --skipped, because a clean run means "every
 * statement I could reconstruct is legal" and never "everything is fine".
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * MATERIALIZE THE SERVICE-ACCOUNT JSON BEFORE sql.js IS IMPORTED.
 *
 * Every other script in here that touches the real database opens with this
 * block, and migrate.js says why in capitals: it MUST happen before sql.js is
 * imported. I left it out of the first version of this file, so
 * `railway run ... sql-prepare-audit.mjs` skipped the Railway service account,
 * fell through to whoever's personal gcloud credentials were lying around, and
 * died on `invalid_grant: reauth related error (invalid_rapt)` -- a Google auth
 * failure with a forty-line stack trace, which looks nothing like the actual
 * cause and wasted Karthik's time rather than mine.
 *
 * The temp file is 0600 and holds only what Railway already put in the
 * environment. It is not written anywhere durable and never gets committed.
 */
{
  const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
    const tmp = path.join(os.tmpdir(), "gcp-sa-sql-audit.json");
    fs.writeFileSync(tmp, credsJson, { mode: 0o600 });
    process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
  }
}
const argv = process.argv.slice(2);
const VERBOSE = argv.includes("--verbose");
const SHOW_SKIPPED = argv.includes("--skipped");

/**
 * TWO WAYS TO CONNECT, and this is the one script in scripts/ that is allowed to
 * reach a real database.
 *
 *   SMOKE_DATABASE_URL=...  a scratch database, by DSN
 *   otherwise               the app's own pool, so:
 *     railway run env AMBER_SQL_DB=amber_next node scripts/sql-prepare-audit.mjs
 *
 * The smoke scripts are gated behind SMOKE_DATABASE_URL and a smoke_marker table
 * because they TRUNCATE. This one PREPAREs and DEALLOCATEs: no rows are read, no
 * rows are written, no statement is ever executed. Auditing the schema you are
 * actually about to cut over to is the whole point, and a scratch database can
 * only tell you about a scratch database.
 */
const dsn = process.env.SMOKE_DATABASE_URL || null;

// SAY WHAT IS MISSING, rather than letting the Cloud SQL connector fail forty
// lines deep. Either a DSN or the app's four variables; nothing else works, and a
// clear refusal beats a GaxiosError every time.
if (!dsn) {
  const need = ["AMBER_SQL_CONNECTION_NAME", "AMBER_SQL_DB", "AMBER_SQL_USER",
                "AMBER_SQL_PASSWORD"].filter((k) => !process.env[k]);
  if (need.length) {
    console.error(
      `\n  No database to audit against.\n\n` +
      `  Either point it at a scratch database:\n` +
      `      SMOKE_DATABASE_URL=postgres://user@host:5432/scratch \\\n` +
      `        node scripts/sql-prepare-audit.mjs\n\n` +
      `  or run it with the app's environment:\n` +
      `      railway run env AMBER_SQL_DB=amber_next \\\n` +
      `        node scripts/sql-prepare-audit.mjs\n\n` +
      `  Missing: ${need.join(", ")}\n`,
    );
    process.exit(2);
  }
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON &&
      !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error(
      `\n  The Cloud SQL connector has no credentials.\n\n` +
      `  GOOGLE_APPLICATION_CREDENTIALS_JSON is not set, so it will fall back to\n` +
      `  your personal gcloud login -- which is what produced\n` +
      `  "invalid_grant: reauth related error (invalid_rapt)".\n\n` +
      `  Run it through Railway so the service account is in the environment:\n` +
      `      railway run env AMBER_SQL_DB=amber_next \\\n` +
      `        node scripts/sql-prepare-audit.mjs\n\n` +
      `  Or, if you do mean to use your own login: gcloud auth application-default login\n`,
    );
    process.exit(2);
  }
}

// Constants that appear inside SQL via interpolation. Values, not names, because
// what Postgres needs is the literal that will actually be sent.
const KNOWN = {
  "KEY_TYPE.PHONE": "1",
  "KEY_TYPE.EMAIL": "2",
  "KEY_TYPE.SOURCE": "3",
  "NEUTRAL_MATCH": "0.35",
  "MAX_DIMENSIONS": "3",
};

/**
 * MODULE-LEVEL SQL FRAGMENTS, collected by name across the whole tree.
 *
 * The first version skipped every statement built from a fragment, and those are
 * exactly the statements worth checking: _VIEWER_REACH, VIEWER_REACH_SQL,
 * INTERACTION_STREAM, QUERY_WEIGHTS_CTE -- the authorization predicates and the
 * rollup. Thirty statements unverified, including every one that decides who can
 * read what.
 *
 * So fragments are resolved instead. Collected globally rather than per file
 * because a fragment is often imported from the module that owns the rule, which
 * is the point of having one copy of it. Name collisions are the risk; a wrong
 * substitution produces a SYNTAX error, which is reported as skipped rather than
 * as a finding, so the failure direction is a gap and never a false alarm.
 */
function collectFragments(fileList) {
  const frags = new Map();
  for (const f of fileList) {
    const text = fs.readFileSync(f, "utf8");
    for (const m of text.matchAll(/\bconst\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*`([^`]*)`\s*;/g)) {
      const body = m[2];
      // Only things that look like SQL. A backticked log line is not a fragment.
      if (!/\b(SELECT|FROM|WHERE|JOIN|WITH|INSERT|UPDATE|DELETE|AND|OR)\b/i.test(body)) continue;
      frags.set(m[1], body);
    }
    // A column list is a fragment too, even without a SQL keyword in it:
    // `id, owner_id, awaiting, ...` is what PFC_COLS is.
    for (const m of text.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*`([^`]*)`\s*;/g)) {
      const body = m[2];
      if (frags.has(m[1])) continue;
      if (/^[\s\w.,*()'"|:>=<-]+$/.test(body) && body.includes(",")) frags.set(m[1], body);
    }
    // Numeric module constants interpolated into SQL (DIMS = 1536).
    for (const m of text.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*(-?\d+(?:\.\d+)?)\s*;/g)) {
      if (!frags.has(m[1])) frags.set(m[1], m[2]);
    }
  }
  // ALIASES: `export const VIEWER_REACH_SQL = _VIEWER_REACH;` is how the one copy
  // of the share-reach rule gets its public name, and without this the statement
  // that authorizes note AUDIO stayed unchecked.
  for (let pass = 0; pass < 3; pass++) {
    for (const f of fileList) {
      const text = fs.readFileSync(f, "utf8");
      for (const m of text.matchAll(
        /\b(?:export\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z_][A-Za-z0-9_]*)\s*;/g)) {
        if (!frags.has(m[1]) && frags.has(m[2])) frags.set(m[1], frags.get(m[2]));
      }
    }
  }
  return frags;
}

const files = [];
(function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules") walk(p); }
    else if (e.name.endsWith(".js") && !e.name.endsWith(".test.js")) files.push(p);
  }
})(path.join(ROOT, "src"));

function sqlChunks(text) {
  const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, " ");
  const noLine = noBlock.replace(/^[ \t]*\/\/.*$/gm, " ").replace(/([^:])\/\/.*$/gm, "$1");
  const out = [];
  for (const m of noLine.matchAll(/`([^`]*)`/g)) {
    const body = m[1];
    const isDml = /^\s*(?:WITH|SELECT|INSERT|UPDATE|DELETE)\b/i.test(body.trim());
    if (!isDml) continue;
    out.push(body.replace(/--[^\n]*/g, " "));
  }
  return out;
}

/**
 * Resolve interpolations, or say why it cannot be done.
 *
 * Recursive, with a depth cap: a fragment can contain a fragment (the rollup's
 * stream sits inside a CTE that sits inside an INSERT), and a cap is cheaper than
 * reasoning about whether anything is cyclic.
 */
function resolve(sql, frags, depth = 0) {
  const holes = [...sql.matchAll(/\$\{([^}]*)\}/g)];
  if (holes.length === 0) return { sql, ok: true };
  if (depth > 6) return { ok: false, reason: "fragment nesting deeper than 6" };
  let out = sql;
  for (const h of holes) {
    const expr = h[1].trim();
    if (KNOWN[expr] !== undefined) { out = out.replace(h[0], KNOWN[expr]); continue; }
    // A bare numeric literal interpolated for readability.
    if (/^-?\d+(\.\d+)?$/.test(expr)) { out = out.replace(h[0], expr); continue; }
    // A module-level SQL fragment, by name.
    if (frags.has(expr)) { out = out.replace(h[0], frags.get(expr)); continue; }
    return { ok: false, reason: `interpolated SQL fragment \${${expr}}` };
  }
  return resolve(out, frags, depth + 1);
}

const FRAGMENTS = collectFragments(files);

/**
 * ONE CONNECTION FOR THE WHOLE RUN, INSIDE ONE TRANSACTION.
 *
 * The first version checked out a client per statement and issued PREPARE then
 * DEALLOCATE as two separate round trips. Against a local scratch database that
 * is invisible. Against Cloud SQL through the connector it is two network round
 * trips times four hundred statements, and Karthik watched it print a header and
 * then apparently hang for minutes. It was not hung; it was silent, which for a
 * long remote job is the same thing from the outside.
 *
 * So: one checked-out client, one transaction, and NO DEALLOCATE -- a rollback
 * discards every prepared statement, which is both faster and tidier than naming
 * them all again. PREPARE is per-session, so holding one session is also the only
 * way the statement names mean anything.
 *
 * The transaction is rolled back unconditionally. Nothing here writes, and a
 * rollback makes that structural rather than a claim.
 */
let acquire;      // () => Promise<{ client, done }>
let closePool;
if (dsn) {
  const pool = new pg.Pool({ connectionString: dsn, max: 1 });
  acquire = async () => {
    const client = await pool.connect();
    await client.query("BEGIN");
    return { client, done: async () => {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    } };
  };
  closePool = () => pool.end();
} else {
  const sql = await import("../src/db/sql.js");
  // withTransaction owns the client's lifetime, so the client is handed out
  // through a promise that resolves inside it and released when we say so.
  acquire = async () => {
    let client, release;
    const held = new Promise((r) => { release = r; });
    const running = sql.withTransaction(async (c) => {
      client = c;
      await held;
      // Thrown so withTransaction ROLLBACKs rather than COMMITs. Nothing here
      // wrote anything; this just makes "no writes" structural.
      throw new Error("__audit_rollback__");
    }).catch((e) => { if (e?.message !== "__audit_rollback__") throw e; });
    // Wait for withTransaction to hand us the client.
    while (!client) await new Promise((r) => setImmediate(r));
    return { client, done: async () => { release(); await running; } };
  };
  closePool = async () => (await import("../src/db/sql.js")).closePool();
}

const { client: db, done: releaseDb } = await acquire();

const { rows: dbRows } = await db.query(
  `SELECT current_database() AS db,
          (SELECT count(*)::int FROM pg_tables WHERE schemaname='public') AS tables`);
console.log(`\n  PREPARE against "${dbRows[0].db}" (${dbRows[0].tables} tables), ` +
            `${FRAGMENTS.size} SQL fragment(s) resolvable by name\n`);

let checked = 0;
const failures = [];
const skipped = [];
let n = 0;

// PROGRESS, because a job that prints nothing for four minutes is
// indistinguishable from a job that has hung -- and that is exactly how this
// looked the first time it ran against Cloud SQL.
const QUIET = process.argv.includes("--quiet");
let fileNo = 0;
for (const file of files) {
  const rel = path.relative(ROOT, file);
  const chunks = sqlChunks(fs.readFileSync(file, "utf8"));
  fileNo += 1;
  if (!QUIET && chunks.length) {
    process.stdout.write(
      `\r  [${String(fileNo).padStart(3)}/${files.length}] ${rel.slice(-56).padEnd(58)}`);
  }
  for (const raw of chunks) {
    const r = resolve(raw, FRAGMENTS);
    if (!r.ok) { skipped.push({ file: rel, reason: r.reason, sql: raw }); continue; }
    const name = `_audit_${n++}`;
    try {
      // PREPARE only. The statement is parsed, resolved and planned, and the
      // rollback at the end discards it. Nothing is ever executed.
      //
      // SAVEPOINT around it: one failed statement inside a transaction poisons
      // the rest ("current transaction is aborted"), which would have turned the
      // first finding into four hundred identical ones.
      await db.query(`SAVEPOINT s${name}`);
      try {
        await db.query(`PREPARE ${name} AS ${r.sql}`);
        await db.query(`RELEASE SAVEPOINT s${name}`);
      } catch (e) {
        await db.query(`ROLLBACK TO SAVEPOINT s${name}`);
        throw e;
      }
      checked += 1;
    } catch (err) {
      // A syntax error on a fragment we mis-reconstructed is not a finding about
      // the codebase, so it is reported as skipped rather than as a failure.
      if (err.code === "42601") {
        skipped.push({ file: rel, reason: `could not reconstruct (syntax): ${err.message}`, sql: r.sql });
      } else {
        failures.push({ file: rel, code: err.code, message: err.message, sql: r.sql });
      }
    }
  }
}

// ── report ───────────────────────────────────────────────────────────────────
const byCode = new Map();
for (const f of failures) {
  if (!byCode.has(f.code)) byCode.set(f.code, []);
  byCode.get(f.code).push(f);
}
const CODE_MEANING = {
  "42703": "column does not exist",
  "42P01": "table does not exist",
  "42883": "no such function / operator for these types",
  "42804": "type mismatch in an assignment",
  "42P18": "parameter type could not be determined",
  "42846": "cast is not possible",
  "42702": "column reference is ambiguous",
  "42P02": "no such parameter",
};

if (!QUIET) process.stdout.write(`\r${" ".repeat(78)}\r`);
console.log(`  ${checked} statement(s) PREPAREd successfully.`);
console.log(`  ${failures.length} FAILED.`);
console.log(`  ${skipped.length} skipped — ${skipped.length ? "see --skipped" : "none"}.\n`);

if (failures.length) {
  for (const [code, list] of [...byCode].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${code}  ${CODE_MEANING[code] ?? "see the message"}  (${list.length})`);
    const seen = new Set();
    for (const f of list) {
      const key = `${f.file}|${f.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`      ${f.file}`);
      console.log(`        ${f.message}`);
      if (VERBOSE) console.log(f.sql.split("\n").map((l) => `        | ${l}`).join("\n"));
    }
    console.log("");
  }
}

if (SHOW_SKIPPED && skipped.length) {
  console.log(`  SKIPPED (${skipped.length}) — NOT verified, and not claimed to be:\n`);
  const byFile = new Map();
  for (const s of skipped) {
    if (!byFile.has(s.file)) byFile.set(s.file, []);
    byFile.get(s.file).push(s);
  }
  for (const [file, list] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${file}  (${list.length})`);
    for (const s of list) console.log(`      ${s.reason}`);
  }
  console.log("");
}

await releaseDb().catch(() => {});
await closePool().catch(() => {});
process.exit(failures.length ? 1 : 0);
