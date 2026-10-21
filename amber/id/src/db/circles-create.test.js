/**
 * CREATING A CIRCLE MUST WORK WHETHER OR NOT THE MIGRATION HAS RUN.
 *
 * It did not, and the cause was the layer meant to prevent exactly this. The
 * fallback INSERT correctly dropped `kind_tag` and was still handed five
 * parameters for a four-parameter statement; Postgres rejected the bind, a bare
 * catch returned null, and the route answered 500. "Circle still doesn't create
 * for some reason" was that, for a day.
 *
 * The query function is injected, so nothing here touches a database.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createCircle, updateCircle } from "./circles-store.js";
import { _resetOptionalColumns } from "./optional-column.js";

const OWNER = "11111111-2222-3333-4444-555555555555";
const CIRCLE = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const undefinedColumn = () =>
  Object.assign(new Error('column "kind_tag" does not exist'), { code: "42703" });

function recorder({ noKindTag = false } = {}) {
  const calls = [];
  const queryImpl = async (sql, params) => {
    calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
    if (noKindTag && /kind_tag(?!\s+IS)/.test(sql) && !/NULL::text AS kind_tag/.test(sql)) {
      throw undefinedColumn();
    }
    return {
      rows: [
        {
          id: CIRCLE,
          owner_id: OWNER,
          name: "Family",
          color: "#B2622D",
          description: null,
          kind_tag: null,
          created_at: "2026-09-08T00:00:00Z",
          updated_at: "2026-09-08T00:00:00Z",
        },
      ],
      rowCount: 1,
    };
  };
  return { calls, queryImpl };
}

test("a circle is created when the column exists", async () => {
  _resetOptionalColumns();
  const { calls, queryImpl } = recorder();
  const row = await createCircle(
    OWNER,
    { name: "Family", color: "#B2622D", kindTag: "Family" },
    { queryImpl },
  );
  assert.ok(row, "a row came back");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params.length, 5, "all five values, including the tag");
});

test("AND when it does not — the failure that shipped", async () => {
  _resetOptionalColumns();
  const { calls, queryImpl } = recorder({ noKindTag: true });
  const row = await createCircle(
    OWNER,
    { name: "Family", color: "#B2622D", kindTag: "Family" },
    { queryImpl },
  );
  assert.ok(row, "the circle is still created with the migration pending");
  assert.equal(row.id, CIRCLE);
  assert.equal(calls.length, 2, "it tried with the column, then without");
  assert.equal(
    calls[1].params.length,
    4,
    "the fallback gets four parameters for its four placeholders",
  );
  assert.doesNotMatch(calls[1].sql, /kind_tag\)/, "and does not name the column it is inserting");
});

test("a circle can be renamed with the migration pending", async () => {
  _resetOptionalColumns();
  const { calls, queryImpl } = recorder({ noKindTag: true });
  const row = await updateCircle(OWNER, CIRCLE, { name: "Close friends" }, { queryImpl });
  assert.ok(row);
  // No kindTag in the patch, so both variants take the same three parameters.
  assert.equal(calls.at(-1).params.length, 3);
});

test("a rename that also sets the tag still renames when the column is missing", async () => {
  _resetOptionalColumns();
  const { calls, queryImpl } = recorder({ noKindTag: true });
  const row = await updateCircle(
    OWNER,
    CIRCLE,
    { name: "Close friends", kindTag: "Friends" },
    { queryImpl },
  );
  assert.ok(row, "the name change must land even though the tag cannot");
  const last = calls.at(-1);
  assert.doesNotMatch(last.sql, /SET .*kind_tag =/);
  assert.equal(last.params.length, 3, "the tag's parameter goes with the tag");
});

test("a real error is reported rather than swallowed into a null", async () => {
  _resetOptionalColumns();
  const errs = [];
  const original = console.error;
  console.error = (...a) => errs.push(a.join(" "));
  try {
    const queryImpl = async () => {
      throw Object.assign(new Error("duplicate key value"), { code: "23505" });
    };
    const row = await createCircle(OWNER, { name: "Family" }, { queryImpl });
    assert.equal(row, null, "the route still gets a soft failure");
  } finally {
    console.error = original;
  }
  assert.equal(errs.length, 1);
  assert.match(errs[0], /CREATE_CIRCLE_ERR/);
  assert.match(errs[0], /23505/, "the code is in the line, not in an object beside it");
});
