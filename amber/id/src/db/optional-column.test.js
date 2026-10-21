/**
 * A PENDING COLUMN MUST COST THE FIELD, NOT THE FEATURE.
 *
 * These tests encode the outage this helper exists for: code that SELECTed a
 * newly added column deployed before the migration ran, and the whole circles
 * list came back empty. The contract is narrow on purpose -- retry only on
 * 42703, retry only once per key, and never swallow anything else.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  queryWithOptionalColumn,
  columnIsMissing,
  noteMissingColumn,
  _resetOptionalColumns,
  fitParams,
} from "./optional-column.js";

const undefinedColumn = () => Object.assign(new Error('column "x" does not exist'), { code: "42703" });

test("runs the query with the column when it exists", async () => {
  _resetOptionalColumns();
  const seen = [];
  const queryImpl = async (sql) => {
    seen.push(sql);
    return { rows: [{ ok: 1 }] };
  };
  const res = await queryWithOptionalColumn("t.c", (has) => (has ? "WITH" : "WITHOUT"), [], { queryImpl });
  assert.deepEqual(seen, ["WITH"]);
  assert.deepEqual(res.rows, [{ ok: 1 }]);
  assert.equal(columnIsMissing("t.c"), false);
});

test("falls back to the variant without the column on 42703", async () => {
  _resetOptionalColumns();
  const seen = [];
  const queryImpl = async (sql) => {
    seen.push(sql);
    if (sql === "WITH") throw undefinedColumn();
    return { rows: [{ ok: 2 }] };
  };
  const res = await queryWithOptionalColumn("t.c", (has) => (has ? "WITH" : "WITHOUT"), [], { queryImpl });
  assert.deepEqual(seen, ["WITH", "WITHOUT"]);
  assert.deepEqual(res.rows, [{ ok: 2 }]);
  assert.equal(columnIsMissing("t.c"), true);
});

test("stops attempting the column after the first failure", async () => {
  _resetOptionalColumns();
  const seen = [];
  const queryImpl = async (sql) => {
    seen.push(sql);
    if (sql === "WITH") throw undefinedColumn();
    return { rows: [] };
  };
  const build = (has) => (has ? "WITH" : "WITHOUT");
  await queryWithOptionalColumn("t.c", build, [], { queryImpl });
  await queryWithOptionalColumn("t.c", build, [], { queryImpl });
  await queryWithOptionalColumn("t.c", build, [], { queryImpl });
  // One probe, then three cheap runs -- not three failing round trips.
  assert.deepEqual(seen, ["WITH", "WITHOUT", "WITHOUT", "WITHOUT"]);
});

test("keys are independent", async () => {
  _resetOptionalColumns();
  const queryImpl = async (sql) => {
    if (sql === "A_WITH") throw undefinedColumn();
    return { rows: [] };
  };
  await queryWithOptionalColumn("a.c", (has) => (has ? "A_WITH" : "A_WITHOUT"), [], { queryImpl });
  assert.equal(columnIsMissing("a.c"), true);
  assert.equal(columnIsMissing("b.c"), false);
});

test("any other error propagates untouched", async () => {
  _resetOptionalColumns();
  const boom = Object.assign(new Error("syntax error"), { code: "42601" });
  const queryImpl = async () => {
    throw boom;
  };
  await assert.rejects(
    () => queryWithOptionalColumn("t.c", () => "SQL", [], { queryImpl }),
    /syntax error/,
  );
  // A real bug must not be recorded as a pending migration.
  assert.equal(columnIsMissing("t.c"), false);
});

test("noteMissingColumn marks the key without running anything", () => {
  _resetOptionalColumns();
  assert.equal(columnIsMissing("dm_messages.pinned_at"), false);
  noteMissingColumn("dm_messages.pinned_at");
  assert.equal(columnIsMissing("dm_messages.pinned_at"), true);
});

// ── THE BUG THIS HELPER CAUSED, AND MUST NOT CAUSE AGAIN ────────────────────
//
// createCircle's fallback correctly dropped `kind_tag` from the INSERT and was
// still handed five parameters for a four-parameter statement. Postgres rejects
// the bind, the store's catch returned null, the route answered 500, and
// creating a circle did not work at all -- caused by the very layer written to
// stop a pending migration from breaking a feature.

test("a variant that needs fewer parameters is given fewer parameters", async () => {
  _resetOptionalColumns();
  const calls = [];
  const queryImpl = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes("kind_tag")) throw Object.assign(new Error("no column"), { code: "42703" });
    return { rows: [{ id: "c1" }] };
  };
  const res = await queryWithOptionalColumn(
    "circles.kind_tag",
    (has) =>
      has
        ? "INSERT INTO circles (owner_id, name, color, description, kind_tag) VALUES ($1,$2,$3,$4,$5)"
        : "INSERT INTO circles (owner_id, name, color, description) VALUES ($1,$2,$3,$4)",
    ["owner", "Family", "#fff", "desc", "Family"],
    { queryImpl },
  );
  assert.deepEqual(res.rows, [{ id: "c1" }]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].params.length, 5, "the real statement gets all five");
  assert.deepEqual(
    calls[1].params,
    ["owner", "Family", "#fff", "desc"],
    "the fallback gets exactly the four it references",
  );
});

test("the trim also applies once the column is known to be missing", async () => {
  _resetOptionalColumns();
  const calls = [];
  const queryImpl = async (sql, params) => {
    calls.push(params.length);
    // The optional column here is `k`; the fallback omits it and its parameter.
    if (sql.includes("k=$3")) throw Object.assign(new Error("no column"), { code: "42703" });
    return { rows: [] };
  };
  const build = (has) => (has ? "UPDATE t SET a=$2, k=$3 WHERE id=$1" : "UPDATE t SET a=$2 WHERE id=$1");
  await queryWithOptionalColumn("t.k", build, ["id", "a", "k"], { queryImpl });
  // Second call takes the short path -- and must still trim.
  await queryWithOptionalColumn("t.k", build, ["id", "a", "k"], { queryImpl });
  assert.deepEqual(calls, [3, 2, 2]);
});

test("a variant with a HOLE in its parameters throws rather than writing the wrong column", async () => {
  _resetOptionalColumns();
  const queryImpl = async () => ({ rows: [] });
  // Four supplied, three referenced, and $2 skipped: trimming is required and
  // no slice can be correct, so it must refuse rather than guess.
  await assert.rejects(
    () =>
      queryWithOptionalColumn(
        "t.k",
        () => "UPDATE t SET a=$1, b=$3 WHERE id=$3",
        ["a", "unused", "b", "extra"],
        { queryImpl },
      ),
    /not a prefix/,
  );
});

test("fitParams leaves a matching statement alone", () => {
  const p = ["a", "b"];
  assert.equal(fitParams("t.k", "SELECT $1, $2", p), p, "same array, not a copy");
  assert.deepEqual(fitParams("t.k", "SELECT 1", p), [], "a statement with no parameters gets none");
});

// ── A MIGRATION THAT LANDS MID-FLIGHT IS PICKED UP WITHOUT A REDEPLOY ───────
//
// The flag was a boolean remembered for the life of the process, so a server
// already running kept serving without the column after the migration ran --
// and kept logging MIGRATION_PENDING, which I then read as "the migrations have
// not run" when they had.

test("the column is probed again after the cooldown, and comes back into use", async () => {
  _resetOptionalColumns();
  let columnExists = false;
  const seen = [];
  const queryImpl = async (sql) => {
    seen.push(sql);
    if (sql === "WITH" && !columnExists) throw Object.assign(new Error("nope"), { code: "42703" });
    return { rows: [{ sql }] };
  };
  const build = (has) => (has ? "WITH" : "WITHOUT");

  const real = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    // First call proves it missing, and the next one inside the minute does not
    // even try -- one failed query per cooldown, not one per request.
    await queryWithOptionalColumn("t.c", build, [], { queryImpl });
    assert.deepEqual(seen, ["WITH", "WITHOUT"]);
    now += 30_000;
    await queryWithOptionalColumn("t.c", build, [], { queryImpl });
    assert.deepEqual(seen, ["WITH", "WITHOUT", "WITHOUT"]);
    assert.equal(columnIsMissing("t.c"), true);

    // The migration runs. Past the cooldown, the probe finds it.
    columnExists = true;
    now += 61_000;
    assert.equal(columnIsMissing("t.c"), false, "the cooldown has expired");
    const res = await queryWithOptionalColumn("t.c", build, [], { queryImpl });
    assert.deepEqual(res.rows, [{ sql: "WITH" }], "the real query is used again");
    // And it stays used, with no further probing.
    await queryWithOptionalColumn("t.c", build, [], { queryImpl });
    assert.deepEqual(seen.slice(-2), ["WITH", "WITH"]);
  } finally {
    Date.now = real;
  }
});

test("the warning is re-armed, so PENDING never outlives the condition", async () => {
  _resetOptionalColumns();
  const lines = [];
  const original = console.error;
  console.error = (...a) => lines.push(a.join(" "));
  const real = Date.now;
  let now = 5_000_000;
  Date.now = () => now;
  let columnExists = false;
  try {
    const queryImpl = async (sql) => {
      if (sql === "WITH" && !columnExists) throw Object.assign(new Error("nope"), { code: "42703" });
      return { rows: [] };
    };
    const build = (has) => (has ? "WITH" : "WITHOUT");
    await queryWithOptionalColumn("t.c", build, [], { queryImpl });
    assert.equal(lines.length, 1);
    assert.match(lines[0], /MIGRATION_PENDING t\.c/);

    columnExists = true;
    now += 61_000;
    await queryWithOptionalColumn("t.c", build, [], { queryImpl });
    assert.equal(lines.length, 2);
    assert.match(lines[1], /MIGRATION_LANDED t\.c/, "the log tells the whole story");

    // And if it goes missing again (a rollback), it warns again rather than
    // staying quiet because it warned once an hour ago.
    columnExists = false;
    now += 61_000;
    await queryWithOptionalColumn("t.c", build, [], { queryImpl });
    assert.equal(lines.length, 3);
    assert.match(lines[2], /MIGRATION_PENDING/);
  } finally {
    console.error = original;
    Date.now = real;
  }
});
