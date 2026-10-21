/**
 * TEARDOWN. Drops every table in the public schema except the migration ledger.
 *
 * WHY THIS IS A SCRIPT AND NOT A MIGRATION
 * A migration is something you run without thinking, because the runner applies
 * whatever is pending. This is not that. This destroys the database. It gets its
 * own command, its own confirmation flag, and its own name in your shell history
 * so that "what happened to the data" always has an answer.
 *
 * THE LEDGER: WHAT SURVIVES AND WHAT DOES NOT, AND WHY THAT CHANGED
 *
 * This script was written for the one-time cutover, when schema_migrations
 * recorded the 39 legacy migrations as applied and the new files were pending.
 * Dropping the whole ledger then would have made `migrate` replay all 39 against
 * an empty database, where 12 of them fail -- they ALTER tables that no migration
 * ever created, because users, circles, circle_members and eleven others existed
 * only because somebody made them by hand. So the ledger was kept entirely.
 *
 * THAT IS NOW WRONG, and the wrongness was silent. Since the 39 legacy files were
 * archived out of db/migrations/ they are never scanned, so they cannot be
 * replayed and there is nothing to protect against. Meanwhile the 21 CURRENT
 * files are all recorded as applied -- so teardown followed by migrate left an
 * EMPTY DATABASE THAT REPORTED ITSELF FULLY MIGRATED: one table, and
 * "up to date -- nothing pending". Worse than a half-migrated database, which at
 * least fails loudly.
 *
 * So the ledger is now pruned rather than kept whole: rows whose file still
 * exists in db/migrations/ are deleted, because those are exactly the files that
 * must run again; rows for archived files are left alone, because those files are
 * gone and the record of them is history worth keeping. Nothing else about this
 * script changes.
 *
 * THE ORDER, AND IT MATTERS
 *   1. railway run npm run migrate:status        -- see what is applied
 *   2. railway run node scripts/teardown.js      -- DRY RUN. lists, drops nothing
 *   3. railway run node scripts/teardown.js --confirm-destroy-all-data
 *   4. railway run npm run migrate               -- builds the new schema
 *   5. railway run node scripts/dump-schema.js   -- read back what you built
 *
 * Step 4 is now verified rather than assumed: teardown then migrate rebuilds to
 * 71 tables, and the new files deliberately do not say IF NOT EXISTS, so running
 * step 4 without step 3 fails loudly on `CREATE TABLE users` instead of quietly
 * half-applying.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)), "..", "db", "migrations");

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existing = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existing && fs.existsSync(existing))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-teardown.json");
  fs.writeFileSync(tmp, credsJson, { mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { query, withTransaction, closePool } = await import("../src/db/sql.js");

const CONFIRM = "--confirm-destroy-all-data";
const armed = process.argv.includes(CONFIRM);

// The ledger table itself survives; its rows for files that still exist do not.
// See "THE LEDGER" above.
const KEEP = new Set(["schema_migrations"]);

// The files migrate would scan: *.sql directly in db/migrations, never _archive.
// Same rule as the runner, deliberately duplicated rather than imported, because
// importing migrate.js would run it.
const currentMigrationFiles = fs.existsSync(MIGRATIONS_DIR)
  ? fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()
  : [];

try {
  const [{ db }] = (await query(`SELECT current_database() AS db`)).rows;

  const { rows: tables } = await query(`
    SELECT c.relname AS name,
           c.reltuples::bigint AS est_rows,
           pg_size_pretty(pg_total_relation_size(c.oid)) AS size
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
     ORDER BY 1`);

  const doomed = tables.filter((t) => !KEEP.has(t.name));

  console.log(`\n  database: ${db}`);
  console.log(`  ${doomed.length} tables will be DROPPED, ${tables.length - doomed.length} kept\n`);
  for (const t of doomed) {
    // reltuples is an estimate and -1 means never analyzed; count for real.
    let n;
    try {
      n = Number((await query(`SELECT count(*)::bigint AS n FROM "${t.name}"`)).rows[0].n);
    } catch { n = null; }
    console.log(`    drop   ${t.name.padEnd(34)}${String(n ?? "?").padStart(10)} rows   ${t.size}`);
  }
  for (const name of KEEP) {
    if (tables.some((t) => t.name === name)) console.log(`    KEEP   ${name}`);
  }

  // What the ledger prune would do, shown in the dry run, because "and then it
  // quietly edits the bookkeeping" is not something to discover afterwards.
  let willReplay = [];
  if (tables.some((t) => t.name === "schema_migrations") && currentMigrationFiles.length) {
    const { rows } = await query(
      `SELECT filename FROM schema_migrations WHERE filename = ANY($1) ORDER BY filename`,
      [currentMigrationFiles],
    );
    willReplay = rows.map((r) => r.filename);
    console.log(
      `\n  ledger: ${willReplay.length} of ${currentMigrationFiles.length} current file(s) ` +
        `recorded as applied — their rows will be REMOVED so migrate replays them.`,
    );
    const { rows: kept } = await query(
      `SELECT count(*)::int AS n FROM schema_migrations WHERE NOT (filename = ANY($1))`,
      [currentMigrationFiles],
    );
    if (kept[0].n) {
      console.log(
        `          ${kept[0].n} row(s) for archived files stay — those files are gone ` +
          `and cannot be replayed.`,
      );
    }
  }

  if (!armed) {
    console.log(`\n  DRY RUN — nothing was dropped.`);
    console.log(`  To actually destroy the above, re-run with:\n`);
    console.log(`      railway run node scripts/teardown.js ${CONFIRM}\n`);
    process.exit(0);
  }

  console.log(`\n  ${CONFIRM} given. Dropping...\n`);

  // ONE TRANSACTION. A teardown that fails halfway is worse than one that fails
  // at the start: CASCADE resolves dependency order for us, and a rollback puts
  // everything back exactly as it was.
  await withTransaction(async (client) => {
    await client.query("SET LOCAL statement_timeout = 0");
    for (const t of doomed) {
      await client.query(`DROP TABLE IF EXISTS "${t.name}" CASCADE`);
    }
    // Views, sequences and functions orphaned by the drops.
    const { rows: views } = await client.query(
      `SELECT table_name FROM information_schema.views WHERE table_schema = 'public'`,
    );
    for (const v of views) await client.query(`DROP VIEW IF EXISTS "${v.table_name}" CASCADE`);

    // IN THE SAME TRANSACTION AS THE DROPS. If the prune committed separately
    // and then failed, the database would be the exact state this change exists
    // to prevent: empty, and claiming to be migrated.
    if (currentMigrationFiles.length) {
      await client.query(`DELETE FROM schema_migrations WHERE filename = ANY($1)`,
                         [currentMigrationFiles]);
    }
  });

  const { rows: after } = await query(
    `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`,
  );
  const { rows: led } = await query(
    `SELECT count(*)::int AS n FROM schema_migrations`,
  ).catch(() => ({ rows: [{ n: 0 }] }));

  console.log(`  ✓ dropped ${doomed.length} tables.`);
  console.log(`  ✓ ${after[0].n} tables remain (expected 1: schema_migrations).`);
  console.log(
    `  ✓ ledger pruned: ${willReplay.length} row(s) removed, ${led[0].n} left ` +
      `(archived files only).`,
  );
  console.log(`\n  Next:  railway run npm run migrate` +
              `   — ${currentMigrationFiles.length} file(s) pending\n`);
} catch (err) {
  console.error("\n  ✗ teardown failed:", err?.message || err, "\n");
  process.exitCode = 1;
} finally {
  await closePool().catch(() => {});
}
