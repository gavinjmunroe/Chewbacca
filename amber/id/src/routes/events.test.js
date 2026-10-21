/**
 * Integration tests for /v1/me/events*. Uses Fastify's inject() against
 * an in-memory Firestore stand-in injected through registerEventsRoutes'
 * `deps` parameter — no real Firestore, no real Privy.
 *
 * The build brief requires us to cover:
 *   - create + retrieve an event card
 *   - append items (interactions / scan extractions / drafts)
 *   - retrieve the latest plan via GET /:event_id/plan
 *   - private visibility cannot be overridden
 *   - substance-procurement language is blocked and never persisted
 *   - harm-reduction language is allowed but tagged safety_context
 *
 * Run with:  node --test src/routes/events.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { registerEventsRoutes } from "./events.js";

const TEST_DID = "did:privy:sagar-test";

/** Tiny in-memory Firestore: { [tenantDid]: { [table]: Map(rowKey -> row) } }. */
function makeFakeStore() {
  const data = new Map();
  const logs = new Map();
  const key = (did, table) => `${did}::${table}`;
  function bucket(map, did, table) {
    const k = key(did, table);
    if (!map.has(k)) map.set(k, new Map());
    return map.get(k);
  }
  const now = () => new Date().toISOString();
  return {
    data,
    logs,
    agentDataGet: async ({ tenantDid, table, rowKey }) => {
      return bucket(data, tenantDid, table).get(rowKey) || null;
    },
    agentDataUpsert: async ({ tenantDid, table, rowKey, row }) => {
      const existing = bucket(data, tenantDid, table).get(rowKey) || {};
      bucket(data, tenantDid, table).set(rowKey, {
        ...existing,
        ...row,
        updated_at: now(),
      });
    },
    agentDataQuery: async ({ tenantDid, table, filters, limit }) => {
      let out = [...bucket(data, tenantDid, table).values()];
      if (Array.isArray(filters)) {
        for (const f of filters) {
          if (f?.op !== "eq") continue;
          out = out.filter((r) => r[f.col] === f.value);
        }
      }
      return out.slice(0, limit || 500);
    },
    agentDataDelete: async ({ tenantDid, table, rowKey }) => {
      bucket(data, tenantDid, table).delete(rowKey);
    },
    agentLogInsert: async ({ tenantDid, table, row }) => {
      const arr = logs.get(key(tenantDid, table)) || [];
      arr.unshift({ ...row, created_at: now() });
      logs.set(key(tenantDid, table), arr);
    },
    agentLogQuery: async ({ tenantDid, table, filters, limit }) => {
      const arr = logs.get(key(tenantDid, table)) || [];
      let out = arr;
      if (Array.isArray(filters)) {
        for (const f of filters) {
          if (f?.op !== "eq") continue;
          out = out.filter((r) => r[f.col] === f.value);
        }
      }
      return out.slice(0, limit || 50);
    },
  };
}

/** Auth stub: stamps the request as if a Privy JWT for TEST_DID was presented. */
function authStub() {
  return async (request) => {
    request.privyUser = { userId: TEST_DID };
  };
}

function makeFakeIndexer() {
  const events = [];
  const tasks = [];
  return {
    events,
    tasks,
    indexEvent: async (did, event) => {
      events.push({ did, event_id: event.event_id, title: event.title });
      return { indexed: true };
    },
    indexTask: async (did, _event, task) => {
      tasks.push({ did, task_id: task.task_id, title: task.title });
      return { indexed: true };
    },
    deleteEventVector: async () => ({ deleted: true }),
    deleteTaskVector: async () => ({ deleted: true }),
  };
}

function buildApp() {
  const store = makeFakeStore();
  const indexer = makeFakeIndexer();
  const app = Fastify({ logger: false });
  registerEventsRoutes(app, {
    ...store,
    ...indexer,
    requireApiKeyOrAuth: authStub(),
    tenantIndex: { getByPhone: () => null },
  });
  return { app, store, indexer };
}

test("POST /v1/me/events creates a card with deterministic event_id", async () => {
  const { app } = buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/me/events",
    payload: { title: "EDC 2026", year: 2026 },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(body.event.event_id, `event:${TEST_DID}:edc-2026:2026`);
  assert.equal(body.event.title, "EDC 2026");
  assert.equal(body.event.visibility, "private");
  assert.equal(body.event.owner_did, TEST_DID);
  await app.close();
});

test("POST /v1/me/events rejects non-private visibility", async () => {
  const { app } = buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/me/events",
    payload: { title: "EDC 2026", visibility: "public" },
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().message || "", /visibility/);
  await app.close();
});

test("GET /v1/me/events/:event_id returns the card", async () => {
  const { app } = buildApp();
  await app.inject({
    method: "POST",
    url: "/v1/me/events",
    payload: {
      title: "EDC 2026",
      year: 2026,
      latest_plan: "north brown lot 9pm",
    },
  });
  const res = await app.inject({
    method: "GET",
    url: `/v1/me/events/event:${TEST_DID}:edc-2026:2026`,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().event.latest_plan, "north brown lot 9pm");
  await app.close();
});

test("GET /v1/me/events/:event_id rejects another tenant's id", async () => {
  const { app } = buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/v1/me/events/event:did:privy:someoneelse:edc-2026:2026",
  });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error, "event_not_found");
  await app.close();
});

test("POST /:event_id/items stores allowed items and tags safety context", async () => {
  const { app, store } = buildApp();
  await app.inject({
    method: "POST",
    url: "/v1/me/events",
    payload: { title: "EDC 2026", year: 2026 },
  });
  const eventId = `event:${TEST_DID}:edc-2026:2026`;
  const res = await app.inject({
    method: "POST",
    url: `/v1/me/events/${eventId}/items`,
    payload: {
      items: [
        { kind: "scan_extraction", text: "meet at brown lot 9pm" },
        {
          kind: "safety_context",
          text: "remember to hydrate and check on each other",
        },
      ],
    },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.stored, 2);
  assert.equal(body.blocked, 0);
  assert.equal(body.results[0].decision, "allow");
  assert.equal(body.results[1].decision, "safety_context");

  const logKey = `${TEST_DID}::event_items`;
  const persisted = store.logs.get(logKey) || [];
  assert.equal(persisted.length, 2);
  assert.equal(
    persisted.every((r) => r.visibility === "private"),
    true,
  );
  const safetyRow = persisted.find((r) => r.kind === "safety_context");
  assert.equal(safetyRow.safety_status, "safety_context");
  await app.close();
});

test("POST /:event_id/items blocks substance-procurement items and does not persist them", async () => {
  const { app, store } = buildApp();
  await app.inject({
    method: "POST",
    url: "/v1/me/events",
    payload: { title: "EDC 2026", year: 2026 },
  });
  const eventId = `event:${TEST_DID}:edc-2026:2026`;
  const res = await app.inject({
    method: "POST",
    url: `/v1/me/events/${eventId}/items`,
    payload: {
      items: [
        {
          kind: "scan_extraction",
          text: "can someone buy molly before the set",
        },
      ],
    },
  });
  assert.equal(res.statusCode, 422);
  const body = res.json();
  assert.equal(body.blocked, 1);
  assert.equal(body.stored, 0);
  assert.equal(body.blocked_details[0].code, "substance_procurement_blocked");
  const persisted = store.logs.get(`${TEST_DID}::event_items`) || [];
  assert.equal(persisted.length, 0);
  await app.close();
});

test("POST /:event_id/items mixes allow + block per-item", async () => {
  const { app, store } = buildApp();
  await app.inject({
    method: "POST",
    url: "/v1/me/events",
    payload: { title: "EDC 2026", year: 2026 },
  });
  const eventId = `event:${TEST_DID}:edc-2026:2026`;
  const res = await app.inject({
    method: "POST",
    url: `/v1/me/events/${eventId}/items`,
    payload: {
      items: [
        { kind: "scan_extraction", text: "meet at brown lot 9pm" },
        { kind: "scan_extraction", text: "dealer dropping off coke at hotel" },
        { kind: "safety_context", text: "buddy check at 2am, ride home plan" },
      ],
    },
  });
  // mixed batch returns 200 because at least one item stored
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.stored, 2);
  assert.equal(body.blocked, 1);
  const persisted = store.logs.get(`${TEST_DID}::event_items`) || [];
  assert.equal(persisted.length, 2);
  assert.ok(
    !persisted.some((r) => /coke|dealer/.test((r.text || "").toLowerCase())),
  );
  await app.close();
});

test("GET /:event_id/plan returns latest_plan and next_meetup only", async () => {
  const { app } = buildApp();
  await app.inject({
    method: "POST",
    url: "/v1/me/events",
    payload: {
      title: "EDC 2026",
      year: 2026,
      latest_plan: "next meetup: north brown 9-10pm",
      next_meetup: { where: "north brown", when: "9-10pm" },
      ticket_ledger: [{ owner: "sagar", state: "claimed" }], // should NOT leak
    },
  });
  const res = await app.inject({
    method: "GET",
    url: `/v1/me/events/event:${TEST_DID}:edc-2026:2026/plan`,
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.latest_plan, "next meetup: north brown 9-10pm");
  assert.deepEqual(body.next_meetup, { where: "north brown", when: "9-10pm" });
  assert.equal(body.ticket_ledger, undefined);
  assert.equal(body.payment_ledger, undefined);
  await app.close();
});

test("POST /:event_id/summarize blocks procurement language", async () => {
  const { app } = buildApp();
  await app.inject({
    method: "POST",
    url: "/v1/me/events",
    payload: { title: "EDC 2026", year: 2026 },
  });
  const res = await app.inject({
    method: "POST",
    url: `/v1/me/events/event:${TEST_DID}:edc-2026:2026/summarize`,
    payload: { latest_plan: "pick up molly at 8 then meet at brown lot" },
  });
  assert.equal(res.statusCode, 422);
  assert.equal(res.json().code, "substance_procurement_blocked");
  await app.close();
});

test("POST /:event_id/summarize stamps the card and appends a plan_snapshot", async () => {
  const { app, store } = buildApp();
  await app.inject({
    method: "POST",
    url: "/v1/me/events",
    payload: { title: "EDC 2026", year: 2026 },
  });
  const eventId = `event:${TEST_DID}:edc-2026:2026`;
  const res = await app.inject({
    method: "POST",
    url: `/v1/me/events/${eventId}/summarize`,
    payload: { latest_plan: "meet at north brown 9pm; backup yellow star" },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(
    body.event.latest_plan,
    "meet at north brown 9pm; backup yellow star",
  );
  assert.equal(body.event.visibility, "private");
  const log = store.logs.get(`${TEST_DID}::event_items`) || [];
  assert.equal(log[0].kind, "plan_snapshot");
  await app.close();
});

test("DELETE /v1/me/events/:event_id removes the card", async () => {
  const { app, store } = buildApp();
  await app.inject({
    method: "POST",
    url: "/v1/me/events",
    payload: { title: "EDC 2026", year: 2026 },
  });
  const eventId = `event:${TEST_DID}:edc-2026:2026`;
  const del = await app.inject({
    method: "DELETE",
    url: `/v1/me/events/${eventId}`,
  });
  assert.equal(del.statusCode, 200);
  const get = await app.inject({
    method: "GET",
    url: `/v1/me/events/${eventId}`,
  });
  assert.equal(get.statusCode, 404);
  assert.equal(store.data.get(`${TEST_DID}::events`).size, 0);
  await app.close();
});

test("GET /v1/me/events lists the caller's events", async () => {
  const { app } = buildApp();
  await app.inject({
    method: "POST",
    url: "/v1/me/events",
    payload: { title: "EDC 2026", year: 2026 },
  });
  await app.inject({
    method: "POST",
    url: "/v1/me/events",
    payload: { title: "Coachella 2026", year: 2026 },
  });
  const res = await app.inject({ method: "GET", url: "/v1/me/events" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.count, 2);
  assert.ok(body.events.every((e) => e.visibility === "private"));
  assert.ok(body.events.every((e) => e.owner_did === TEST_DID));
  await app.close();
});

test("PATCH /v1/me/events/:event_id merges fields and keeps visibility private", async () => {
  const { app } = buildApp();
  await app.inject({
    method: "POST",
    url: "/v1/me/events",
    payload: { title: "EDC 2026", year: 2026, latest_plan: "v1" },
  });
  const eventId = `event:${TEST_DID}:edc-2026:2026`;
  const patch = await app.inject({
    method: "PATCH",
    url: `/v1/me/events/${eventId}`,
    payload: { latest_plan: "v2 — meet at NB8 9pm" },
  });
  assert.equal(patch.statusCode, 200);
  assert.equal(patch.json().event.latest_plan, "v2 — meet at NB8 9pm");
  assert.equal(patch.json().event.title, "EDC 2026");
  assert.equal(patch.json().event.visibility, "private");

  const blocked = await app.inject({
    method: "PATCH",
    url: `/v1/me/events/${eventId}`,
    payload: { visibility: "public" },
  });
  assert.equal(blocked.statusCode, 400);
  await app.close();
});

test("GET /:event_id/items returns items newest-first and filters by kind", async () => {
  const { app } = buildApp();
  await app.inject({
    method: "POST",
    url: "/v1/me/events",
    payload: { title: "EDC 2026", year: 2026 },
  });
  const eventId = `event:${TEST_DID}:edc-2026:2026`;
  await app.inject({
    method: "POST",
    url: `/v1/me/events/${eventId}/items`,
    payload: {
      items: [
        { kind: "draft_update", text: "draft: meet at NB8 9pm" },
        { kind: "scan_extraction", text: "Sagar to confirm rides" },
      ],
    },
  });
  const all = await app.inject({
    method: "GET",
    url: `/v1/me/events/${eventId}/items`,
  });
  assert.equal(all.statusCode, 200);
  assert.equal(all.json().count, 2);

  const onlyDrafts = await app.inject({
    method: "GET",
    url: `/v1/me/events/${eventId}/items?kind=draft_update`,
  });
  assert.equal(onlyDrafts.json().count, 1);
  assert.equal(onlyDrafts.json().items[0].kind, "draft_update");
  await app.close();
});

// ─── Personal-planning task routes ──────────────────────────────────────────

async function seedRytualRetreat(app) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/me/events",
    payload: {
      title: "Rytual Retreat",
      year: 2026,
      slug: "rytual-retreat",
      start_date: "2026-07-17",
      end_date: "2026-07-19",
      location: "Upstate NYC",
      description: "Founder + close friends retreat",
      status: "planning",
    },
  });
  return { res, eventId: `event:${TEST_DID}:rytual-retreat:2026` };
}

test("POST /v1/me/events accepts the personal-planning field set", async () => {
  const { app, indexer } = buildApp();
  const { res } = await seedRytualRetreat(app);
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.equal(body.event.location, "Upstate NYC");
  assert.equal(body.event.start_date, "2026-07-17");
  assert.equal(body.event.end_date, "2026-07-19");
  assert.equal(body.event.status, "planning");
  // The card embed fired (fire-and-forget — race-free in test because the
  // fake indexer returns immediately).
  await new Promise((r) => setImmediate(r));
  assert.equal(indexer.events.length, 1);
  await app.close();
});

test("POST /v1/me/events rejects an unknown status value at the schema", async () => {
  const { app } = buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/me/events",
    payload: { title: "x", status: "in_orbit" },
  });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test("POST /v1/me/events/:event_id/tasks creates Sagar's 8 retreat tasks", async () => {
  const { app, indexer } = buildApp();
  const { eventId } = await seedRytualRetreat(app);
  const sagarTasks = [
    "Book an Airbnb",
    "Make a Partiful invite",
    "Make an Apple invite with spreadsheet + powerpoint for confirmed attendees",
    "Outreach to close friends",
    "Coordinate food, transport, drinks",
    "Coordinate activities, facilitators, artwork",
    "Get content ready",
    "Confirm final spots, receive payment",
  ];
  const res = await app.inject({
    method: "POST",
    url: `/v1/me/events/${eventId}/tasks`,
    payload: { tasks: sagarTasks.map((title) => ({ title })) },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.equal(body.count, 8);
  assert.equal(body.tasks.length, 8);
  for (let i = 0; i < 8; i++) {
    assert.equal(body.tasks[i].title, sagarTasks[i]);
    assert.equal(body.tasks[i].status, "open");
    assert.equal(body.tasks[i].order, i);
    assert.equal(body.tasks[i].event_id, eventId);
  }
  await new Promise((r) => setImmediate(r));
  // 8 task embeds + 1 event embed from create + 1 from refresh after batch
  assert.equal(indexer.tasks.length, 8);
  assert.ok(indexer.events.length >= 2);

  // Counters on the card reflect the open list.
  const card = await app.inject({
    method: "GET",
    url: `/v1/me/events/${eventId}`,
  });
  assert.equal(card.json().event.task_count, 8);
  assert.equal(card.json().event.task_open_count, 8);
  await app.close();
});

test("GET /v1/me/events/:event_id/tasks sorts by order and filters by status", async () => {
  const { app } = buildApp();
  const { eventId } = await seedRytualRetreat(app);
  await app.inject({
    method: "POST",
    url: `/v1/me/events/${eventId}/tasks`,
    payload: {
      tasks: [
        { title: "First" },
        { title: "Second" },
        { title: "Third", status: "done" },
      ],
    },
  });
  const all = await app.inject({
    method: "GET",
    url: `/v1/me/events/${eventId}/tasks`,
  });
  assert.equal(all.statusCode, 200);
  assert.equal(all.json().count, 3);
  assert.equal(all.json().tasks[0].title, "First");
  assert.equal(all.json().tasks[2].title, "Third");
  const openOnly = await app.inject({
    method: "GET",
    url: `/v1/me/events/${eventId}/tasks?status=open`,
  });
  assert.equal(openOnly.json().count, 2);
  await app.close();
});

test("PATCH task to status=done stamps completed_at and refreshes card counters", async () => {
  const { app } = buildApp();
  const { eventId } = await seedRytualRetreat(app);
  const created = await app.inject({
    method: "POST",
    url: `/v1/me/events/${eventId}/tasks`,
    payload: { tasks: [{ title: "Book an Airbnb" }] },
  });
  const taskId = created.json().tasks[0].task_id;

  const patched = await app.inject({
    method: "PATCH",
    url: `/v1/me/events/${eventId}/tasks/${taskId}`,
    payload: { status: "done" },
  });
  assert.equal(patched.statusCode, 200);
  assert.equal(patched.json().task.status, "done");
  assert.ok(patched.json().task.completed_at);

  const card = await app.inject({
    method: "GET",
    url: `/v1/me/events/${eventId}`,
  });
  assert.equal(card.json().event.task_count, 1);
  assert.equal(card.json().event.task_open_count, 0);
  await app.close();
});

test("PATCH rejects a task_id that doesn't belong to the event", async () => {
  const { app } = buildApp();
  const { eventId } = await seedRytualRetreat(app);
  // A task id whose embedded event_id points to a different event.
  const foreignTaskId = `task:event:${TEST_DID}:other:2026:000:x`;
  const res = await app.inject({
    method: "PATCH",
    url: `/v1/me/events/${eventId}/tasks/${foreignTaskId}`,
    payload: { status: "done" },
  });
  assert.equal(res.statusCode, 404);
  await app.close();
});

test("DELETE task removes the row, audits, and refreshes counters", async () => {
  const { app } = buildApp();
  const { eventId } = await seedRytualRetreat(app);
  const created = await app.inject({
    method: "POST",
    url: `/v1/me/events/${eventId}/tasks`,
    payload: { tasks: [{ title: "Outreach" }, { title: "Confirm" }] },
  });
  const taskId = created.json().tasks[0].task_id;

  const del = await app.inject({
    method: "DELETE",
    url: `/v1/me/events/${eventId}/tasks/${taskId}`,
  });
  assert.equal(del.statusCode, 200);
  const list = await app.inject({
    method: "GET",
    url: `/v1/me/events/${eventId}/tasks`,
  });
  assert.equal(list.json().count, 1);
  assert.equal(list.json().tasks[0].title, "Confirm");
  await app.close();
});

test("POST /tasks rejects unknown status enum at the schema layer", async () => {
  const { app } = buildApp();
  const { eventId } = await seedRytualRetreat(app);
  const res = await app.inject({
    method: "POST",
    url: `/v1/me/events/${eventId}/tasks`,
    payload: { tasks: [{ title: "x", status: "snoozed" }] },
  });
  assert.equal(res.statusCode, 400);
  await app.close();
});
