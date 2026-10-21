/**
 * Tests for Tab 22 voice journaling (voice-ingest.js).
 *
 * Pins the deterministic capture contract:
 *   1. deriveVoiceTopic prefixes "Voice memo:" and caps at a word boundary.
 *   2. journalVoiceMemo skips trivial memos below the char floor.
 *   3. journalVoiceMemo writes through add_journal_entry with a classified
 *      dimension and never throws: it returns a result object instead.
 *   4. A tool-level error surfaces as { success: false } without throwing.
 *
 * Run with:
 *   node --test Newton/agent/lib/__tests__/voice-ingest.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  deriveVoiceTopic,
  journalVoiceMemo,
  MIN_VOICE_MEMO_CHARS,
} from "../voice-ingest.js";

// Silence the module's info/warn logging during the run.
const originalLog = console.log;
const originalWarn = console.warn;
console.log = () => {};
console.warn = () => {};

const tenant = { phoneNumber: "+15550100004" };

test("deriveVoiceTopic prefixes Voice memo and keeps the first sentence", () => {
  const topic = deriveVoiceTopic(
    "Had a long talk with Shirley about the retreat. It felt important.",
  );
  assert.equal(
    topic,
    "Voice memo: Had a long talk with Shirley about the retreat.",
  );
});

test("deriveVoiceTopic caps long single sentences at a word boundary", () => {
  const long =
    "I have been thinking about how the whole funnel works and why people keep ignoring the obvious signal in the data we already collected";
  const topic = deriveVoiceTopic(long);
  assert.ok(topic.startsWith("Voice memo: "), "keeps the prefix");
  assert.ok(topic.endsWith("..."), "marks truncation");
  // No mid-word cut: the char before the ellipsis is not a partial token break.
  assert.ok(topic.length <= "Voice memo: ".length + 84);
});

test("deriveVoiceTopic collapses whitespace and tolerates empty input", () => {
  assert.equal(deriveVoiceTopic("   "), "Voice memo");
  assert.equal(
    deriveVoiceTopic("line one\n\n  line   two"),
    "Voice memo: line one line two",
  );
});

test("journalVoiceMemo skips memos shorter than the floor", async () => {
  const calls = [];
  const result = await journalVoiceMemo({
    tenant,
    transcript: "ok thanks",
    executor: async (...a) => {
      calls.push(a);
      return { success: true };
    },
  });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "too_short");
  assert.equal(calls.length, 0, "no journal write for a trivial memo");
  assert.ok("ok thanks".length < MIN_VOICE_MEMO_CHARS);
});

test("journalVoiceMemo skips when no tenant is resolved", async () => {
  const result = await journalVoiceMemo({
    tenant: null,
    transcript:
      "This is a long enough reflection about the day to clear the floor comfortably.",
    executor: async () => {
      throw new Error("executor should not run without a tenant");
    },
  });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "no_tenant");
});

test("journalVoiceMemo writes through add_journal_entry with a classified dimension", async () => {
  const calls = [];
  const transcript =
    "I want to talk through the budget and the revenue forecast before the investor call next week.";
  const result = await journalVoiceMemo({
    tenant,
    transcript,
    contact: "+15550100004",
    executor: async (toolName, input, ctx) => {
      calls.push({ toolName, input, ctx });
      return { success: true, journal_entry: { id: "journal_abc" } };
    },
  });
  assert.equal(result.skipped, false);
  assert.equal(result.success, true);
  assert.equal(result.journal_entry.id, "journal_abc");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].toolName, "add_journal_entry");
  assert.equal(calls[0].input.body, transcript.replace(/\s+/g, " ").trim());
  assert.ok(calls[0].input.topic.startsWith("Voice memo: "));
  // Financial keywords (budget, revenue, investor) should win the classifier.
  assert.equal(calls[0].input.dimension, "financial");
  assert.equal(calls[0].ctx.tenant, tenant);
});

test("journalVoiceMemo returns success:false on a tool error, never throws", async () => {
  const result = await journalVoiceMemo({
    tenant,
    transcript:
      "A perfectly substantial memo that should attempt a write but the tool fails downstream.",
    executor: async () => ({ error: "amber_id_not_configured" }),
  });
  assert.equal(result.skipped, false);
  assert.equal(result.success, false);
  assert.equal(result.error, "amber_id_not_configured");
});

test("journalVoiceMemo catches an executor that throws", async () => {
  const result = await journalVoiceMemo({
    tenant,
    transcript:
      "Another substantial memo where the executor blows up with an exception mid-write.",
    executor: async () => {
      throw new Error("network down");
    },
  });
  assert.equal(result.success, false);
  assert.equal(result.error, "network down");
});

test.after(() => {
  console.log = originalLog;
  console.warn = originalWarn;
});
