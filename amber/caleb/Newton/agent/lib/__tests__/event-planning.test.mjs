/**
 * Unit tests for the personal event-planning tools (T15).
 *
 * Covers the tool surface, dispatcher routing, and the keyword selector
 * so the new tools actually reach Claude when Sagar pastes his Rytual
 * retreat prompt. The HTTP layer is mocked via global.fetch — we don't
 * want this test depending on a live medha-id.
 *
 * Run: node --test Newton/agent/lib/__tests__/event-planning.test.mjs
 */

// Env vars MUST be set before importing constants.js (it freezes them at
// module-load time). ESM hoists static `import` statements ahead of the
// module body, so setting env at the top is too late — the executor
// tests below use dynamic `import()` after assigning env to guarantee
// constants.js sees the test values.
process.env.AMBER_ID_API_URL =
  process.env.AMBER_ID_API_URL || "https://amber-id-test.invalid";
process.env.AMBER_ID_API_KEY = process.env.AMBER_ID_API_KEY || "test-key";

import { test } from "node:test";
import assert from "node:assert/strict";

// Static imports for tests that don't depend on amber-id env config —
// the tool surface + keyword selector are pure-function inspectable.
const { EVENT_PLANNING_TOOLS } = await import("../tools/event-planning.js");
const { selectToolsByKeyword } = await import("../tool-selector.js");
const { executeEventPlanningTool } = await import("../tools/event-planning.js");

const EXPECTED_TOOL_NAMES = [
  "plan_event",
  "plan_event_add_tasks",
  "plan_event_list",
  "plan_event_get",
  "plan_event_list_tasks",
  "plan_task_update",
  "plan_task_complete",
];

test("EVENT_PLANNING_TOOLS exposes the documented surface", () => {
  const names = EVENT_PLANNING_TOOLS.map((t) => t.name).sort();
  assert.deepEqual(names, [...EXPECTED_TOOL_NAMES].sort());
  for (const tool of EVENT_PLANNING_TOOLS) {
    assert.ok(tool.description && tool.description.length > 20);
    assert.equal(tool.input_schema.type, "object");
  }
});

test("plan_event input_schema requires a title", () => {
  const planEvent = EVENT_PLANNING_TOOLS.find((t) => t.name === "plan_event");
  assert.ok(planEvent.input_schema.required.includes("title"));
  assert.ok(planEvent.input_schema.properties.start_date);
  assert.ok(planEvent.input_schema.properties.end_date);
  assert.ok(planEvent.input_schema.properties.location);
});

test("plan_event_add_tasks requires event_id and a tasks array", () => {
  const tool = EVENT_PLANNING_TOOLS.find(
    (t) => t.name === "plan_event_add_tasks",
  );
  assert.deepEqual(tool.input_schema.required, ["event_id", "tasks"]);
  assert.equal(tool.input_schema.properties.tasks.minItems, 1);
});

test("retreat keyword arms the full plan_event surface", () => {
  // Sagar's actual prompt mentions "Rytual retreat" — the selector must
  // arm enough of the surface that Medha can both create the event and
  // attach tasks in one turn.
  const armed = selectToolsByKeyword(
    "note that my next Rytual retreat will be 7/17-19 in upstate NYC",
  );
  assert.ok(armed.includes("plan_event"));
  assert.ok(armed.includes("plan_event_add_tasks"));
});

test("'still need to do' arms the read surface", () => {
  const armed = selectToolsByKeyword(
    "what do I still need to do for the retreat?",
  );
  assert.ok(armed.includes("plan_event_list_tasks"));
});

test("executor calls amber-id with x-amber-phone + service key", async (t) => {
  const captured = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    captured.push({ url: String(url), init });
    return new Response(
      JSON.stringify({
        ok: true,
        event: { event_id: "event:did:privy:x:s:2026", title: "S" },
      }),
      { status: 201, headers: { "content-type": "application/json" } },
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await executeEventPlanningTool(
    "plan_event",
    { title: "S" },
    { tenant: { phoneNumber: "+15555550100", privyDid: "did:privy:x" } },
  );
  assert.equal(result.ok, true);
  assert.equal(captured.length, 1);
  assert.ok(captured[0].url.includes("/v1/me/events"));
  assert.equal(captured[0].init.method, "POST");
  assert.equal(captured[0].init.headers["x-amber-phone"], "+15555550100");
  assert.equal(captured[0].init.headers["x-api-key"], "test-key");
  const body = JSON.parse(captured[0].init.body);
  assert.equal(body.title, "S");
});

test("plan_event_add_tasks batches all tasks into a single POST", async (t) => {
  const captured = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    captured.push({ url: String(url), init });
    return new Response(
      JSON.stringify({
        ok: true,
        count: 8,
        tasks: new Array(8).fill({}).map((_, i) => ({ order: i })),
      }),
      { status: 201, headers: { "content-type": "application/json" } },
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await executeEventPlanningTool(
    "plan_event_add_tasks",
    {
      event_id: "event:did:privy:x:retreat:2026",
      tasks: [
        { title: "Book an Airbnb" },
        { title: "Make a Partiful invite" },
        { title: "Make an Apple invite" },
        { title: "Outreach to close friends" },
        { title: "Coordinate food, transport, drinks" },
        { title: "Coordinate activities, facilitators, artwork" },
        { title: "Get content ready" },
        { title: "Confirm final spots, receive payment" },
      ],
    },
    { tenant: { phoneNumber: "+15555550100" } },
  );
  assert.equal(result.ok, true);
  assert.equal(result.count, 8);
  // Single POST, not eight.
  assert.equal(captured.length, 1);
  assert.equal(captured[0].init.method, "POST");
  assert.ok(captured[0].url.includes("/tasks"));
  const body = JSON.parse(captured[0].init.body);
  assert.equal(body.tasks.length, 8);
});

test("plan_task_complete sends PATCH with status=done", async (t) => {
  const captured = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    captured.push({ url: String(url), init });
    return new Response(
      JSON.stringify({
        ok: true,
        task: { status: "done", completed_at: "2026-05-27T20:00:00Z" },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await executeEventPlanningTool(
    "plan_task_complete",
    {
      event_id: "event:did:privy:x:retreat:2026",
      task_id: "task:event:did:privy:x:retreat:2026:000:book-airbnb",
    },
    { tenant: { phoneNumber: "+15555550100" } },
  );
  assert.equal(result.ok, true);
  assert.equal(captured[0].init.method, "PATCH");
  const body = JSON.parse(captured[0].init.body);
  assert.equal(body.status, "done");
});

test("executor surfaces a structured error when tenant phone is missing", async () => {
  const result = await executeEventPlanningTool(
    "plan_event",
    { title: "x" },
    { tenant: {} },
  );
  assert.equal(result.error, "tenant_phone_missing");
});

test("executor rejects an unknown tool name", async () => {
  const result = await executeEventPlanningTool(
    "plan_event_telepathy",
    {},
    { tenant: { phoneNumber: "+15555550100" } },
  );
  assert.match(result.error, /Unknown event_planning tool/);
});
