/**
 * AN APPLIED MIGRATION STILL SAYS WHAT THE DATABASE RECORDED IT SAYING.
 *
 * Run with the rest: npm test
 *
 * WHAT HAPPENED. An American-English pass rewrote comments across the repo and
 * its skip list did not exclude db/migrations, so it touched ten migrations that
 * had already run. Nothing about the database changed -- they were comments --
 * but every one of those files is checksummed into schema_migrations, so the
 * next deploy stopped dead:
 *
 *     ✗ 10 already-applied migration(s) have been edited.
 *       The database no longer matches what these files say.
 *
 * A spelling change blocked a deploy. The runner was right to refuse: a checksum
 * that can be re-stamped whenever it is inconvenient is not evidence of
 * anything, and the one thing it protects against is a file whose text no longer
 * describes the schema in front of you.
 *
 * WHY THIS TEST EXISTS ANYWAY. scripts/migrate.js already performs the real
 * check -- but only at deploy time, against a database, with credentials. That
 * makes the person least able to fix it the first person to find out. This asks
 * the same question offline, in 40ms, on every `npm test`.
 *
 * WHERE THE ANSWER COMES FROM, and this is the part two earlier attempts got
 * wrong. It is not git history: "was this file modified after the commit that
 * added it" is a different question that can never come back clean, because the
 * revert that fixes a bad edit is itself a modification, and because a
 * legitimate edit made BEFORE the migration was ever applied is not drift.
 * db/migrations/APPLIED.sha256 is the actual answer -- schema_migrations,
 * written into the repo by `npm run migrate -- --seal`. Same sha256 of the same
 * bytes the runner compares. A file whose hash moves off its sealed line is
 * drift, and nothing else is.
 *
 * A MIGRATION WITH NO SEALED LINE IS FINE. It has not been applied anywhere the
 * seal has seen, so it is still allowed to change -- that is the whole point of
 * the forward-only rule. It gets a line the next time someone seals.
 *
 * THE ESCAPE HATCH IS A NEW FILE. There is no flag on this test. If an applied
 * migration is wrong, the fix is another migration. Re-sealing to silence a
 * failure changes a line in a checked-in file named APPLIED.sha256, which is
 * visible in a diff in a way an edited comment inside a .sql file is not --
 * that visibility is the point, and it is the only reason a seal command is
 * allowed to exist.
 *
 * `npm run migrate -- --allow-drift` also still exists, and this test is the
 * reason to reach for it roughly never: it makes the error go away by discarding
 * the evidence.
 */
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIGRATIONS_DIR = join(ROOT, "db", "migrations");
const MANIFEST = join(MIGRATIONS_DIR, "APPLIED.sha256");

/** Byte-for-byte what scripts/migrate.js stores in schema_migrations.checksum. */
const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/** filename -> sealed checksum. Comments and blank lines are skipped. */
function readManifest(text) {
  const sealed = new Map();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^([0-9a-f]{64})\s+(\S+)$/.exec(line);
    if (!m) throw new Error(`unparseable line in APPLIED.sha256: ${line}`);
    sealed.set(m[2], m[1]);
  }
  return sealed;
}

test("APPLIED.sha256 parses, and only in the one shape", () => {
  // The parser gets its own test because everything below trusts it, and a
  // parser that quietly drops a line it does not understand turns this whole
  // file into a checker that passes by looking at nothing.
  const ok = readManifest(
    ["# a comment", "", `${"a".repeat(64)}  one.sql`, `${"b".repeat(64)}  two.sql`].join("\n"),
  );
  assert.equal(ok.size, 2);
  assert.equal(ok.get("two.sql"), "b".repeat(64));
  assert.throws(() => readManifest("not-a-checksum  one.sql"));
  assert.throws(() => readManifest(`${"a".repeat(63)}  short.sql`));
});

test("no applied migration has been edited since it was applied", () => {
  const files = migrationFiles();
  // The floor first, in both directions. A test that walks nothing passes, and
  // that is the failure mode every checker has.
  assert.ok(files.length >= 30, `only found ${files.length} migration files`);

  assert.ok(
    existsSync(MANIFEST),
    "db/migrations/APPLIED.sha256 is missing, so nothing here could be checked. " +
      "Create it with: railway run npm run migrate -- --seal   (then commit it)",
  );

  const sealed = readManifest(readFileSync(MANIFEST, "utf8"));
  assert.ok(
    sealed.size >= 30,
    `APPLIED.sha256 lists only ${sealed.size} migration(s), which is too few to be current. Re-seal.`,
  );

  const drifted = [];
  const onDisk = new Set(files);
  for (const name of files) {
    const want = sealed.get(name);
    if (!want) continue; // not applied anywhere sealed yet; still editable
    const got = sha256(readFileSync(join(MIGRATIONS_DIR, name), "utf8"));
    if (got !== want) drifted.push(`${name}\n        applied: ${want}\n        on disk: ${got}`);
  }

  assert.deepEqual(
    drifted,
    [],
    "APPLIED MIGRATIONS HAVE BEEN EDITED. `npm run migrate` will refuse to run:\n\n      " +
      drifted.join("\n      ") +
      "\n\n  Restore each file to the version that was applied and put the change in a\n" +
      "  NEW migration instead. To restore one:\n" +
      "      git log --oneline -- db/migrations/<file>\n" +
      "      git show <the commit before the edit>:db/migrations/<file> > db/migrations/<file>\n",
  );

  // A sealed name with no file is the other direction of the same problem: the
  // database ran something this checkout no longer has. Archived migrations are
  // deliberately excluded by --seal, so anything left here is a deletion.
  const vanished = [...sealed.keys()].filter((n) => !onDisk.has(n));
  assert.deepEqual(
    vanished,
    [],
    `sealed as applied, but the file is gone: ${vanished.join(", ")}. ` +
      "Restore it, or move it to db/migrations/_archive and re-seal.",
  );
});

test("every migration file is named so it sorts in the order it runs", () => {
  // Adjacent to immutability and cheap to hold: the runner orders by filename,
  // so a name that sorts wrong runs wrong, once, on a database that then
  // disagrees with every other one.
  const bad = migrationFiles().filter((f) => !/^\d{8}_\d{3}_[a-z0-9_]+\.sql$/.test(f));
  assert.deepEqual(
    bad,
    [],
    `migration filenames off the YYYYMMDD_NNN_name.sql pattern: ${bad.join(", ")}`,
  );
});
