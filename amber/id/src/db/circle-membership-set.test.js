/**
 * SAVING A CIRCLE IS ONE ROUND TRIP, AND ONE RECONCILE.
 *
 * Ten minutes to make one change to one circle came from two multipliers
 * stacked on each other: the editor sent one HTTP request per added and per
 * removed member, sequentially, and each of those requests awaited a reconcile
 * of every member fact in the whole circle plus a push notification. Twelve
 * members was twelve serial round trips each redoing the whole circle's work.
 *
 * So there are two things to hold in place, and this file holds both:
 *
 *   setCircleMembers       - the whole membership in one call, four statements
 *                            regardless of member count, with ids that are not
 *                            the owner's contacts reported rather than fatal.
 *   scheduleCircleFactSync - the reconcile debounced and detached, so a burst
 *                            of edits collapses into one run and no request
 *                            waits on it.
 *
 * Both take injected implementations, so nothing here touches a database or a
 * timer it does not control.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { setCircleMembers } from "./circles-store.js";
import {
  scheduleCircleFactSync,
  _clearScheduledFactSyncs,
  _scheduledFactSyncCount,
} from "./circle-fact-sync.js";

const OWNER = "11111111-2222-3333-4444-555555555555";
const CIRCLE = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const A = "aaaaaaaa-0000-0000-0000-000000000001";
const B = "aaaaaaaa-0000-0000-0000-000000000002";
const C = "aaaaaaaa-0000-0000-0000-000000000003";
const NOT_HIS = "aaaaaaaa-0000-0000-0000-0000000000ff";

/**
 * A fake database that answers the four statements setCircleMembers issues and
 * records every one of them. `owns` is the set of contacts that belong to the
 * owner; `present` is who is in the circle before the call.
 */
function fakeDb({ circleExists = true, owns = [A, B, C], present = [] } = {}) {
  const calls = [];
  const queryImpl = async (sql, params) => {
    const flat = sql.replace(/\s+/g, " ").trim();
    calls.push({ sql: flat, params });

    if (/^SELECT id FROM circles/.test(flat)) {
      return { rows: circleExists ? [{ id: CIRCLE }] : [] };
    }
    if (/FROM contacts/.test(flat)) {
      const asked = params[1] || [];
      return { rows: asked.filter((id) => owns.includes(id)).map((id) => ({ id })) };
    }
    if (/^INSERT INTO circle_members/.test(flat)) {
      const target = params[1] || [];
      // ON CONFLICT DO NOTHING: only genuinely new rows come back.
      return {
        rows: target.filter((id) => !present.includes(id)).map((id) => ({ contact_id: id })),
      };
    }
    if (/^DELETE FROM circle_members/.test(flat)) {
      const target = params[1] || [];
      return {
        rows: present.filter((id) => !target.includes(id)).map((id) => ({ contact_id: id })),
      };
    }
    throw new Error(`unexpected statement: ${flat}`);
  };
  return { queryImpl, calls };
}

test("setCircleMembers writes the whole membership in a fixed number of statements", async () => {
  const { queryImpl, calls } = fakeDb({ owns: [A, B, C], present: [A] });

  const res = await setCircleMembers(OWNER, CIRCLE, [A, B, C], { queryImpl });

  assert.equal(res.status, "ok");
  assert.deepEqual(res.added.sort(), [B, C]);
  assert.deepEqual(res.removed, []);
  assert.deepEqual(res.unknown, []);
  assert.equal(res.total, 3);
  // THE POINT OF THE WHOLE CHANGE: three members, four statements. Not one
  // statement per member, and emphatically not one request per member.
  assert.equal(calls.length, 4, `expected 4 statements, got ${calls.length}`);
});

test("the statement count does not grow with the number of members", async () => {
  const many = Array.from(
    { length: 30 },
    (_, i) => `aaaaaaaa-0000-0000-0000-00000000${String(i).padStart(4, "0")}`,
  );
  const { queryImpl, calls } = fakeDb({ owns: many, present: [] });

  const res = await setCircleMembers(OWNER, CIRCLE, many, { queryImpl });

  assert.equal(res.status, "ok");
  // Thirty is the ceiling he asked for; it must cost the same as three.
  assert.equal(res.added.length, 30);
  assert.equal(res.total, 30);
  assert.equal(calls.length, 4);
});

test("removals and additions happen in the same call", async () => {
  const { queryImpl } = fakeDb({ owns: [A, B, C], present: [A, B] });

  const res = await setCircleMembers(OWNER, CIRCLE, [B, C], { queryImpl });

  assert.equal(res.status, "ok");
  assert.deepEqual(res.added, [C]);
  assert.deepEqual(res.removed, [A]);
  assert.equal(res.total, 2);
});

test("an empty list empties the circle rather than being ignored", async () => {
  const { queryImpl } = fakeDb({ owns: [A, B], present: [A, B] });

  const res = await setCircleMembers(OWNER, CIRCLE, [], { queryImpl });

  assert.equal(res.status, "ok");
  assert.deepEqual(res.removed.sort(), [A, B]);
  assert.equal(res.total, 0);
});

test("ids that are not the owner's contacts are reported, not fatal", async () => {
  // This is the honest version of "2 members failed to sync". A stale id (a
  // contact deleted from the address book mid-edit) must not cost the others
  // their membership, and must not be described as a failure.
  const { queryImpl } = fakeDb({ owns: [A, B], present: [] });

  const res = await setCircleMembers(OWNER, CIRCLE, [A, B, NOT_HIS], { queryImpl });

  assert.equal(res.status, "ok");
  assert.deepEqual(res.added.sort(), [A, B]);
  assert.deepEqual(res.unknown, [NOT_HIS]);
  assert.equal(res.total, 2);
});

test("duplicate ids in the request are collapsed", async () => {
  const { queryImpl, calls } = fakeDb({ owns: [A, B], present: [] });

  const res = await setCircleMembers(OWNER, CIRCLE, [A, A, B, A], { queryImpl });

  assert.equal(res.status, "ok");
  assert.deepEqual(res.added.sort(), [A, B]);
  const insert = calls.find((c) => /^INSERT INTO circle_members/.test(c.sql));
  assert.deepEqual(insert.params[1].sort(), [A, B]);
});

test("garbage ids are dropped before they reach the database", async () => {
  const { queryImpl, calls } = fakeDb({ owns: [A], present: [] });

  const res = await setCircleMembers(OWNER, CIRCLE, [A, "not-a-uuid", null, ""], { queryImpl });

  assert.equal(res.status, "ok");
  assert.deepEqual(res.added, [A]);
  const contactCheck = calls.find((c) => /FROM contacts/.test(c.sql));
  assert.deepEqual(contactCheck.params[1], [A]);
});

test("a circle the caller does not own is not found, and nothing is written", async () => {
  const { queryImpl, calls } = fakeDb({ circleExists: false });

  const res = await setCircleMembers(OWNER, CIRCLE, [A, B], { queryImpl });

  assert.equal(res.status, "not_found");
  // Ownership is checked FIRST. One statement ran and no write did.
  assert.equal(calls.length, 1);
  assert.ok(!calls.some((c) => /INSERT|DELETE/.test(c.sql)));
});

test("every write is scoped to the owner", async () => {
  const { queryImpl, calls } = fakeDb({ owns: [A, B], present: [C] });

  await setCircleMembers(OWNER, CIRCLE, [A, B], { queryImpl });

  for (const c of calls) {
    assert.ok(c.params.includes(OWNER), `statement without an owner parameter: ${c.sql}`);
  }
});

test("a missing owner or an unparseable circle id is rejected without a query", async () => {
  const { queryImpl, calls } = fakeDb();
  assert.equal((await setCircleMembers(null, CIRCLE, [A], { queryImpl })).status, "invalid");
  assert.equal((await setCircleMembers(OWNER, "nope", [A], { queryImpl })).status, "invalid");
  assert.equal(calls.length, 0);
});

test("a database failure is reported as an error, not as a silent empty save", async () => {
  const queryImpl = async () => {
    throw Object.assign(new Error("connection terminated"), { code: "08006" });
  };
  const res = await setCircleMembers(OWNER, CIRCLE, [A], { queryImpl });
  assert.equal(res.status, "error");
});

// -- the debounced reconcile --------------------------------------------------

test("the fact sync is debounced, so a burst of edits reconciles once", async () => {
  _clearScheduledFactSyncs();
  const runs = [];
  const syncImpl = async (ownerId, circleId) => {
    runs.push([ownerId, circleId]);
  };

  for (let i = 0; i < 5; i += 1) {
    scheduleCircleFactSync(OWNER, CIRCLE, { syncImpl, delayMs: 5 });
  }
  // Five schedules, one pending run.
  assert.equal(_scheduledFactSyncCount(), 1);
  // Nothing has run yet: the request it was scheduled from is not waiting on it.
  assert.equal(runs.length, 0);

  await new Promise((r) => setTimeout(r, 40));
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0], [OWNER, CIRCLE]);
  assert.equal(_scheduledFactSyncCount(), 0);
});

test("different circles are debounced independently", async () => {
  _clearScheduledFactSyncs();
  const runs = [];
  const syncImpl = async (_o, circleId) => {
    runs.push(circleId);
  };
  const OTHER = "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee";

  scheduleCircleFactSync(OWNER, CIRCLE, { syncImpl, delayMs: 5 });
  scheduleCircleFactSync(OWNER, OTHER, { syncImpl, delayMs: 5 });
  assert.equal(_scheduledFactSyncCount(), 2);

  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(runs.slice().sort(), [CIRCLE, OTHER].sort());
});

test("a failing reconcile does not throw into the process", async () => {
  _clearScheduledFactSyncs();
  const syncImpl = async () => {
    throw new Error("reconcile blew up");
  };
  scheduleCircleFactSync(OWNER, CIRCLE, { syncImpl, delayMs: 5 });
  await new Promise((r) => setTimeout(r, 40));
  // Reaching here at all is the assertion: an unhandled rejection in a detached
  // background task would take the server down with it.
  assert.equal(_scheduledFactSyncCount(), 0);
});

test("scheduling without an owner or a circle is a no-op", () => {
  _clearScheduledFactSyncs();
  scheduleCircleFactSync(null, CIRCLE, { syncImpl: async () => {}, delayMs: 5 });
  scheduleCircleFactSync(OWNER, null, { syncImpl: async () => {}, delayMs: 5 });
  assert.equal(_scheduledFactSyncCount(), 0);
});
