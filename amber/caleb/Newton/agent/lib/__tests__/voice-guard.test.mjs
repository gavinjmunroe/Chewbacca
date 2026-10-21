/**
 * Tests for lib/voice-guard.js — the deterministic copy guard that scrubs
 * botty phrasing from any reply that doesn't pass through the LLM
 * (festival, calendar runtime, check-ins, proactive runner).
 *
 * Run with:
 *   node --test Newton/agent/lib/__tests__/voice-guard.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  humanize,
  findBottyPhrases,
  assertHumanReply,
} from "../voice-guard.js";

import {
  buildSafeKeywordReply,
  buildSubstanceRedirectReply,
  buildFirstContactGreeting,
} from "../festival.js";

// ── humanize: kills the canonical bot tics ───────────────────────────────

test("humanize strips 'as an AI' disclaimers", () => {
  const cleaned = humanize("As an AI, I cannot give you medical advice.");
  assert.doesNotMatch(cleaned.toLowerCase(), /\bas an ai\b/);
  assert.ok(cleaned.length > 0);
});

test("humanize strips 'I'm just an AI' style disclaimers", () => {
  for (const input of [
    "I'm just an AI and can't help with that.",
    "I am an AI assistant trained to help.",
    "I'm a language model, but here goes.",
  ]) {
    const out = humanize(input);
    assert.doesNotMatch(out.toLowerCase(), /\bi(?:'m| am) (?:just |only )?an ai\b/);
    assert.doesNotMatch(out.toLowerCase(), /\blanguage model\b/);
  }
});

test("humanize strips service-desk closers", () => {
  for (const input of [
    "Done. Let me know if you need anything else!",
    "I sent that. Is there anything else I can help with?",
    "Happy to help! Anything else?",
    "Hope this helps!",
  ]) {
    const out = humanize(input);
    assert.doesNotMatch(out.toLowerCase(), /let me know if you need anything/);
    assert.doesNotMatch(out.toLowerCase(), /is there anything else/);
    assert.doesNotMatch(out.toLowerCase(), /happy to help/);
    assert.doesNotMatch(out.toLowerCase(), /hope (this|that) helps/);
  }
});

test("humanize strips apology spam", () => {
  const out = humanize("I apologize for any confusion. Sorry for the inconvenience.");
  assert.doesNotMatch(out.toLowerCase(), /i apologi[sz]e for/);
  assert.doesNotMatch(out.toLowerCase(), /sorry for the inconvenience/);
});

test("humanize converts em-dashes to commas (house style)", () => {
  const out = humanize("Sounds good — let's go.");
  assert.doesNotMatch(out, /—/);
  assert.match(out, /,/);
});

test("humanize collapses exclamation spam", () => {
  assert.equal(humanize("yes!!!").endsWith("!"), true);
  assert.doesNotMatch(humanize("what?? really??"), /\?\?/);
});

test("humanize is a no-op on already-clean text", () => {
  const clean = "Drink water. Find a friend you trust. Text SAFE anytime.";
  assert.equal(humanize(clean), clean);
});

test("humanize tolerates non-string input", () => {
  assert.equal(humanize(null), null);
  assert.equal(humanize(undefined), undefined);
  assert.equal(humanize(""), "");
  assert.equal(humanize(42), 42);
});

test("humanize trims whitespace and dangling punctuation it leaves behind", () => {
  // Strip "as an AI," then trim leftover leading whitespace/punctuation.
  const out = humanize("As an AI, I think you should hydrate.");
  assert.equal(out.startsWith("I think"), true);
});

// ── findBottyPhrases: surfaces what humanize would scrub ────────────────

test("findBottyPhrases returns hits for botty text", () => {
  const hits = findBottyPhrases("As an AI, let me know if you need anything!");
  assert.ok(hits.length >= 1);
});

test("findBottyPhrases is empty for clean text", () => {
  assert.deepEqual(findBottyPhrases("Drink water. Stay with people you trust."), []);
});

test("findBottyPhrases flags em-dash", () => {
  const hits = findBottyPhrases("Sounds good — let's go.");
  assert.ok(hits.includes("em-dash"));
});

// ── assertHumanReply: opt-in dev guard ───────────────────────────────────

test("assertHumanReply is a no-op when AMBER_STRICT_VOICE is unset", () => {
  const prev = process.env.AMBER_STRICT_VOICE;
  delete process.env.AMBER_STRICT_VOICE;
  try {
    assertHumanReply("As an AI, this would normally fail.");
  } finally {
    if (prev !== undefined) process.env.AMBER_STRICT_VOICE = prev;
  }
});

test("assertHumanReply throws under AMBER_STRICT_VOICE=1", () => {
  const prev = process.env.AMBER_STRICT_VOICE;
  process.env.AMBER_STRICT_VOICE = "1";
  try {
    assert.throws(
      () => assertHumanReply("As an AI, I can't help with that."),
      /voice-guard/,
    );
  } finally {
    if (prev === undefined) delete process.env.AMBER_STRICT_VOICE;
    else process.env.AMBER_STRICT_VOICE = prev;
  }
});

// ── Festival deterministic replies stay clean post-guard ────────────────

test("buildSafeKeywordReply contains no botty phrases or em-dashes", () => {
  const reply = buildSafeKeywordReply();
  assert.deepEqual(findBottyPhrases(reply), []);
  // SAFE keyword content stays intact.
  assert.match(reply.toLowerCase(), /water|hydrat/);
  assert.match(reply.toLowerCase(), /911|medical|emergency/);
});

test("buildSubstanceRedirectReply contains no botty phrases or em-dashes", () => {
  for (const reply of [
    buildSubstanceRedirectReply(),
    buildSubstanceRedirectReply({ urgent: true }),
  ]) {
    assert.deepEqual(findBottyPhrases(reply), [], `botty in: ${reply}`);
  }
});

test("buildFirstContactGreeting stays human and asks for the name", () => {
  const reply = buildFirstContactGreeting({ agentName: "Camber" });
  assert.deepEqual(findBottyPhrases(reply), []);
  assert.match(reply, /Camber/);
  assert.match(reply, /first name/i);
  assert.match(reply, /SAFE/);
});

// ── Compliance regressions: even after de-botification, no drug/romance ─

test("de-botified festival copy still refuses drug facilitation", () => {
  for (const reply of [
    buildSafeKeywordReply(),
    buildSubstanceRedirectReply(),
    buildSubstanceRedirectReply({ urgent: true }),
    buildFirstContactGreeting({ agentName: "Samber" }),
  ]) {
    const lower = reply.toLowerCase();
    assert.doesNotMatch(lower, /\b\d+\s?mg\b/);
    assert.doesNotMatch(lower, /\btake (a |some |the )?(tab|pill|cap|hit)\b/);
    assert.doesNotMatch(lower, /\bdealer\b|\bplug\b|\bwhere to (buy|get|cop|find)\b/);
    assert.doesNotMatch(lower, /\bsafe to (take|combine|mix|use)\b/);
    assert.doesNotMatch(lower, /https?:\/\//);
  }
});

test("de-botified first-contact greeting stays consent-aware (no romance)", () => {
  const reply = buildFirstContactGreeting({ agentName: "Samber" }).toLowerCase();
  assert.doesNotMatch(reply, /\bbabe\b|\bsexy\b|\bbeautiful\b|\bgorgeous\b/);
  assert.doesNotMatch(reply, /\bdate\b|\bhook ?up\b|\bhang.{0,10}alone\b/);
});
