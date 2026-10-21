/**
 * REGENERATE db/schema-columns.json FROM THE LIVE DATABASE.
 *
 *   railway run node scripts/dump-schema-columns.js
 *
 * READ-ONLY against the database; the only thing it writes is the snapshot file.
 *
 * WHY THIS EXISTS. column-drift-audit.mjs checks every `alias.column` in every SQL
 * template against a SNAPSHOT of the schema rather than a live connection, so it
 * can run in CI with no database. That snapshot is now older than the newest
 * migration, so the audit refuses to run at all -- and a column-level check that
 * refuses to run is indistinguishable from one that passes if nobody reads the
 * first two lines. It was the check that would have caught a query selecting a
 * column a migration had deleted.
 *
 * The header of column-drift-audit.mjs documents a psql one-liner for this. That
 * one-liner needs a psql that can reach Cloud SQL; this does the same thing
 * through the pool the app already uses.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-dump-schema.json");
  fs.writeFileSync(tmp, credsJson, { mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const sql = await import("../src/db/sql.js");

const { rows } = await sql.query(
  `SELECT table_name, column_name, data_type
     FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, column_name`);

const out = {};
for (const r of rows) {
  (out[r.table_name] ??= {})[r.column_name] = r.data_type;
}

const target = path.join(
  path.dirname(fileURLToPath(import.meta.url)), "..", "db", "schema-columns.json");
fs.writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);

const tables = Object.keys(out).length;
const columns = rows.length;
console.log(`\n  wrote db/schema-columns.json   ${tables} tables, ${columns} columns\n`);
console.log(`  now run:  node scripts/column-drift-audit.mjs\n`);

await sql.closePool().catch(() => {});
