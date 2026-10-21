/**
 * BEING PUT IN SOMEBODY'S CIRCLE IS AN INVITATION.
 *
 * "They should be notified that they are in the circle and be asked to accept if
 *  they want to join the circle."
 *
 * The two properties that matter most here are the ones that protect what
 * already works:
 *
 *   a missing row means ACCEPTED — everyone in a circle today has no row, and
 *   asking them to re-consent would be a regression wearing a feature's clothes.
 *
 *   a circle the viewer has already OPENED is seeded accepted, not pending —
 *   somebody who has been reading a circle for weeks has answered with their
 *   feet.
 *
 * Everything is injected; nothing here touches a database.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  circleInviteStatuses,
  markCircleInvitesNotified,
  openCircleInvites,
  respondToCircleInvite,
} from "./circle-invites.js";
import { notifyPendingCircleInvites } from "../lib/circle-invite-notify.js";

const VIEWER = "11111111-2222-3333-4444-555555555555";
const OWNER = "99999999-8888-7777-6666-555555555555";
const C1 = "aaaaaaaa-0000-0000-0000-000000000001";
const C2 = "aaaaaaaa-0000-0000-0000-000000000002";
const C3 = "aaaaaaaa-0000-0000-0000-000000000003";

/** Records statements; answers the two reads openCircleInvites performs. */
function fake({ pendingBack = [], statuses = [], fail = false } = {}) {
  const calls = [];
  const queryImpl = async (sql, params) => {
    const flat = sql.replace(/\s+/g, " ").trim();
    calls.push({ sql: flat, params });
    if (fail) throw Object.assign(new Error("nope"), { code: "42P01" });
    if (/^INSERT INTO circle_invites/.test(flat)) return { rows: [], rowCount: 1 };
    if (/^UPDATE circle_invites/.test(flat)) return { rows: [], rowCount: 1 };
    if (/status = 'pending'/.test(flat)) {
      return { rows: pendingBack.map((id) => ({ circle_id: id })) };
    }
    if (/SELECT circle_id, status/.test(flat)) {
      return { rows: statuses };
    }
    throw new Error(`unexpected: ${flat}`);
  };
  return { queryImpl, calls };
}

test("opening invites seeds pending, and accepted for a circle already opened", async () => {
  const { queryImpl, calls } = fake({ pendingBack: [C1] });
  const res = await openCircleInvites(VIEWER, [C1, C2], { queryImpl });

  assert.deepEqual(res.pending, [C1]);
  const insert = calls.find((c) => /^INSERT INTO circle_invites/.test(c.sql));
  // THE SEEDING RULE, in the statement itself: a circle_member_seen row makes it
  // accepted, its absence makes it pending.
  assert.match(insert.sql, /LEFT JOIN circle_member_seen/);
  assert.match(insert.sql, /CASE WHEN s\.circle_id IS NULL THEN 'pending' ELSE 'accepted' END/);
  // Never re-asks: an existing answer is left exactly as it is.
  assert.match(insert.sql, /ON CONFLICT \(circle_id, viewer_amber_id\) DO NOTHING/);
});

test("only un-notified pending circles come back to be told about", async () => {
  const { queryImpl, calls } = fake({ pendingBack: [C2] });
  await openCircleInvites(VIEWER, [C1, C2], { queryImpl });
  const read = calls.find((c) => /status = 'pending'/.test(c.sql));
  assert.match(read.sql, /notified_at IS NULL/);
});

test("garbage and duplicate ids never reach the database", async () => {
  const { queryImpl, calls } = fake();
  const res = await openCircleInvites(VIEWER, ["nope", null, C1, C1], { queryImpl });
  const insert = calls.find((c) => /^INSERT INTO circle_invites/.test(c.sql));
  assert.deepEqual(insert.params[1], [C1]);
  assert.ok(Array.isArray(res.pending));

  const none = fake();
  assert.deepEqual(await openCircleInvites(VIEWER, ["nope"], { queryImpl: none.queryImpl }), {
    pending: [],
  });
  assert.equal(none.calls.length, 0);
});

test("a missing status row is absent from the map, which callers read as accepted", async () => {
  const { queryImpl } = fake({ statuses: [{ circle_id: C1, status: "declined" }] });
  const map = await circleInviteStatuses(VIEWER, [C1, C2], { queryImpl });
  assert.equal(map.get(C1), "declined");
  assert.equal(map.has(C2), false);
});

test("a read failure grandfathers everything rather than hiding circles", async () => {
  // The safe direction. An empty map means every circle reads as accepted, i.e.
  // exactly what the app showed before invites existed -- a broken invite table
  // must not make somebody's circles disappear behind a prompt they cannot see.
  const { queryImpl } = fake({ fail: true });
  const map = await circleInviteStatuses(VIEWER, [C1], { queryImpl });
  assert.equal(map.size, 0);
});

test("accepting and declining both write an answer, even with no row to update", async () => {
  const yes = fake();
  assert.deepEqual(await respondToCircleInvite(VIEWER, C1, true, { queryImpl: yes.queryImpl }), {
    status: "accepted",
  });
  const stmt = yes.calls[0];
  // INSERT ... ON CONFLICT DO UPDATE, because a grandfathered member answering
  // has nothing there to update.
  assert.match(stmt.sql, /^INSERT INTO circle_invites/);
  assert.match(stmt.sql, /DO UPDATE SET status = EXCLUDED\.status/);
  assert.equal(stmt.params[2], "accepted");

  const no = fake();
  assert.deepEqual(await respondToCircleInvite(VIEWER, C1, false, { queryImpl: no.queryImpl }), {
    status: "declined",
  });
  assert.equal(no.calls[0].params[2], "declined");
});

test("a bad viewer or circle id is refused without a query", async () => {
  const f = fake();
  assert.deepEqual(await respondToCircleInvite(null, C1, true, { queryImpl: f.queryImpl }), {
    status: null,
  });
  assert.deepEqual(await respondToCircleInvite(VIEWER, "nope", true, { queryImpl: f.queryImpl }), {
    status: null,
  });
  assert.equal(f.calls.length, 0);
});

test("marking notified only touches rows that have not been told", async () => {
  const { queryImpl, calls } = fake();
  await markCircleInvitesNotified(VIEWER, [C1], { queryImpl });
  assert.match(calls[0].sql, /SET notified_at = now\(\)/);
  assert.match(calls[0].sql, /notified_at IS NULL/);
});

// ── the notification ──────────────────────────────────────────────────────────

function inboundCircle(id, name) {
  return {
    id,
    name,
    owner: { amberId: OWNER, name: "Karthik", username: "karthik" },
  };
}

test("a new account is told, once, about each circle waiting for it", async () => {
  const sent = [];
  const marked = [];
  const res = await notifyPendingCircleInvites(null, VIEWER, {
    inboundImpl: async () => [inboundCircle(C1, "Family"), inboundCircle(C2, "Work")],
    openImpl: async () => ({ pending: [C1, C2] }),
    markImpl: async (_v, ids) => marked.push(...ids),
    notifyImpl: async (n) => sent.push(n),
  });

  assert.equal(res.notified, 2);
  assert.equal(sent.length, 2);
  assert.equal(sent[0].title, "Karthik added you to Family");
  // The push has to say there is something to answer, or the accept step is
  // invisible to anyone who does not go looking for it.
  assert.match(sent[0].body, /accept or decline/i);
  // Routed on a type the app handles, and attributed to the person who added
  // them so muting means "not from them".
  assert.equal(sent[0].data.type, "circle");
  assert.equal(sent[0].data.circleId, C1);
  assert.equal(sent[0].fromAmberId, OWNER);
  // Marked only after the push, so a bounced push is retried next launch.
  assert.deepEqual(marked.sort(), [C1, C2].sort());
});

test("a circle already answered or already notified produces no push", async () => {
  const sent = [];
  const res = await notifyPendingCircleInvites(null, VIEWER, {
    inboundImpl: async () => [inboundCircle(C1, "Family")],
    // openCircleInvites reports nothing pending-and-untold.
    openImpl: async () => ({ pending: [] }),
    markImpl: async () => {},
    notifyImpl: async (n) => sent.push(n),
  });
  assert.equal(res.notified, 0);
  assert.equal(sent.length, 0);
});

test("many circles at once become one summary rather than a flood", async () => {
  const sent = [];
  const res = await notifyPendingCircleInvites(null, VIEWER, {
    inboundImpl: async () => [
      inboundCircle(C1, "Family"),
      inboundCircle(C2, "Work"),
      inboundCircle(C3, "School"),
      inboundCircle("aaaaaaaa-0000-0000-0000-000000000004", "Gym"),
    ],
    openImpl: async () => ({
      pending: [C1, C2, C3, "aaaaaaaa-0000-0000-0000-000000000004"],
    }),
    markImpl: async () => {},
    notifyImpl: async (n) => sent.push(n),
  });
  assert.equal(res.notified, 4);
  assert.equal(sent.length, 1);
  assert.match(sent[0].title, /added to 4 circles/);
});

test("nobody has added them, so nothing happens and nothing is written", async () => {
  let opened = 0;
  const res = await notifyPendingCircleInvites(null, VIEWER, {
    inboundImpl: async () => [],
    openImpl: async () => {
      opened += 1;
      return { pending: [] };
    },
    markImpl: async () => {},
    notifyImpl: async () => {},
  });
  assert.equal(res.notified, 0);
  assert.equal(opened, 0);
});

test("a failing notifier cannot take the caller down with it", async () => {
  const res = await notifyPendingCircleInvites(null, VIEWER, {
    inboundImpl: async () => [inboundCircle(C1, "Family")],
    openImpl: async () => ({ pending: [C1] }),
    markImpl: async () => {},
    notifyImpl: async () => {
      throw new Error("expo said no");
    },
  });
  // Reported as nothing notified rather than thrown: this runs detached from a
  // device registering itself, and that request must still succeed.
  assert.equal(res.notified, 0);
});
