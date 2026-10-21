// contact-graph.test.mjs
// Tab 33 - guards + summary rendering for the contact_graph agent tool.
// Env is set before importing so constants.js sees a configured amber-id.

import test from "node:test";
import assert from "node:assert/strict";

process.env.AMBER_ID_API_URL = "https://amber-id.test";
process.env.AMBER_ID_API_KEY = "test-key";

const { executeContactGraphTool, CONTACT_GRAPH_TOOLS } =
  await import("../tools/contact-graph.js");

const TENANT = { tenant: { privyDid: "did:privy:medha" } };

function mockFetch(payload) {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
  });
  return () => {
    globalThis.fetch = orig;
  };
}

test("tool schema exposes contact_graph with the three intents", () => {
  const tool = CONTACT_GRAPH_TOOLS.find((t) => t.name === "contact_graph");
  assert.ok(tool);
  assert.deepEqual(tool.input_schema.properties.intent.enum, [
    "mutual",
    "intro_path",
    "neighborhood",
  ]);
  assert.deepEqual(tool.input_schema.required, ["intent", "contact_a"]);
});

test("rejects an unknown tool name", async () => {
  const r = await executeContactGraphTool("nope", {}, TENANT);
  assert.ok(r.error);
});

test("requires a resolved tenant", async () => {
  const r = await executeContactGraphTool(
    "contact_graph",
    { intent: "neighborhood", contact_a: "Carlo" },
    {},
  );
  assert.match(r.error, /resolved tenant/);
});

test("returns empty for synthetic expert tenants", async () => {
  const r = await executeContactGraphTool(
    "contact_graph",
    { intent: "neighborhood", contact_a: "Carlo" },
    { tenant: { privyDid: "did:expert:foo" } },
  );
  assert.equal(r.ok, true);
  assert.match(r.summary, /No relationship graph/);
});

test("rejects an invalid intent", async () => {
  const r = await executeContactGraphTool(
    "contact_graph",
    { intent: "sideways", contact_a: "Carlo" },
    TENANT,
  );
  assert.match(r.error, /intent must be one of/);
});

test("requires contact_a", async () => {
  const r = await executeContactGraphTool(
    "contact_graph",
    { intent: "neighborhood" },
    TENANT,
  );
  assert.match(r.error, /contact_a/);
});

test("mutual and intro_path require contact_b", async () => {
  const r1 = await executeContactGraphTool(
    "contact_graph",
    { intent: "mutual", contact_a: "Sagar" },
    TENANT,
  );
  assert.match(r1.error, /contact_b/);
  const r2 = await executeContactGraphTool(
    "contact_graph",
    { intent: "intro_path", contact_a: "Caleb" },
    TENANT,
  );
  assert.match(r2.error, /contact_b/);
});

test("neighborhood renders a ranked connection list", async () => {
  const restore = mockFetch({
    ok: true,
    query: "neighborhood",
    neighbors: [
      {
        name: "Sagar",
        edge_type: "co_mentioned",
        edge_strength: 0.8,
        evidence_count: 6,
      },
      {
        name: "Maggie",
        edge_type: "shared_calendar",
        edge_strength: 0.4,
        evidence_count: 2,
      },
    ],
  });
  try {
    const r = await executeContactGraphTool(
      "contact_graph",
      { intent: "neighborhood", contact_a: "Carlo" },
      TENANT,
    );
    assert.equal(r.ok, true);
    assert.match(r.summary, /Carlo's closest connections/);
    assert.match(r.summary, /Sagar/);
    assert.match(r.summary, /strength 0\.8/);
  } finally {
    restore();
  }
});

test("mutual renders combined-strength rows", async () => {
  const restore = mockFetch({
    ok: true,
    query: "mutual",
    mutuals: [{ name: "Karthik", combined_strength: 1.2 }],
  });
  try {
    const r = await executeContactGraphTool(
      "contact_graph",
      { intent: "mutual", contact_a: "Sagar", contact_b: "Carlo" },
      TENANT,
    );
    assert.equal(r.ok, true);
    assert.match(r.summary, /Mutual connections between Sagar and Carlo/);
    assert.match(r.summary, /Karthik/);
  } finally {
    restore();
  }
});

test("intro_path renders the chain", async () => {
  const restore = mockFetch({
    ok: true,
    query: "intro_path",
    found: true,
    hops: 2,
    path: [
      { id: "name:caleb", name: "Caleb" },
      { id: "name:sagar", name: "Sagar" },
      { id: "name:stripe-eng", name: "Dana" },
    ],
  });
  try {
    const r = await executeContactGraphTool(
      "contact_graph",
      { intent: "intro_path", contact_a: "Caleb", contact_b: "Dana", hops: 3 },
      TENANT,
    );
    assert.equal(r.ok, true);
    assert.match(r.summary, /Intro path \(2 hops\)/);
    assert.match(r.summary, /Caleb -> Sagar -> Dana/);
  } finally {
    restore();
  }
});

test("intro_path with no route explains the empty graph", async () => {
  const restore = mockFetch({
    ok: true,
    query: "intro_path",
    found: false,
    path: [],
  });
  try {
    const r = await executeContactGraphTool(
      "contact_graph",
      { intent: "intro_path", contact_a: "Caleb", contact_b: "Nobody" },
      TENANT,
    );
    assert.equal(r.ok, true);
    assert.match(r.summary, /No introduction path found/);
  } finally {
    restore();
  }
});
