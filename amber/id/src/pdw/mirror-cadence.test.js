/**
 * A MIRROR THAT COSTS NOTHING WHEN IT IS OFF, and carries no content when it
 * is on. Those are the two properties worth a test; the MERGE itself is
 * bq-client's problem.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { cadenceRow, mirrorOwnerCadence, CADENCE_TABLE } from "./mirror-cadence.js";

const OWNER = "22222222-2222-2222-2222-222222222222";
const ROW = {
  contact_id: "11111111-1111-1111-1111-111111111111",
  channel: "email",
  first_at: new Date("2025-01-02T03:04:05Z"),
  last_at: "2026-09-20T10:00:00Z",
  count_30d: 4,
  count_90d: "13",
  count_all: 40,
  accounts: 2,
};

test("a stats row becomes a warehouse row with no content on it", () => {
  const r = cadenceRow(OWNER, ROW, { tenant: "amber", computedAt: new Date("2026-09-27T00:00:00Z") });
  assert.equal(r.owner_id, OWNER);
  assert.equal(r.contact_id, ROW.contact_id);
  assert.equal(r.channel, "email");
  assert.equal(r.count_90d, 13, "a string count is coerced, not stringified");
  assert.equal(r.accounts, 2);
  assert.equal(r.first_at, "2025-01-02T03:04:05.000Z");
  // Nothing that could identify the person or quote a message.
  const leaked = Object.keys(r).filter((k) =>
    /name|email|phone|subject|body|snippet|title/i.test(k),
  );
  assert.deepEqual(leaked, []);
});

test("accounts is never zero, so the column means the same thing everywhere", () => {
  assert.equal(cadenceRow(OWNER, { ...ROW, accounts: 0 }).accounts, 1);
  assert.equal(cadenceRow(OWNER, { ...ROW, accounts: null }).accounts, 1);
});

test("a row with no contact or no channel is not mirrored", () => {
  assert.equal(cadenceRow(OWNER, { channel: "email" }), null);
  assert.equal(cadenceRow(OWNER, { contact_id: "x" }), null);
  assert.equal(cadenceRow(null, ROW), null);
});

test("an unconfigured warehouse costs one boolean and writes nothing", async () => {
  let called = 0;
  const n = await mirrorOwnerCadence(OWNER, [ROW, ROW], {
    ready: () => false,
    write: async () => { called += 1; return true; },
  });
  assert.equal(n, 0);
  assert.equal(called, 0);
});

test("one failing row does not abandon the rest", async () => {
  const seen = [];
  const n = await mirrorOwnerCadence(
    OWNER,
    [ROW, { ...ROW, channel: "calendar" }, { ...ROW, channel: "note" }],
    {
      ready: () => true,
      write: async (table, row) => {
        seen.push(row.channel);
        if (row.channel === "calendar") throw new Error("boom");
        return true;
      },
    },
  );
  assert.deepEqual(seen, ["email", "calendar", "note"]);
  assert.equal(n, 2);
});

test("the merge key is the owner, contact and channel", async () => {
  let keys = null;
  await mirrorOwnerCadence(OWNER, [ROW], {
    ready: () => true,
    write: async (table, row, keyColumns) => { keys = { table, keyColumns }; return true; },
  });
  assert.equal(keys.table, CADENCE_TABLE);
  assert.deepEqual(keys.keyColumns, ["tenant_id", "owner_id", "contact_id", "channel"]);
});
