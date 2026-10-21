/**
 * Tests for the Medha vs Togari ownership table (T14).
 *
 * Two production regressions motivated this test file. Both are quoted from
 * Sagar's Slack threads (2026-05-26 / 27):
 *
 *   1. Sagar: "@Medha show me my active content pipeline"
 *      Medha: "That's Togari's lane. BMA content pipeline lives in their CRM.
 *      Text +1 (555) 010-0003..."  <- WRONG
 *
 *   2. Sagar: "@Medha please add a planning session by Wednesday to review
 *      how to talk with potential Rytual investor Jared Jamin..."
 *      Medha: "That's solidly in Togari's lane, investor prep, pipeline
 *      strategy..."  <- WRONG
 *
 * The system prompt builder must encode the corrected ownership rule in
 * every context Medha replies from (expert, owner-DM, group). This test
 * file verifies the encoding statically. It does NOT verify model
 * behavior; that requires live dev testing (acceptance criteria are in
 * the T14 dispatch spec).
 *
 * Run with:
 *   node --test Newton/agent/lib/__tests__/ownership-routing.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildOwnershipBlock } from "../capabilities.js";
import { buildSystemPromptForSender } from "../prompts.js";

// Lightweight fixtures so the prompt builder can run end to end without
// touching tenant.js / health.js externals beyond what they need. The
// builder reads tenant fields with the optional-chaining defaults, so a
// near-empty object is enough to exercise every branch.
const baseTenant = {
  privyDid: "did:test:t14",
  phoneNumber: "+15005550100",
  loopSenderId: "sender-uuid",
  agentName: "Samber",
  displayName: "Samber",
  ownerFirstName: "Sagar",
  ownerName: "Sagar Tiwari",
};

const expertTenant = { ...baseTenant, expertMode: true };

const sagarContact = {
  handle: "+15005550101",
  displayName: "Sagar Tiwari",
  relationship: "owner",
  messageCount: 25,
  notes: [],
};

// ── buildOwnershipBlock unit tests ───────────────────────────────────────

test("ownership block encodes Sagar's one-line rule (customer = Togari, investor = Medha)", () => {
  const block = buildOwnershipBlock();
  assert.match(block, /customer = Togari/i);
  assert.match(block, /investor = Medha/i);
});

test("ownership block claims creative work for Medha", () => {
  const block = buildOwnershipBlock();
  // The body of the MEDHA OWNS list must mention creative work explicitly so
  // the model can match it against prompts like "show me my content pipeline".
  assert.match(block, /Creative work in any form/i);
  assert.match(block, /content/i);
});

test("ownership block claims events and community for Medha", () => {
  const block = buildOwnershipBlock();
  assert.match(block, /Events and community building/i);
  assert.match(block, /retreat/i);
});

test("ownership block claims investor outreach for Medha", () => {
  const block = buildOwnershipBlock();
  assert.match(block, /Investor outreach and relationships/i);
  assert.match(block, /pitch/i);
});

test("ownership block claims journal mode for Medha", () => {
  const block = buildOwnershipBlock();
  assert.match(block, /Personal journal/i);
});

test("ownership block claims non-customer partnerships for Medha", () => {
  const block = buildOwnershipBlock();
  assert.match(block, /Partnerships of any non-customer kind/i);
  // Specific example Sagar named (Perplexity / Alex Tsai) should be in scope.
  assert.match(block, /Perplexity/);
});

test("ownership block claims teammates' creative pursuits for Medha", () => {
  const block = buildOwnershipBlock();
  assert.match(block, /Teammates'? creative pursuits/i);
  assert.match(block, /Shirley/);
});

test("ownership block narrows Togari to customer pipeline only", () => {
  const block = buildOwnershipBlock();
  assert.match(block, /Customer pipeline \/ sales CRM/i);
  assert.match(block, /sales targets/i);
  // Explicit narrowing: BMA's own brand voice stays with Medha; only
  // third-party agency-client deliverables route to Togari.
  assert.match(block, /third-party.*client|agency-CLIENT/i);
});

test("ownership block sets the AMBIGUOUS-default to Medha", () => {
  const block = buildOwnershipBlock();
  assert.match(block, /DEFAULT WHEN AMBIGUOUS:\s*Medha/i);
});

test("ownership block records both production failure modes as anti-cases", () => {
  const block = buildOwnershipBlock();
  // Thread 1: "show me my active content pipeline" -> must default to Medha.
  assert.match(block, /show me my active content pipeline/);
  assert.match(block, /Content default is creative\/personal\/Rytual/);
  // Thread 2: "add a planning session to talk with potential investor X".
  assert.match(block, /planning session to talk with potential investor/);
  assert.match(block, /Investor prep is the human side/);
});

test("ownership block includes the one Togari-routed case for contrast", () => {
  const block = buildOwnershipBlock();
  // Sagar's exact contrast example: "show my BMA customer pipeline" is the
  // ONLY shape that should route to Togari. Keep this in the block so the
  // model has a concrete positive example.
  assert.match(block, /show my BMA customer pipeline.*Togari/i);
});

// ── prompt-context integration: the block is wired into every surface ───

test("expert prompt includes the ownership block", () => {
  const prompt = buildSystemPromptForSender(
    null, // calebContext
    sagarContact,
    false, // isCaleb
    false, // isGroup
    null, // groupName
    [], // participants
    false, // isNewGroup
    "", // groupMemoryContext
    0, // lastCalebActivityMs
    "", // conversationSummary
    expertTenant,
    null, // connections
  );
  assert.match(prompt, /OWNERSHIP TABLE/);
  assert.match(prompt, /DEFAULT WHEN AMBIGUOUS:\s*Medha/);
  // Lane guardrail must be present so Medha doesn't open with the bad string.
  assert.match(prompt, /Do NOT open a reply with "That's Togari's lane"/);
});

test("owner-DM prompt includes the ownership block", () => {
  const prompt = buildSystemPromptForSender(
    "Caleb context here.",
    sagarContact,
    true, // isCaleb (owner)
    false, // isGroup
    null,
    [],
    false,
    "",
    0,
    "",
    baseTenant,
    null,
  );
  assert.match(prompt, /OWNERSHIP TABLE/);
  assert.match(prompt, /DEFAULT WHEN AMBIGUOUS:\s*Medha/);
  // The owner-DM-specific guardrail block should be present too.
  assert.match(prompt, /LANE GUARDRAIL/);
  // And the IDENTITY_FOOTER must be appended (regression test for the
  // missing-return bug fixed alongside T14).
  assert.match(prompt, /FINAL IDENTITY OVERRIDE/);
});

test("group prompt includes the ownership block", () => {
  const prompt = buildSystemPromptForSender(
    "Caleb context here.",
    sagarContact,
    true, // isCaleb
    true, // isGroup
    "BMA Team",
    [{ displayName: "Shirley", handle: "+15005550102", notes: [] }],
    false,
    "",
    0,
    "",
    baseTenant,
    null,
  );
  assert.match(prompt, /OWNERSHIP TABLE/);
  assert.match(prompt, /DEFAULT WHEN AMBIGUOUS:\s*Medha/);
  // The group prompt's lane guardrail.
  assert.match(prompt, /Do NOT open a reply with "That's Togari's lane"/);
  // IDENTITY_FOOTER appended (regression test for the unreachable-return
  // bug fixed alongside T14).
  assert.match(prompt, /FINAL IDENTITY OVERRIDE/);
});

// ── Sagar's actual production prompts: each should land Medha in-lane ───

test("Sagar test case: content pipeline ask reads the Medha default in prompt", () => {
  const prompt = buildSystemPromptForSender(
    null,
    sagarContact,
    false,
    false,
    null,
    [],
    false,
    "",
    0,
    "",
    expertTenant,
    null,
  );
  // The text Medha looks at when deciding whether "show me my active content
  // pipeline" is hers. The presence of these strings is what makes the model
  // resolve the ambiguity toward Medha instead of Togari.
  assert.match(
    prompt,
    /"Content" without "BMA agency client" attached = Medha/,
  );
  assert.match(prompt, /"Pipeline" alone = Medha/);
});

test("Sagar test case: investor prep ask reads as Medha in prompt", () => {
  const prompt = buildSystemPromptForSender(
    null,
    sagarContact,
    false,
    false,
    null,
    [],
    false,
    "",
    0,
    "",
    expertTenant,
    null,
  );
  assert.match(prompt, /"Investor" anything = Medha. Always/);
});

test("Sagar test case: events / planning session ask reads as Medha in prompt", () => {
  const prompt = buildSystemPromptForSender(
    null,
    sagarContact,
    false,
    false,
    null,
    [],
    false,
    "",
    0,
    "",
    expertTenant,
    null,
  );
  assert.match(
    prompt,
    /"Events" \/ "planning session" \/ "retreat" \/ "gathering" = Medha. Always/,
  );
});

test("Sagar test case: BMA customer pipeline still routes to Togari", () => {
  const prompt = buildSystemPromptForSender(
    null,
    sagarContact,
    false,
    false,
    null,
    [],
    false,
    "",
    0,
    "",
    expertTenant,
    null,
  );
  // This is the one shape Medha should still hand off. Verify the rule is
  // explicit so the model has a concrete positive trigger for handoff.
  assert.match(prompt, /show my BMA customer pipeline.*Togari/i);
});
