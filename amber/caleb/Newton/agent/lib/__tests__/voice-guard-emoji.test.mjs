/**
 * Tests for the emoji-stripping + combined outbound persona guard
 * (Tab 14, item 194). The existing voice-guard.test.mjs covers humanize's
 * botty-phrase and em-dash behavior; this pins the new emoji layer and the
 * guardOutbound composition without disturbing that file.
 *
 * Run with:  node --test Newton/agent/lib/__tests__/voice-guard-emoji.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { stripEmoji, guardOutbound, findBottyPhrases } from "../voice-guard.js";

test("stripEmoji removes inline emoji and collapses the gap", () => {
  assert.equal(stripEmoji("hey 👋 there"), "hey there");
  assert.equal(stripEmoji("done ✅"), "done ");
  assert.equal(stripEmoji("🎉 shipped it"), " shipped it");
});

test("stripEmoji removes composed ZWJ + skin-tone sequences whole", () => {
  assert.equal(stripEmoji("nice work 👍🏽"), "nice work ");
  // The two spaces left where the inline emoji sat collapse to one.
  assert.equal(stripEmoji("ping the 👩‍💻 team"), "ping the team");
});

test("stripEmoji leaves normal text, punctuation, and accents untouched", () => {
  const s = "Café meeting at 3:30, bring the $5 list — done.";
  assert.equal(stripEmoji(s), s);
});

test("stripEmoji does NOT touch the unicode formatting glyphs renderForIMessage emits", () => {
  // Mathematical bold 'H' (U+1D407) — used for rendered *bold*. Must survive.
  const bold = "\u{1D407}ello";
  assert.equal(stripEmoji(bold), bold);
});

test("stripEmoji is a no-op on non-strings", () => {
  assert.equal(stripEmoji(null), null);
  assert.equal(stripEmoji(undefined), undefined);
  assert.equal(stripEmoji(42), 42);
});

test("guardOutbound strips emoji AND em dashes AND botty filler in one pass", () => {
  const out = guardOutbound("Feel free to reach out — happy to help 😊");
  assert.ok(!/[—–]/.test(out), "no em dash");
  assert.ok(!/😊/.test(out), "no emoji");
  assert.ok(!/feel free to/i.test(out), "no botty opener");
  assert.ok(!/happy to help/i.test(out), "no service-desk closer");
});

test("guardOutbound respects the allowEmoji escape hatch", () => {
  const out = guardOutbound("party time 🎉", { allowEmoji: true });
  assert.ok(out.includes("🎉"), "emoji preserved when explicitly allowed");
});

test("guardOutbound is idempotent (double-run yields the same text)", () => {
  const once = guardOutbound("ok cool 🚀 — lets go");
  const twice = guardOutbound(once);
  assert.equal(once, twice);
  // And the single pass already produced clean, in-voice copy.
  assert.equal(once, "ok cool, lets go");
});

test("guardOutbound is a no-op on non-strings", () => {
  assert.equal(guardOutbound(null), null);
  assert.equal(guardOutbound(undefined), undefined);
});

test("findBottyPhrases now also flags emoji and is stateless across calls", () => {
  assert.deepEqual(findBottyPhrases("clean copy"), []);
  assert.ok(findBottyPhrases("nice 🎉").includes("emoji"));
  assert.ok(findBottyPhrases("a — b").includes("em-dash"));
  // Repeated calls must not skip the start of the string (no /g lastIndex bleed).
  assert.ok(findBottyPhrases("x — y").includes("em-dash"));
  assert.ok(findBottyPhrases("x — y").includes("em-dash"));
});
