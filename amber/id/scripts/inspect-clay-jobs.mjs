/**
 * WHAT DID 20261004_059_clay_jobs.sql ACTUALLY CREATE?
 *
 * That migration is recorded in schema_migrations as applied, and the file is
 * not in this checkout or anywhere in git history. `npm run migrate -- --seal`
 * would write its name into db/migrations/APPLIED.sha256, and
 * src/db/migrations-immutable.test.js fails on a sealed name with no file --
 * on every npm test, forever. So the file has to be reconstructed first.
 *
 * This reads the live schema for whatever it left behind, so a byte-equivalent
 * replacement can be written. It is read-only.
 *
 *   railway run node scripts/inspect-clay-jobs.mjs
 *
 * psql cannot do this job: the database is Cloud SQL, reached through
 * @google-cloud/cloud-sql-connector with the AMBER_SQL_* variables. There is no
 * DATABASE_URL for psql to use, so it tries a local socket and fails.
 */
import { query, closePool } from "../src/db/sql.js";

const TABLES = `
  SELECT table_name FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name LIKE '%clay%'
   ORDER BY table_name`;

const COLUMNS = `
  SELECT table_name, ordinal_position, column_name, data_type,
         is_nullable, column_default
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = ANY($1)
   ORDER BY table_name, ordinal_position`;

const CONSTRAINTS = `
  SELECT rel.relname AS table_name, con.conname, pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
   WHERE ns.nspname = 'public' AND rel.relname = ANY($1)
   ORDER BY rel.relname, con.conname`;

const INDEXES = `
  SELECT tablename AS table_name, indexname, indexdef
    FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = ANY($1)
   ORDER BY tablename, indexname`;

const LEDGER = `
  SELECT filename, applied_at, checksum
    FROM schema_migrations
   ORDER BY filename`;

try {
  const names = (await query(TABLES, [])).rows.map((r) => r.table_name);
  console.log("\n== tables matching %clay% ==");
  console.log(names.length ? names.join("\n") : "(none)");

  if (names.length) {
    for (const [label, sql] of [
      ["columns", COLUMNS],
      ["constraints", CONSTRAINTS],
      ["indexes", INDEXES],
    ]) {
      console.log(`\n== ${label} ==`);
      console.table((await query(sql, [names])).rows);
    }
  }

  // The ledger row itself: its checksum is the sha256 of the bytes that ran, so
  // a reconstruction can be checked against it rather than hoped about.
  const ledger = (await query(LEDGER, [])).rows.filter((r) =>
    String(r.filename).includes("clay"),
  );
  console.log("\n== schema_migrations rows mentioning clay ==");
  console.log(ledger.length ? JSON.stringify(ledger, null, 2) : "(none)");
} finally {
  await closePool();
}
