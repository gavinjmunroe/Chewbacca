/**
 * Pinned circles — the route's own decisions.
 *
 * The store talks to Cloud SQL, so what is worth pinning here is everything the
 * route decides on its own, and all three of these have already gone wrong once
 * in this codebase's contact-favorites equivalent:
 *
 *   - THE CAP, and specifically that a RE-pin of something already in the nine
 *     is not refused for being over the limit. Pinning is an upsert; a naive
 *     count-then-reject makes the tenth tap on an already-pinned circle an
 *     error.
 *   - EXISTENCE BEFORE INSERT. The read INNER JOINs circles, so a stale or
 *     foreign id would insert, answer ok, and then be invisible forever. "A
 *     write that cannot be read back must not report success."
 *   - A FAILED READ IS A 500, not an empty list. Returning [] claims "you have
 *     no pinned circles", which is a different sentence from "we could not
 *     ask" -- and that exact swallow hid a completely broken join for weeks.
 *
 * Run with:  node --test src/routes/circle-favorites.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { registerCircleFavoritesRoutes } from "./circle-favorites.js";

const PHONE = "+13105550100";
const OWNER = "amber-uuid-1";
const ID = (n) => `1111111${n}-2222-3333-4444-555555555555`;

function pinned(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: ID(i),
    name: `Circle ${i}`,
    color: "orange",
    classifiedKind: "interest",
    memberCount: 3,
    position: i + 1,
  }));
}

function build(overrides = {}) {
  const app = Fastify({ logger: false });
  const calls = { pinned: [], unpinned: [], reordered: [] };
  registerCircleFavoritesRoutes(app, {
    requireAuth: async (request) => {
      request.privyUser = { userId: "did:privy:abc", phone: PHONE };
    },
    resolveAmberIdByPhone: async () => OWNER,
    listPinnedCircles: async () => pinned(2),
    circleExistsForOwner: async () => true,
    countPinnedCircles: async () => 2,
    pinCircle: async (owner, id) => {
      calls.pinned.push({ owner, id });
      return true;
    },
    unpinCircle: async (owner, id) => {
      calls.unpinned.push({ owner, id });
      return true;
    },
    reorderPinnedCircles: async (owner, ids) => {
      calls.reordered.push({ owner, ids });
      return true;
    },
    ...overrides,
  });
  return { app, calls };
}

const post = (app, circleId) =>
  app.inject({ method: "POST", url: "/v1/me/circle-favorites", payload: { circleId } });

test("GET returns the pinned circles, owner from the session", async () => {
  const { app } = build();
  const res = await app.inject({ method: "GET", url: "/v1/me/circle-favorites" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().circles.length, 2);
  assert.equal(res.json().circles[0].id, ID(0));
});

test("GET: a failed read is a 500, not an empty list", async () => {
  const { app } = build({
    listPinnedCircles: async () => {
      throw new Error("uuid = text is not an operator");
    },
  });
  const res = await app.inject({ method: "GET", url: "/v1/me/circle-favorites" });
  assert.equal(res.statusCode, 500);
  assert.equal(res.json().error, "list_failed");
});

test("POST pins a circle", async () => {
  const { app, calls } = build();
  const res = await post(app, ID(7));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.pinned, [{ owner: OWNER, id: ID(7) }]);
});

test("POST refuses a circle that is not this owner's", async () => {
  const { app, calls } = build({ circleExistsForOwner: async () => false });
  const res = await post(app, ID(7));
  assert.equal(res.statusCode, 404);
  // Nothing was written. The read INNER JOINs circles, so this row would have
  // been invisible forever while the API said ok.
  assert.equal(calls.pinned.length, 0);
});

test("POST refuses a tenth pin", async () => {
  const { app, calls } = build({ listPinnedCircles: async () => pinned(9) });
  const res = await post(app, ID(9));
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().max, 9);
  assert.equal(calls.pinned.length, 0);
});

test("POST allows RE-pinning one already in the nine", async () => {
  // The cap must not turn an upsert into an error. This is the case that a
  // count-then-reject implementation gets wrong.
  const full = pinned(9);
  const { app, calls } = build({ listPinnedCircles: async () => full });
  const res = await post(app, full[4].id);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.pinned.length, 1);
});

test("POST with an unreadable list refuses rather than risking a tenth", async () => {
  const { app, calls } = build({
    listPinnedCircles: async () => {
      throw new Error("down");
    },
    countPinnedCircles: async () => -1,
  });
  const res = await post(app, ID(7));
  assert.equal(res.statusCode, 409);
  assert.equal(calls.pinned.length, 0);
});

test("POST rejects an id that is not a uuid", async () => {
  const { app, calls } = build();
  const res = await post(app, "../../admin");
  assert.equal(res.statusCode, 400);
  assert.equal(calls.pinned.length, 0);
});

test("PUT /order saves the arrangement", async () => {
  const { app, calls } = build();
  const ids = [ID(2), ID(0), ID(1)];
  const res = await app.inject({
    method: "PUT",
    url: "/v1/me/circle-favorites/order",
    payload: { circleIds: ids },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.reordered[0], { owner: OWNER, ids });
});

test("PUT /order rejects a list with a bad id, whole", async () => {
  const { app, calls } = build();
  const res = await app.inject({
    method: "PUT",
    url: "/v1/me/circle-favorites/order",
    payload: { circleIds: [ID(0), "nope"] },
  });
  assert.equal(res.statusCode, 400);
  // Not a partial reorder: the point of the single-statement update is that the
  // arrangement lands completely or not at all.
  assert.equal(calls.reordered.length, 0);
});

test("PUT /order refuses more than the cap", async () => {
  const { app } = build();
  const res = await app.inject({
    method: "PUT",
    url: "/v1/me/circle-favorites/order",
    payload: { circleIds: Array.from({ length: 10 }, (_, i) => ID(i % 10)) },
  });
  assert.equal(res.statusCode, 400);
});

test("DELETE unpins", async () => {
  const { app, calls } = build();
  const res = await app.inject({
    method: "DELETE",
    url: `/v1/me/circle-favorites/${ID(1)}`,
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.unpinned, [{ owner: OWNER, id: ID(1) }]);
});

test("a session with no phone cannot resolve an owner", async () => {
  const { app } = build({
    requireAuth: async (request) => {
      request.privyUser = { userId: "did:privy:abc" };
    },
  });
  const res = await app.inject({ method: "GET", url: "/v1/me/circle-favorites" });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "no_phone_on_session");
});
