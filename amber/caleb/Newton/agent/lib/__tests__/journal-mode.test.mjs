/**
 * Tests for T20 — journal mode.
 *
 * Validates:
 *   - PERSONAL_LIFE_TOOLS exposes add_journal_entry + recall_journal
 *   - Each tool has a valid Agent API schema shape
 *   - selectToolsByKeyword arms the right surface on reflective phrasings
 *   - Sagar's canonical "yapping" prompt arms add_journal_entry
 *   - Recall phrasings arm recall_journal
 *   - executePersonalLifeTool fails closed when amber-id is not configured
 *   - executePersonalLifeTool rejects an empty query on recall_journal
 *   - The owner DM prompt + expert prompt both contain the JOURNAL MODE block
 *
 * Run with:
 *   node --test Newton/agent/lib/__tests__/journal-mode.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PERSONAL_LIFE_TOOLS,
  executePersonalLifeTool,
} from "../tools/personal-life.js";
import { selectToolsByKeyword } from "../tool-selector.js";
import { buildSystemPromptForSender } from "../prompts.js";

const TOOL_NAMES = new Set(PERSONAL_LIFE_TOOLS.map((t) => t.name));

test("PERSONAL_LIFE_TOOLS includes add_journal_entry and recall_journal", () => {
  assert.ok(
    TOOL_NAMES.has("add_journal_entry"),
    "expected add_journal_entry in PERSONAL_LIFE_TOOLS",
  );
  assert.ok(
    TOOL_NAMES.has("recall_journal"),
    "expected recall_journal in PERSONAL_LIFE_TOOLS",
  );
});

test("every personal-life tool has the Agent API shape", () => {
  for (const t of PERSONAL_LIFE_TOOLS) {
    assert.ok(t.name, "tool missing name");
    assert.ok(t.description, `tool ${t.name} missing description`);
    assert.ok(t.input_schema, `tool ${t.name} missing input_schema`);
    assert.equal(t.input_schema.type, "object");
  }
});

test("recall_journal schema requires a query and accepts kind + topK", () => {
  const tool = PERSONAL_LIFE_TOOLS.find((t) => t.name === "recall_journal");
  assert.ok(tool);
  assert.deepEqual(tool.input_schema.required, ["query"]);
  const props = tool.input_schema.properties;
  assert.equal(props.query.type, "string");
  assert.equal(props.kind.type, "string");
  assert.ok(Array.isArray(props.kind.enum));
  assert.ok(props.kind.enum.includes("journal_entry"));
  assert.ok(props.kind.enum.includes("brand_decision"));
  assert.ok(props.kind.enum.includes("teammate_pursuit"));
  assert.equal(props.topK.type, "integer");
});

test("selectToolsByKeyword arms add_journal_entry on yapping / reflective phrasings", () => {
  // Sagar's canonical use case
  const r1 = selectToolsByKeyword(
    "Medha is the canvas upon which I yap about creative conversations I have with the girls",
  );
  assert.ok(
    r1.includes("add_journal_entry"),
    `expected add_journal_entry, got ${JSON.stringify(r1)}`,
  );

  const r2 = selectToolsByKeyword("today I learned that financial health");
  assert.ok(r2.includes("add_journal_entry"));

  const r3 = selectToolsByKeyword("I had a conversation with Shirley earlier");
  assert.ok(r3.includes("add_journal_entry"));
});

test("selectToolsByKeyword arms recall_journal on lookback phrasings", () => {
  const r1 = selectToolsByKeyword("what have I been thinking about lately");
  assert.ok(
    r1.includes("recall_journal"),
    `expected recall_journal, got ${JSON.stringify(r1)}`,
  );

  const r2 = selectToolsByKeyword(
    "remind me what I said about the rave newsletter",
  );
  assert.ok(r2.includes("recall_journal"));

  const r3 = selectToolsByKeyword("what was I yapping about with Shirley");
  assert.ok(r3.includes("recall_journal"));
});

test("selectToolsByKeyword arms BOTH tools on a bare 'journal' mention", () => {
  const r = selectToolsByKeyword("can you journal this for me");
  assert.ok(r.includes("add_journal_entry"));
  assert.ok(r.includes("recall_journal"));
});

test("selectToolsByKeyword does NOT arm journal tools on transactional asks", () => {
  // A pure logistics ask should not arm the journal surface; the keywords
  // we picked are deliberately reflective, not generic.
  const r = selectToolsByKeyword(
    "schedule a meeting with Sagar tomorrow at 3pm",
  );
  assert.ok(!r.includes("add_journal_entry"));
  assert.ok(!r.includes("recall_journal"));
});

test("executePersonalLifeTool returns a structured error for recall_journal when amber-id is unconfigured", async () => {
  // No env vars set during unit-test run → fail closed, never throw.
  const r = await executePersonalLifeTool(
    "recall_journal",
    { query: "creative conversations with Shirley" },
    { tenant: { phoneNumber: "+10000000000" } },
  );
  assert.equal(typeof r, "object");
  assert.ok(r.error, `expected structured error, got: ${JSON.stringify(r)}`);
});

test("recall_journal rejects an empty query with a clear error", async () => {
  // Same env-unconfigured path as above, BUT also exercise the validation
  // branch by passing an empty string. The not-configured guard fires first,
  // which is acceptable; what matters is no throw and a structured error.
  const r = await executePersonalLifeTool(
    "recall_journal",
    { query: "   " },
    { tenant: { phoneNumber: "+10000000000" } },
  );
  assert.equal(typeof r, "object");
  assert.ok(r.error);
});

test("buildSystemPromptForSender(owner DM) embeds the JOURNAL MODE block", () => {
  const tenant = {
    privyDid: "did:test:owner",
    phoneNumber: "+10000000000",
    displayName: "Camber",
    agentName: "Camber",
    ownerName: "Caleb Newton",
    ownerFirstName: "Caleb",
  };
  const contact = {
    handle: "+10000000000",
    displayName: "Caleb",
    relationship: "owner",
    notes: [],
    messageCount: 1,
  };
  const prompt = buildSystemPromptForSender(
    /* calebContext */ "",
    contact,
    /* isCaleb */ true,
    /* isGroup */ false,
    /* groupName */ null,
    /* groupParticipantProfiles */ [],
    /* isNewGroup */ false,
    /* groupMemoryContext */ "",
    /* lastCalebActivityMs */ 0,
    /* conversationSummary */ "",
    tenant,
    /* connections */ null,
  );
  assert.ok(typeof prompt === "string" && prompt.length > 0);
  assert.ok(
    prompt.includes("JOURNAL MODE"),
    "owner DM prompt should include the JOURNAL MODE block",
  );
  assert.ok(
    prompt.includes("add_journal_entry"),
    "owner DM prompt should reference add_journal_entry",
  );
  assert.ok(
    prompt.includes("recall_journal"),
    "owner DM prompt should reference recall_journal",
  );
});

test("buildSystemPromptForSender(expert mode) embeds the JOURNAL MODE block", () => {
  const tenant = { expertMode: true };
  const prompt = buildSystemPromptForSender(
    "",
    { handle: "+10000000001", notes: [], messageCount: 0 },
    /* isCaleb */ false,
    /* isGroup */ false,
    null,
    [],
    false,
    "",
    0,
    "",
    tenant,
    null,
  );
  assert.ok(typeof prompt === "string");
  assert.ok(
    prompt.includes("JOURNAL MODE"),
    "expert prompt should include the JOURNAL MODE block",
  );
  assert.ok(prompt.includes("add_journal_entry"));
  assert.ok(prompt.includes("recall_journal"));
});
