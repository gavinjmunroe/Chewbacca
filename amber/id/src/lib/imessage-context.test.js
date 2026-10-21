import test from "node:test";
import assert from "node:assert/strict";
import { loadImessageContext } from "./imessage-context.js";
const owner = "11111111-1111-4111-8111-111111111111";
test("every context read uses the admitted owner and private secrets are excluded", async () => {
  const seen = [];
  const wrap = (v) => async (id) => {
    seen.push(id);
    return v;
  };
  const r = await loadImessageContext(owner, "What's on my calendar today?", {
    profile: wrap({
      name: "Owner",
      timezone: "America/Los_Angeles",
      secret: "NEVER",
      phone: "+11111111111",
    }),
    gather: wrap({ layers: { stated: [{ text: "My fact" }] } }),
    memory: wrap({
      hits: [{ kind: "transcript", text: "My memo" }],
      skipped: [],
    }),
    events: wrap([{ title: "My plan" }]),
    now: new Date("2026-10-07T12:00:00Z"),
  });
  assert.equal(seen.length, 4);
  assert.ok(seen.every((x) => x === owner));
  assert.match(r.block, /My memo/);
  assert.match(r.block, /My plan/);
  assert.doesNotMatch(r.block, /NEVER|11111111111/);
});
test("no owner fails closed and unavailable data is declared", async () => {
  assert.deepEqual(
    await loadImessageContext(null, "hello", { profile: () => assert.fail() }),
    { profile: null, block: "" },
  );
  const r = await loadImessageContext(owner, "hello", {
    profile: async () => {
      throw Error("db");
    },
    gather: async () => null,
    memory: async () => ({ hits: [], skipped: ["notes"] }),
    events: () => assert.fail("no calendar query for greeting"),
  });
  assert.match(r.block, /unavailable.*profile.*notes/);
});
