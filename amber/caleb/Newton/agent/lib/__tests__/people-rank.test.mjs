// people-rank.test.mjs
// Tab 34 - guards + summary rendering for the people_rank tool.
// Env is set before importing so constants.js sees a configured amber-id.

import test from "node:test";
import assert from "node:assert/strict";

process.env.AMBER_ID_API_URL = "https://amber-id.test";
process.env.AMBER_ID_API_KEY = "test-key";

const { executePeopleRankTool, PEOPLE_RANK_TOOLS } =
  await import("../tools/people-rank.js");

const TENANT = { tenant: { privyDid: "did:privy:medha" } };

function mockFetch(payload, { capture } = {}) {
  const orig = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => {
    if (capture) capture.body = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      async json() {
        return payload;
      },
      async text() {
        return JSON.stringify(payload);
      },
    };
  };
  return () => {
    globalThis.fetch = orig;
  };
}

test("schema exposes people_rank with all intents and required intent", () => {
  const tool = PEOPLE_RANK_TOOLS.find((t) => t.name === "people_rank");
  assert.ok(tool);
  assert.deepEqual(tool.input_schema.properties.intent.enum, [
    "top_composite",
    "top_warmth",
    "top_centrality",
    "top_recency",
    "top_relevance",
    "drift_alerts",
    "score_for",
  ]);
  assert.deepEqual(tool.input_schema.required, ["intent"]);
});

test("rejects an unknown tool name", async () => {
  const r = await executePeopleRankTool("nope", {}, TENANT);
  assert.ok(r.error);
});

test("requires a resolved tenant did", async () => {
  const r = await executePeopleRankTool(
    "people_rank",
    { intent: "top_composite" },
    {
      tenant: null,
    },
  );
  assert.match(r.error, /resolved tenant/);
});

test("validates the intent", async () => {
  const r = await executePeopleRankTool(
    "people_rank",
    { intent: "bogus" },
    TENANT,
  );
  assert.match(r.error, /intent must be one of/);
});

test("score_for needs a contact reference", async () => {
  const r = await executePeopleRankTool(
    "people_rank",
    { intent: "score_for" },
    TENANT,
  );
  assert.match(r.error, /score_for needs/);
});

test("drift_alerts validates an explicit drift_type", async () => {
  const r = await executePeopleRankTool(
    "people_rank",
    { intent: "drift_alerts", drift_type: "nope" },
    TENANT,
  );
  assert.match(r.error, /drift_type must be one of/);
});

test("synthetic expert tenants short-circuit empty", async () => {
  const r = await executePeopleRankTool(
    "people_rank",
    { intent: "top_composite" },
    { tenant: { privyDid: "did:expert:xyz" } },
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows, []);
});

test("top_composite clamps limit and summarizes ranked rows", async () => {
  const capture = {};
  const restore = mockFetch(
    {
      ok: true,
      rows: [
        {
          contact_name: "Shirley",
          composite_score: 0.82,
          warmth_score: 0.9,
          recency_score: 0.7,
          centrality_score: 0.4,
        },
        {
          contact_name: "Sagar",
          composite_score: 0.61,
          warmth_score: 0.5,
          recency_score: 0.6,
          centrality_score: 0.8,
        },
      ],
    },
    { capture },
  );
  try {
    const r = await executePeopleRankTool(
      "people_rank",
      { intent: "top_composite", limit: 999 },
      TENANT,
    );
    assert.equal(r.ok, true);
    assert.equal(r.count, 2);
    assert.equal(capture.body.target_did, "did:privy:medha");
    assert.equal(capture.body.limit, 50); // clamped from 999
    assert.match(r.summary, /Top relationships/);
    assert.match(r.summary, /1\. Shirley: 0\.82/);
  } finally {
    restore();
  }
});

test("drift_alerts renders cooling and going-dark lines", async () => {
  const restore = mockFetch({
    ok: true,
    rows: [
      {
        contact_name: "Carlo",
        alert_type: "cooling_alert",
        change_pct: -0.4,
        from_score: 1,
        to_score: 0.6,
        severity: "medium",
      },
      {
        contact_name: "Maggie",
        alert_type: "going_dark",
        silence_days: 95,
        severity: "high",
      },
    ],
  });
  try {
    const r = await executePeopleRankTool(
      "people_rank",
      { intent: "drift_alerts" },
      TENANT,
    );
    assert.equal(r.ok, true);
    assert.match(r.summary, /Carlo: cooling -0\.4/);
    assert.match(r.summary, /Maggie: going dark/);
  } finally {
    restore();
  }
});

test("score_for returns one contact's breakdown", async () => {
  const restore = mockFetch({
    ok: true,
    row: {
      contact_name: "Carlo",
      composite_score: 0.55,
      warmth_score: 0.6,
      centrality_score: 0.3,
      recency_score: 0.7,
      relevance_score: 0.2,
    },
  });
  try {
    const r = await executePeopleRankTool(
      "people_rank",
      { intent: "score_for", contact_name: "Carlo" },
      TENANT,
    );
    assert.equal(r.ok, true);
    assert.match(r.summary, /Carlo: composite 0\.55/);
  } finally {
    restore();
  }
});

test("empty ranked result explains scores have not accrued", async () => {
  const restore = mockFetch({ ok: true, rows: [] });
  try {
    const r = await executePeopleRankTool(
      "people_rank",
      { intent: "top_warmth" },
      TENANT,
    );
    assert.equal(r.count, 0);
    assert.match(r.summary, /No PeopleRank scores yet/);
  } finally {
    restore();
  }
});
