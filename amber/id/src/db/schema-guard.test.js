/**
 * THE GUARD THAT WOULD HAVE CAUGHT THE OUTAGE.
 *
 * Migrations 049 and 050 shipped as code and were never applied. Every event
 * write, every reminder write and every agenda read threw for days, invisibly,
 * while the service reported itself healthy. These tests are written against
 * that specific morning: the first one IS that morning, replayed.
 *
 * The other half is the part that decides whether anybody keeps this guard. A
 * gate that blocks a boot because the database was slow for two seconds, or
 * because a laptop has no DATABASE_URL, gets an ALLOW_PENDING_MIGRATIONS=true
 * pinned into the environment within a week and then protects nothing. So every
 * "cannot tell" case is pinned to booting, and pinned as hard as the fatal one.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  enforceSchemaFreshness,
  migrationFilenames,
  schemaBanner,
  schemaState,
  unknownBanner,
} from "./schema-guard.js";

/** A migrations directory with exactly these filenames. */
function dirWith(names) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mig-"));
  for (const n of names) fs.writeFileSync(path.join(dir, n), "-- x\n");
  // A stray non-SQL file must not count as a migration.
  fs.writeFileSync(path.join(dir, "APPLIED.sha256"), "x");
  return dir;
}

const FILES = [
  "20260911_049_events_reminders_detail.sql",
  "20260911_050_reminders_starts_on.sql",
  "20260912_051_imessage_link.sql",
];

/**
 * Every call that involves a never-settling ledger goes through this.
 *
 * A test for a hang cannot be allowed to hang. Without a deadline, deleting the
 * guard's timeout kills the whole suite mid-run and node reports the tests it
 * already finished as passes -- which reads, at a glance, exactly like a
 * mutation that survived. This turns that into an ordinary assertion failure.
 */
function withDeadline(promise, ms = 2000) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve({ state: "TEST_GAVE_UP", reason: "TEST_GAVE_UP" }), ms)),
  ]);
}

function collector() {
  const out = { errors: [], warns: [], exited: null };
  return {
    out,
    log: { error: (m) => out.errors.push(String(m)), warn: (m) => out.warns.push(String(m)) },
    exit: (code) => {
      out.exited = code;
    },
  };
}

test("THE MORNING OF THE OUTAGE: code ahead of schema does not become the live deploy", async () => {
  /**
   * 049 and 050 on disk, ledger has neither. This is the exact production state
   * that made every schedule write throw. A boot here is the bug.
   */
  const dir = dirWith(FILES);
  const { out, log, exit } = collector();
  const state = await enforceSchemaFreshness({
    dir,
    loadApplied: async () => [],
    exit,
    log,
  });

  assert.equal(state.state, "behind");
  assert.equal(out.exited, 1, "booted against a schema that cannot take its own writes");
  const banner = out.errors.join("\n");
  for (const f of FILES) assert.ok(banner.includes(f), `the banner did not name ${f}`);
  assert.match(banner, /railway run npm run migrate/, "told them it was broken, not how to fix it");
});

test("only the files the ledger has never seen are named", async () => {
  const dir = dirWith(FILES);
  const state = await schemaState({
    dir,
    loadApplied: async () => [FILES[0]],
  });
  assert.equal(state.state, "behind");
  assert.deepEqual(state.pending, [FILES[1], FILES[2]]);
});

test("a database that is current boots without a word, and without waiting", async () => {
  const dir = dirWith(FILES);
  const { out, log, exit } = collector();
  const started = Date.now();
  const state = await enforceSchemaFreshness({
    dir,
    loadApplied: async () => FILES,
    // Deliberately long. A healthy check must return as soon as the ledger
    // answers, not sit out the deadline -- forgetting to clear the timer is
    // correct-but-slow, which is exactly the kind of defect that survives a
    // test suite and then adds seconds to every single deploy.
    timeoutMs: 5000,
    exit,
    log,
  });
  assert.equal(state.state, "current");
  assert.equal(out.exited, null);
  assert.deepEqual(out.errors, []);
  assert.deepEqual(out.warns, [], "a healthy boot printed a warning nobody needs to read");
  assert.ok(Date.now() - started < 1000, "a healthy boot waited out the whole ledger deadline");
});

test("a ledger ahead of the checkout is current, not behind", async () => {
  // Rolling back the code leaves the database holding migrations this checkout
  // has never heard of. That is a deliberate rollback, not a broken deploy, and
  // blocking it would make rolling back impossible exactly when it is needed.
  const dir = dirWith(FILES);
  const state = await schemaState({
    dir,
    loadApplied: async () => [...FILES, "20260913_052_something_newer.sql"],
  });
  assert.equal(state.state, "current");
});

test("NOT KNOWING IS NOT THE SAME AS KNOWING SOMETHING IS WRONG", async () => {
  /**
   * Every one of these boots, and each one is a way this guard would otherwise
   * get switched off permanently: a laptop with no database, a two-second blip
   * at boot turning into a crash loop that stops the old deploy from restarting
   * either, and a database that predates the runner and needs baselining rather
   * than a blocked deploy.
   */
  const dir = dirWith(FILES);
  const cases = [
    { name: "no database configured", opts: {}, reason: "no_database" },
    {
      name: "ledger table does not exist",
      opts: {
        loadApplied: async () => {
          throw new Error('relation "schema_migrations" does not exist');
        },
      },
      reason: "no_ledger_table",
    },
    {
      name: "connection refused",
      opts: {
        loadApplied: async () => {
          throw new Error("ECONNREFUSED");
        },
      },
      reason: "ledger_unreadable",
    },
    {
      name: "database is slow",
      opts: { loadApplied: () => new Promise(() => {}), timeoutMs: 30 },
      reason: "ledger_timeout",
    },
  ];

  for (const c of cases) {
    const { out, log, exit } = collector();
    const state = await withDeadline(enforceSchemaFreshness({ dir, ...c.opts, exit, log }));
    assert.equal(state.state, "unknown", c.name);
    assert.equal(state.reason, c.reason, c.name);
    assert.equal(out.exited, null, `${c.name} blocked the boot`);
    assert.equal(out.warns.length, 1, `${c.name} booted without saying anything`);
    assert.match(out.warns[0], /UNKNOWN/, c.name);
  }
});

test("a slow ledger does not hold the boot open forever", async () => {
  /**
   * The timeout is the whole point: a ledger read that never settles would hang
   * before listen(), which reads to Railway exactly like a crash but with no log.
   *
   * RACED AGAINST ITS OWN CLOCK, because the obvious version of this test cannot
   * fail. Deleting the timeout from the guard makes `await schemaState(...)` hang
   * here too -- the suite dies mid-run and reports the tests it got through as
   * passes, which is indistinguishable at a glance from a mutation that survived.
   * A test for a hang has to be able to outlive the hang.
   */
  const dir = dirWith(FILES);
  const state = await withDeadline(
    schemaState({ dir, loadApplied: () => new Promise(() => {}), timeoutMs: 40 }),
  );
  assert.equal(state.reason, "ledger_timeout", "the guard hung on a database that never answered");
});

test("the escape hatch boots, and says so where somebody will see it", async () => {
  const dir = dirWith(FILES);
  const { out, log, exit } = collector();
  await enforceSchemaFreshness({ dir, loadApplied: async () => [], allowPending: true, exit, log });
  assert.equal(out.exited, null);
  assert.match(out.errors.join("\n"), /ALLOW_PENDING_MIGRATIONS=true/);
});

test("only .sql counts, and order is the runner's order", () => {
  const dir = dirWith(["20260912_051_b.sql", "20260911_049_a.sql"]);
  assert.deepEqual(migrationFilenames(dir), ["20260911_049_a.sql", "20260912_051_b.sql"]);
  assert.ok(!migrationFilenames(dir).includes("APPLIED.sha256"));
});

test("a checkout with no migrations directory is unknown, not behind", async () => {
  assert.equal(migrationFilenames("/nope/not/here"), null);
  const state = await schemaState({ dir: "/nope/not/here", loadApplied: async () => [] });
  assert.equal(state.state, "unknown");
  assert.equal(state.reason, "no_migrations_dir");
});

test("the real migrations directory is readable, so this guard is not inert in production", () => {
  // Every other test builds its own directory. If MIGRATIONS_DIR resolved wrong
  // -- relative to cwd instead of to this file, say -- they would all still pass
  // while the deployed guard silently reported "no_migrations_dir" forever.
  const real = migrationFilenames();
  assert.ok(Array.isArray(real), "MIGRATIONS_DIR does not resolve to the real directory");
  assert.ok(real.length > 10, `only found ${real?.length} migrations`);
  assert.ok(real.includes("20260912_051_imessage_link.sql"));
});

test("the banners say the thing they exist to say", () => {
  const b = schemaBanner({ pending: ["a.sql"] });
  assert.match(b, /REFUSING TO START/);
  assert.match(b, /previous deployment/, "did not say the old deploy keeps serving");
  assert.ok(!/—|–/.test(b), "an em dash in a boot log renders as a mangled byte in some collectors");
  assert.match(unknownBanner({ reason: "ledger_timeout" }), /ledger_timeout/);
});
