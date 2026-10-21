/**
 * Tests for the festival / Friday MVP safety helpers.
 *
 * These cover the deterministic, pre-LLM handlers that ship in the
 * festival MVP: the SAFE keyword, substance redirection, the first-contact
 * greeting gate, and name extraction.
 *
 * Run with:
 *   node --test Newton/agent/lib/__tests__/festival.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  matchesSafeKeyword,
  mentionsSubstance,
  isUrgentSubstanceSignal,
  buildSafeKeywordReply,
  buildSubstanceRedirectReply,
  shouldSendFirstContactGreeting,
  buildFirstContactGreeting,
  extractFirstNameFromReply,
} from "../festival.js";

// ── SAFE keyword matcher ───────────────────────────────────────────────────

test("matchesSafeKeyword: plain SAFE fires", () => {
  assert.equal(matchesSafeKeyword("SAFE"), true);
  assert.equal(matchesSafeKeyword("safe"), true);
  assert.equal(matchesSafeKeyword(" Safe "), true);
  assert.equal(matchesSafeKeyword("SAFE!"), true);
  assert.equal(matchesSafeKeyword("safe."), true);
});

test("matchesSafeKeyword: prose containing 'safe' does NOT fire", () => {
  // Critical: avoid false positives on everyday speech.
  assert.equal(matchesSafeKeyword("drive safe"), false);
  assert.equal(matchesSafeKeyword("is it safe to drink this water"), false);
  assert.equal(matchesSafeKeyword("safe travels"), false);
  assert.equal(matchesSafeKeyword("am I safe here?"), false);
});

test("matchesSafeKeyword: null/empty returns false", () => {
  assert.equal(matchesSafeKeyword(null), false);
  assert.equal(matchesSafeKeyword(""), false);
  assert.equal(matchesSafeKeyword("   "), false);
});

// ── SAFE reply content ────────────────────────────────────────────────────

test("buildSafeKeywordReply: harm-reduction script with no sourcing/dosing", () => {
  const reply = buildSafeKeywordReply().toLowerCase();
  // Must include the four harm-reduction beats.
  assert.match(reply, /water|hydrat/, "mentions hydration");
  assert.match(reply, /friend|medical|security|tent/, "mentions trusted help");
  assert.match(reply, /rideshare|home|ride/, "mentions getting home");
  assert.match(reply, /911|emergency|medical/, "mentions emergency escalation");
  // Must NOT contain anything that looks like drug guidance.
  assert.doesNotMatch(reply, /\bdose|dosage|mg\b|\bmilligrams?\b/);
  assert.doesNotMatch(reply, /\bbuy\b|\bsource\b|\bdealer\b|\bplug\b/);
  assert.doesNotMatch(reply, /\btake (a|some|the) (tab|pill|cap|hit)\b/);
  // No external URLs (per spec).
  assert.doesNotMatch(reply, /https?:\/\//);
});

// ── Substance detection ──────────────────────────────────────────────────

test("mentionsSubstance: catches common festival substances", () => {
  for (const phrase of [
    "I took some molly",
    "we rolled last night",
    "got any acid",
    "shrooms are kicking in",
    "popped a tab",
    "should I redose",
    "where can I get some tabs",
    "I dropped a cap",
    "ketamine please",
    "2C-B is here",
  ]) {
    assert.equal(mentionsSubstance(phrase), true, `should match: ${phrase}`);
  }
});

test("mentionsSubstance: doesn't fire on innocent text", () => {
  for (const phrase of [
    "hey what's up",
    "see you at the festival",
    "what time does the set start",
    "I'm at the food trucks",
    "my friend is here",
  ]) {
    assert.equal(mentionsSubstance(phrase), false, `should not match: ${phrase}`);
  }
});

test("isUrgentSubstanceSignal: flags medical-emergency phrasing", () => {
  assert.equal(isUrgentSubstanceSignal("he's overdosing"), true);
  assert.equal(isUrgentSubstanceSignal("she's unresponsive"), true);
  assert.equal(isUrgentSubstanceSignal("can't breathe"), true);
  assert.equal(isUrgentSubstanceSignal("blue lips"), true);
  assert.equal(isUrgentSubstanceSignal("having a bad trip"), true);
  // Should not over-fire on casual mention
  assert.equal(isUrgentSubstanceSignal("I took molly"), false);
});

// ── Substance redirect copy ──────────────────────────────────────────────

test("buildSubstanceRedirectReply: refuses sourcing/dosing/medical advice", () => {
  const reply = buildSubstanceRedirectReply().toLowerCase();
  // Pivots to safety
  assert.match(reply, /safe|hydrat|trust|harm.?reduction|test/);
  // Does NOT do any of the disallowed things
  assert.doesNotMatch(reply, /\bdose|dosage|\d+\s?mg\b/);
  assert.doesNotMatch(reply, /\bbuy\b|\bsource\b|\bdealer\b|\bplug\b|\bwhere to (get|find|cop)\b/);
  assert.doesNotMatch(reply, /\bsafe to (take|use|combine|mix)\b/);
  // No external URLs
  assert.doesNotMatch(reply, /https?:\/\//);
  // Mentions the SAFE keyword pull-cord
  assert.match(reply, /safe/);
});

test("buildSubstanceRedirectReply: urgent variant points to 911 / medical", () => {
  const reply = buildSubstanceRedirectReply({ urgent: true }).toLowerCase();
  assert.match(reply, /911|medical/);
  assert.doesNotMatch(reply, /\bdose|dosage|\d+\s?mg\b/);
  assert.doesNotMatch(reply, /https?:\/\//);
});

// ── First-contact greeting gate ──────────────────────────────────────────

test("shouldSendFirstContactGreeting: brand-new DM contact qualifies", () => {
  const contact = { handle: "+15551234567", messageCount: 0, isCaleb: false };
  assert.equal(
    shouldSendFirstContactGreeting({ contact, isGroup: false, isOwner: false }),
    true,
  );
});

test("shouldSendFirstContactGreeting: known name skips", () => {
  const contact = {
    handle: "+15551234567",
    messageCount: 0,
    displayName: "Maya",
  };
  assert.equal(
    shouldSendFirstContactGreeting({ contact, isGroup: false, isOwner: false }),
    false,
  );
});

test("shouldSendFirstContactGreeting: already greeted skips", () => {
  const contact = {
    handle: "+15551234567",
    messageCount: 1,
    festivalGreetedAt: "2026-05-11T00:00:00.000Z",
  };
  assert.equal(
    shouldSendFirstContactGreeting({ contact, isGroup: false, isOwner: false }),
    false,
  );
});

test("shouldSendFirstContactGreeting: existing conversation skips", () => {
  const contact = { handle: "+15551234567", messageCount: 5 };
  assert.equal(
    shouldSendFirstContactGreeting({ contact, isGroup: false, isOwner: false }),
    false,
  );
});

test("shouldSendFirstContactGreeting: groups and owner skip", () => {
  const contact = { handle: "+15551234567", messageCount: 0 };
  assert.equal(
    shouldSendFirstContactGreeting({ contact, isGroup: true, isOwner: false }),
    false,
  );
  assert.equal(
    shouldSendFirstContactGreeting({ contact, isGroup: false, isOwner: true }),
    false,
  );
});

// ── First-contact greeting copy ──────────────────────────────────────────

test("buildFirstContactGreeting: asks for first name, warm, consent-aware", () => {
  const reply = buildFirstContactGreeting({ agentName: "Samber" });
  assert.match(reply, /Samber/);
  assert.match(reply, /first name|name/i);
  // Mentions the SAFE pull-cord so they know it from message one.
  assert.match(reply, /SAFE/);
  // Not romantically loaded — no escalating affect.
  const lower = reply.toLowerCase();
  assert.doesNotMatch(lower, /\bbabe\b|\bsexy\b|\bbeautiful\b|\bgorgeous\b/);
  assert.doesNotMatch(lower, /\bdate\b|\bhook ?up\b|\bhang.{0,10}alone\b/);
  // No external URLs
  assert.doesNotMatch(lower, /https?:\/\//);
});

test("buildFirstContactGreeting: works with generic agent name", () => {
  const reply = buildFirstContactGreeting({});
  assert.match(reply, /Amber/);
});

// ── First-name extraction ────────────────────────────────────────────────

test("extractFirstNameFromReply: pulls plausible names", () => {
  assert.equal(extractFirstNameFromReply("I'm Maya"), "Maya");
  assert.equal(extractFirstNameFromReply("im jordan"), "Jordan");
  assert.equal(extractFirstNameFromReply("it's Priya"), "Priya");
  assert.equal(extractFirstNameFromReply("my name is Sam"), "Sam");
  assert.equal(extractFirstNameFromReply("Riya"), "Riya");
  assert.equal(extractFirstNameFromReply("Alex here"), "Alex");
});

test("extractFirstNameFromReply: rejects non-names", () => {
  assert.equal(extractFirstNameFromReply("yes"), null);
  assert.equal(extractFirstNameFromReply("idk"), null);
  assert.equal(extractFirstNameFromReply("Amber"), null);
  assert.equal(extractFirstNameFromReply("SAFE"), null);
  assert.equal(extractFirstNameFromReply(""), null);
  assert.equal(extractFirstNameFromReply(null), null);
  assert.equal(extractFirstNameFromReply("this is a long sentence about who knows what"), null);
});

// ── End-to-end: no drug facilitation in any festival reply ──────────────

test("no festival reply path facilitates drug use", () => {
  const replies = [
    buildSafeKeywordReply(),
    buildSubstanceRedirectReply(),
    buildSubstanceRedirectReply({ urgent: true }),
    buildFirstContactGreeting({ agentName: "Camber" }),
    buildFirstContactGreeting({ agentName: "Samber" }),
  ];
  for (const reply of replies) {
    const lower = reply.toLowerCase();
    assert.doesNotMatch(lower, /\b\d+\s?mg\b/, `mg dose in: ${reply}`);
    assert.doesNotMatch(lower, /\btake (a |some |the )?(tab|pill|cap|hit)\b/);
    assert.doesNotMatch(lower, /\bdealer\b|\bplug\b|\bwhere to (buy|get|cop|find)\b/);
    assert.doesNotMatch(lower, /\bsafe to (take|combine|mix|use)\b/);
    assert.doesNotMatch(lower, /\bgood (dose|combo|stack)\b/);
  }
});
