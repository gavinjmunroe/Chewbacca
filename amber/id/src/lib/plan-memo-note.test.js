import test from "node:test";
import assert from "node:assert/strict";
import { appendPlanMemo } from "./plan-memo-note.js";
const input = {
  ownerId: "owner",
  eventId: "event",
  conversationId: "memo",
  requestId: "request",
  text: "Reviewed fixture",
  contactIds: ["person"],
};
test("plan memo preserves source and adds participants without deleting data", async () => {
  const queries = [],
    writes = [];
  const deps = {
    query: async (sql, params) => {
      queries.push([sql, params]);
      return {
        rows: sql.includes("SELECT id")
          ? [{ id: "person" }]
          : [{ event_id: "event" }],
      };
    },
    insert: async (note) => {
      writes.push(note);
      return { observationId: note.observationId };
    },
  };
  const a = await appendPlanMemo(input, deps),
    b = await appendPlanMemo(input, deps);
  assert.equal(a.observationId, b.observationId);
  assert.equal(writes[0].sourceConversationId, "memo");
  assert.equal(writes[0].eventId, "event");
  assert.deepEqual(writes[0].participants, [
    { contactId: "person", role: "participant" },
  ]);
  assert.equal(writes[0].createEvent, false);
  assert.ok(queries.every(([sql]) => !/DELETE|UPDATE/.test(sql)));
  assert.match(queries.at(-1)[0], /ON CONFLICT.*DO NOTHING/);
});
test("missing or foreign event, memo or contact prevents any note write", async () => {
  let writes = 0;
  await assert.rejects(
    appendPlanMemo(input, {
      query: async () => ({ rows: [] }),
      insert: async () => {
        writes++;
      },
    }),
  );
  await assert.rejects(
    appendPlanMemo(input, {
      query: async (sql) => ({ rows: sql.includes("SELECT id") ? [] : [{}] }),
      insert: async () => {
        writes++;
      },
    }),
  );
  assert.equal(writes, 0);
});
