/**
 * THE migration runner. Applies db/migrations/*.sql in filename order, exactly
 * once each, and records what it did.
 *
 * WHY THIS REPLACED THE LAZY CREATES
 * Until now this codebase had no migration runner. Schema arrived two ways at
 * once: ~34 hand-written .sql files in db/migrations that someone applied by
 * hand one at a time with run-migration.js, and 19 CREATE TABLE IF NOT EXISTS
 * calls buried inside store modules that ran at REQUEST time. The two drifted —
 * contact_favorites gained `tags` and `position` in the lazy path and never in
 * the migration — and neither one could tell you what the database actually
 * contained. Worse, the lazy path meant the database could never be rebuilt:
 * drop a table and the next HTTP request silently recreated it in its old shape.
 *
 * After this, the database only ever changes because someone ran this command.
 *
 * USAGE
 *   npm run migrate:status                 what is applied, what is pending
 *   npm run migrate -- --dry-run           list what WOULD run, touch nothing
 *   npm run migrate                        apply everything pending
 *   npm run migrate:baseline               adopt an existing database (see below)
 *   npm run migrate -- --seal              write the applied checksums into the repo
 *
 * Against production, prefix with the env:  railway run npm run migrate
 *
 * BASELINE — READ THIS BEFORE THE FIRST RUN AGAINST AN EXISTING DATABASE
 * A database that predates this runner already contains every table these files
 * describe, but has no record of them. A plain `migrate` would try to apply all
 * 34 from scratch. Most are IF NOT EXISTS and would no-op, but not all of them
 * are, and "mostly idempotent" is not a thing to bet a production database on.
 * `migrate:baseline` records every CURRENT file as applied WITHOUT EXECUTING ANY
 * OF THEM, which is the correct one-time move for an existing database. Files
 * added after that run normally.
 *
 * A fresh, empty database needs no baseline. Just run `migrate`.
 *
 * ARCHIVED MIGRATIONS — db/migrations/_archive/
 * The 39 files that predate the 20260828 rebuild live there. They are NOT
 * applied and not scanned; only *.sql directly in db/migrations/ is.
 *
 * They were moved because they had stopped being migrations. Twelve of them
 * ALTER tables that no migration ever created -- users, circles, circle_members
 * and others existed only because somebody made them by hand -- so the set
 * cannot build a database from empty. Production's ledger records them as
 * applied and skips them, which hid that; a brand-new database has an empty
 * ledger, tries all 56 files, and dies on the first ALTER. Keeping unrunnable
 * files in the directory the runner scans meant every new environment inherited
 * a failure that has nothing to do with its own state.
 *
 * Their rows stay in the ledger, and this runner reports them as `archived`
 * rather than `MISSING` so a status listing does not read like somebody deleted
 * a migration.
 *
 * DRIFT DETECTION
 * Every applied file's sha256 is stored. Editing a file that has already been
 * applied is refused, loudly, because the database no longer matches what the
 * file says. Write a new migration instead. `--allow-drift` overrides and
 * re-stamps the checksum without re-running the file; it is for the case where
 * you edited only comments.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "..", "db", "migrations");
/**
 * THE APPLIED CHECKSUMS, IN THE REPO.
 *
 * `--seal` writes schema_migrations into this file so a laptop with no
 * database can answer the one question that blocked a deploy: has an
 * already-applied migration been edited? src/db/migrations-immutable.test.js
 * reads it and runs on every `npm test`.
 *
 * It is not a second source of truth. The database is the truth; this is a
 * snapshot of it, and it is checked in precisely so the answer arrives before
 * the push instead of during the deploy.
 */
const APPLIED_MANIFEST = path.join(MIGRATIONS_DIR, "APPLIED.sha256");
// Scanned for reporting only. listMigrations never reads it: a subdirectory does
// not end in .sql, so the filter already skips it, and that is deliberate rather
// than incidental.
const ARCHIVE_DIR = path.join(MIGRATIONS_DIR, "_archive");

// Materialize the service-account JSON to a temp file so the Cloud SQL
// connector's Application Default Credentials can find it — mirrors
// src/db/firestore.js. MUST happen before sql.js is imported.
const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-migration.json");
  fs.writeFileSync(tmp, credsJson, { mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { query, withTransaction, closePool } = await import("../src/db/sql.js");

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const MODE_STATUS = has("--status");
const MODE_DRY = has("--dry-run");
const MODE_BASELINE = has("--baseline");
const ALLOW_DRIFT = has("--allow-drift");
const MODE_SEAL = has("--seal");

const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

/**
 * Plain byte-order sort, which is what the date-prefixed filenames are designed
 * for. Deliberately NOT localeCompare: locale collation can order "_" and "."
 * differently per machine, and 20260726_add_push_tokens.sql MUST sort before
 * 20260726_add_push_tokens_columns.sql or the ALTER hits a missing table.
 */
function listMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error("No db/migrations directory at " + MIGRATIONS_DIR);
  }
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((filename) => {
      const body = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), "utf8");
      return { filename, body, checksum: sha256(body) };
    });
}

async function ensureLedger() {
  // The one table this runner is allowed to create on its own, because it is the
  // thing that records everything else. Not part of the app schema.
  await query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename   text        PRIMARY KEY,
       checksum   text        NOT NULL,
       applied_at timestamptz NOT NULL DEFAULT now(),
       applied_by text
     )`,
  );
}

async function loadApplied() {
  const { rows } = await query(`SELECT filename, checksum, applied_at FROM schema_migrations`);
  return new Map(rows.map((r) => [r.filename, r]));
}

function actor() {
  return process.env.MIGRATION_ACTOR || os.userInfo?.().username || "unknown";
}

async function main() {
  const files = listMigrations();
  await ensureLedger();
  const applied = await loadApplied();

  const pending = [];
  const drifted = [];
  for (const f of files) {
    const prev = applied.get(f.filename);
    if (!prev) pending.push(f);
    else if (prev.checksum !== f.checksum) drifted.push(f);
  }

  if (MODE_STATUS) {
    console.log(`\n  ${files.length} migration files, ${applied.size} recorded as applied\n`);
    for (const f of files) {
      const prev = applied.get(f.filename);
      const mark = !prev ? "PENDING " : prev.checksum !== f.checksum ? "DRIFTED " : "applied ";
      const when = prev ? new Date(prev.applied_at).toISOString().slice(0, 16).replace("T", " ") : "";
      console.log(`  ${mark} ${f.filename}${when ? "  " + when : ""}`);
    }
    // A file recorded as applied but no longer in the scanned directory is one of
    // two very different things, and calling both of them MISSING was alarming
    // for no reason: it was deliberately archived, or somebody deleted a
    // migration and the database still has whatever it did.
    const onDisk = new Set(files.map((f) => f.filename));
    const archived = fs.existsSync(ARCHIVE_DIR)
      ? new Set(fs.readdirSync(ARCHIVE_DIR).filter((f) => f.endsWith(".sql")))
      : new Set();
    let archivedCount = 0;
    for (const name of applied.keys()) {
      if (onDisk.has(name)) continue;
      if (archived.has(name)) { archivedCount += 1; continue; }
      console.log(`  MISSING  ${name}  (applied, but the file is gone)`);
    }
    if (archivedCount) {
      console.log(`\n  ${archivedCount} archived (db/migrations/_archive, applied, not scanned)`);
    }
    console.log("");
    return 0;
  }

  if (MODE_SEAL) {
    // Only files that exist on disk. A migration that was applied and then
    // archived is real history, but it is not something the local test can
    // check, and listing it would make the test fail on a missing file.
    const onDisk = new Set(files.map((f) => f.filename));
    const lines = [...applied.values()]
      .filter((r) => onDisk.has(r.filename))
      .sort((a, b) => (a.filename < b.filename ? -1 : 1))
      .map((r) => `${r.checksum}  ${r.filename}`);
    const header = [
      "# THE CHECKSUM OF EVERY APPLIED MIGRATION, AS THE DATABASE RECORDS IT.",
      "#",
      "# Generated by: npm run migrate -- --seal   (against the database that matters)",
      "# Read by:      src/db/migrations-immutable.test.js, on every npm test",
      "#",
      "# DO NOT EDIT A LINE HERE TO MAKE A TEST PASS. A line changing in this file",
      "# means an applied migration's text changed, which is the thing the test",
      "# exists to catch. The fix is to restore the .sql file, not to re-seal.",
      "#",
      `# ${lines.length} applied migration(s) present on disk.`,
      "",
    ].join("\n");
    const body = `${header}${lines.join("\n")}\n`;
    if (MODE_DRY) {
      console.log(`\n  --dry-run: would write ${lines.length} checksum(s) to ${path.relative(process.cwd(), APPLIED_MANIFEST)}\n`);
      return 0;
    }
    fs.writeFileSync(APPLIED_MANIFEST, body, "utf8");
    console.log(
      `\n  Sealed ${lines.length} applied checksum(s) into ` +
        `${path.relative(process.cwd(), APPLIED_MANIFEST)}.\n` +
        `  Commit it. ${drifted.length ? `${drifted.length} file(s) on disk differ from what is sealed — ` +
          `npm test will now name them.` : "Every file on disk matches what was applied."}\n`,
    );
    return 0;
  }

  if (drifted.length && !ALLOW_DRIFT) {
    console.error(`\n  ✗ ${drifted.length} already-applied migration(s) have been edited:\n`);
    for (const f of drifted) console.error(`      ${f.filename}`);
    console.error(
      `\n  The database no longer matches what these files say. Add a NEW migration\n` +
        `  instead of editing an applied one. If you changed only comments, re-stamp\n` +
        `  the checksum without re-running: npm run migrate -- --allow-drift\n`,
    );
    return 1;
  }

  if (MODE_BASELINE) {
    if (!pending.length) {
      console.log("\n  Nothing to baseline — every file is already recorded.\n");
      return 0;
    }
    console.log(`\n  BASELINE: recording ${pending.length} file(s) as applied WITHOUT running them.\n`);
    for (const f of pending) console.log(`      ${f.filename}`);
    if (MODE_DRY) {
      console.log("\n  --dry-run: nothing was written.\n");
      return 0;
    }
    await withTransaction(async (client) => {
      for (const f of pending) {
        await client.query(
          `INSERT INTO schema_migrations (filename, checksum, applied_by)
           VALUES ($1, $2, $3) ON CONFLICT (filename) DO NOTHING`,
          [f.filename, f.checksum, `baseline:${actor()}`],
        );
      }
    });
    console.log(`\n  ✓ baselined ${pending.length} file(s). Future migrations run normally.\n`);
    return 0;
  }

  if (ALLOW_DRIFT && drifted.length) {
    if (MODE_DRY) {
      console.log(`\n  --dry-run: would re-stamp ${drifted.length} drifted checksum(s).\n`);
    } else {
      for (const f of drifted) {
        await query(`UPDATE schema_migrations SET checksum = $2 WHERE filename = $1`, [
          f.filename,
          f.checksum,
        ]);
        console.log(`  ~ re-stamped ${f.filename} (not re-run)`);
      }
    }
  }

  if (!pending.length) {
    console.log("\n  ✓ up to date — nothing pending.\n");
    return 0;
  }

  if (MODE_DRY) {
    console.log(`\n  --dry-run: ${pending.length} migration(s) would be applied, in this order:\n`);
    for (const f of pending) console.log(`      ${f.filename}`);
    console.log("");
    return 0;
  }

  console.log(`\n  Applying ${pending.length} migration(s)...\n`);
  for (const f of pending) {
    const started = Date.now();
    try {
      // ONE TRANSACTION PER FILE. A file that fails halfway leaves nothing
      // behind, and the ledger row is written in the same transaction as the DDL
      // — so "applied" and "actually ran" can never disagree.
      await withTransaction(async (client) => {
        // The app pool sets statement_timeout to 15s for request safety. An index
        // build on a real table blows straight through that, and the failure
        // looks like a broken migration rather than a timeout.
        await client.query("SET LOCAL statement_timeout = 0");
        await client.query(f.body);
        await client.query(
          `INSERT INTO schema_migrations (filename, checksum, applied_by) VALUES ($1, $2, $3)`,
          [f.filename, f.checksum, actor()],
        );
      });
      console.log(`  ✓ ${f.filename}  (${Date.now() - started}ms)`);
    } catch (err) {
      console.error(`  ✗ ${f.filename} FAILED — rolled back, nothing applied from this file`);
      console.error(`    ${err?.message || err}`);
      console.error(`\n  Stopped. Migrations after this one were not attempted.\n`);
      return 1;
    }
  }
  console.log(`\n  ✓ applied ${pending.length} migration(s).\n`);
  return 0;
}

let code = 1;
try {
  code = await main();
} catch (err) {
  console.error("\n  ✗ migrate failed:", err?.message || err, "\n");
  code = 1;
} finally {
  await closePool().catch(() => {});
}
process.exit(code);
