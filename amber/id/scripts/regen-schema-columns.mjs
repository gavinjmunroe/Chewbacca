/**
 * REGENERATE db/schema-columns.json FROM THE LIVE SCHEMA.
 *
 *   railway run node scripts/regen-schema-columns.mjs
 *
 * column-drift-audit.mjs checks every `alias.column` in the codebase against
 * this file, so a stale snapshot makes the audit pass by looking at the wrong
 * schema. It has to be regenerated after every migration.
 *
 * WHY THIS EXISTS RATHER THAN THE psql ONE-LINER in column-drift-audit.mjs's
 * header: that command cannot run against this database. Production is Cloud
 * SQL, reached through @google-cloud/cloud-sql-connector using the AMBER_SQL_*
 * variables. There is no DATABASE_URL, so psql ignores the lot, tries the local
 * unix socket, and fails with "No such file or directory" -- which reads like a
 * broken machine rather than a command that was never going to work.
 *
 * Same query, same output shape, through the connection the app itself uses.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { query, closePool } from "../src/db/sql.js";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "schema-columns.json");

try {
  const { rows } = await query(
    `SELECT table_name, column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position`,
    [],
  );

  const schema = {};
  for (const { table_name: t, column_name: c, data_type: d } of rows) {
    (schema[t] ??= {})[c] = d;
  }

  const tables = Object.keys(schema);
  // A snapshot of almost nothing would silently disarm the audit, so refuse to
  // write one rather than hand the next person a green check that means nothing.
  if (tables.length < 30) {
    throw new Error(`only ${tables.length} tables came back; refusing to overwrite the snapshot`);
  }

  writeFileSync(OUT, `${JSON.stringify(schema)}\n`, "utf8");
  console.log(`wrote ${tables.length} tables, ${rows.length} columns to db/schema-columns.json`);
} finally {
  await closePool();
}
