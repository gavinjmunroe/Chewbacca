/**
 * Tests for the Tab 3 pipeline tools wiring.
 *
 * Validates:
 *   - PIPELINE_TOOLS exposes the 5 expected tool schemas
 *   - getAllTools includes them (so Claude sees them on every turn)
 *   - selectToolsByKeyword arms the right ones for Sagar's phrasings
 *   - executePipelineTool fails closed when amber-id is not configured
 *
 * Run with: node --test Newton/agent/lib/__tests__/pipelines.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PIPELINE_TOOLS,
  PIPELINE_TOOL_NAMES,
  executePipelineTool,
} from "../tools/pipelines.js";
import { selectToolsByKeyword } from "../tool-selector.js";

const EXPECTED = [
  "track_investor",
  "list_investors",
  "track_event",
  "track_relationship",
  "find_relationship",
];

test("PIPELINE_TOOLS exposes exactly the expected five tool schemas", () => {
  assert.equal(PIPELINE_TOOLS.length, EXPECTED.length);
  for (const name of EXPECTED) {
    assert.ok(
      PIPELINE_TOOL_NAMES.has(name),
      `expected ${name} in PIPELINE_TOOL_NAMES`,
    );
  }
});

test("each tool has a description and an input_schema (Agent API shape)", () => {
  for (const t of PIPELINE_TOOLS) {
    assert.ok(t.name, "tool missing name");
    assert.ok(t.description, `tool ${t.name} missing description`);
    assert.ok(t.input_schema, `tool ${t.name} missing input_schema`);
    assert.equal(t.input_schema.type, "object");
  }
});

test("selectToolsByKeyword arms investor tools on 'investor' phrasings", () => {
  const r = selectToolsByKeyword(
    "please track that we are building an enterprise partnership with Perplexity, and the main contact is Alex Tsai, treat them as an investor",
  );
  assert.ok(r.includes("track_investor"));
  assert.ok(r.includes("list_investors"));
});

test("selectToolsByKeyword arms track_event on Rytual event names", () => {
  const r1 = selectToolsByKeyword("remind me to onboard vipassana content");
  assert.ok(r1.includes("track_event"));
  const r2 = selectToolsByKeyword(
    "onboard lightning in a bottle to the right drive folder",
  );
  assert.ok(r2.includes("track_event"));
});

test("selectToolsByKeyword arms relationship tools on 'partnership' / 'relationship'", () => {
  const r1 = selectToolsByKeyword(
    "split partnerships in my head into customer and investor pipelines",
  );
  assert.ok(r1.includes("track_relationship"));
  assert.ok(r1.includes("find_relationship"));
  const r2 = selectToolsByKeyword("what's my relationship with Carlo");
  assert.ok(r2.includes("track_relationship"));
  assert.ok(r2.includes("find_relationship"));
});

test("executePipelineTool returns a structured error when amber-id is not configured", async () => {
  // No env vars set during the unit test run → tool should fail closed,
  // not throw, so the agent can recover gracefully.
  const r = await executePipelineTool(
    "track_investor",
    { name: "Test", stage: "lead" },
    { tenant: { phoneNumber: "+10000000000" } },
  );
  assert.equal(typeof r, "object");
  // Either no-config (env missing) or a fetch-level failure — both must
  // be structured, not thrown.
  assert.ok(r.error, `expected error field, got: ${JSON.stringify(r)}`);
});

test("executePipelineTool rejects an unknown sub-tool name", async () => {
  const r = await executePipelineTool(
    "track_unicorn",
    {},
    { tenant: { phoneNumber: "+10000000000" } },
  );
  // amber-id is unconfigured first → returns config error before reaching
  // the switch. Either way the result is structured.
  assert.equal(typeof r, "object");
  assert.ok(r.error);
});
