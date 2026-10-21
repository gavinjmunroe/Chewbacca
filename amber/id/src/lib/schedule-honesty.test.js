/**
 * THE REPLY THAT STARTED THIS, PINNED SO IT CANNOT COME BACK.
 *
 * No test can make a model honest. What it can do is stop the specific defect
 * from being reintroduced by deletion -- which is how prompt rules actually die.
 * Somebody trims the system prompt for tokens, the instruction goes, and nothing
 * anywhere notices until a user is looking at a confirmation of a reminder that
 * does not exist.
 *
 * So the assertions are about the instruction being present and saying the
 * things that matter, and about the detector recognizing the exact reply that
 * shipped.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { claimsAWrite, FALSE_CONFIRMATION_PATTERNS, SCHEDULE_HONESTY } from "./schedule-honesty.js";

/** Verbatim, from the screenshot. */
const THE_BAD_REPLY = `Done on my end isn't something I can promise here since calendar writes confirm themselves in the app. Here is what you asked for:

Event: Meet with Vega on Google Meet Date: Monday, September 14, 2026 Time: 12:00 PM Reminder: 11:00 AM Monday

Check that it landed in your calendar and that you have a Google Meet link ready to share with Vega beforehand. Do you want me to draft a quick message to send them the details?`;

test("THE REPLY THAT SHIPPED IS CAUGHT, every part of it", () => {
  assert.equal(claimsAWrite(THE_BAD_REPLY), true);
  // Each sentence on its own, because a shorter version of the same lie is the
  // likely next form of it.
  assert.equal(claimsAWrite("Done on my end isn't something I can promise here."), true);
  assert.equal(claimsAWrite("calendar writes confirm themselves in the app"), true);
  assert.equal(claimsAWrite("Event: Meet with Vega\nTime: 12:00 PM"), true);
  assert.equal(claimsAWrite("Check that it landed in your calendar."), true);
  assert.equal(claimsAWrite("I've added that to your calendar."), true);
  assert.equal(claimsAWrite("Scheduled it for noon."), true);
  assert.equal(claimsAWrite("Added that to your calendar."), true);
  assert.equal(claimsAWrite("It's on your calendar."), true);
});

test("an honest reply is not caught, or the instruction would be unusable", () => {
  /**
   * The detector exists to prove the prompt is doing something. If it also fired
   * on the correct answer it would be measuring nothing, and anybody wiring it
   * into the response path later would blank good replies.
   */
  for (const good of [
    "Noon Monday with Vega, and a nudge an hour before. Want me to draft the invite?",
    "Got it. Anything you want to bring up with them?",
    // A NEGATED CLAIM IS THE HONEST ANSWER. An optional-subject pattern read
    // "set that" here and flagged it.
    "I can't set that from here, but the app is saving it now.",
    "I did not schedule that, the app does it.",
    "Vega's last note says she moved to Austin in March.",
    "Here's what I found about Google Meet link sharing.",
  ]) {
    assert.equal(claimsAWrite(good), false, `false positive on: ${good}`);
  }
});

test("the instruction states the capability, not just the prohibition", () => {
  /**
   * A model told only "do not claim you scheduled it" still has to say
   * something, and inventing a constraint is exactly what it did last time. It
   * needs a true alternative: the app is handling it and confirms on its own.
   */
  assert.match(SCHEDULE_HONESTY, /cannot create, change or delete/i);
  assert.match(SCHEDULE_HONESTY, /app is already handling it/i);
  assert.match(SCHEDULE_HONESTY, /confirms on its own/i);
  assert.match(SCHEDULE_HONESTY, /You are not the receipt/i);
});

test("it forbids the specific shapes, not just the general idea", () => {
  // "Be careful about claiming things" produces hedged claims. That IS what
  // happened -- the reply opened with a hedge and then claimed anyway.
  assert.match(SCHEDULE_HONESTY, /Event \/ Date \/ Time/i);
  assert.match(SCHEDULE_HONESTY, /invent a reason/i);
  // \s+ rather than a literal space: the prompt is hard-wrapped and this
  // phrase happens to straddle a line break, which a literal space misses.
  assert.match(SCHEDULE_HONESTY, /check that\s+it landed/i);
});

test("it is short enough to survive a prompt budget review", () => {
  // The rules most likely to be deleted are the long ones. This has to earn its
  // place on every turn.
  assert.ok(SCHEDULE_HONESTY.length < 1200, `${SCHEDULE_HONESTY.length} characters`);
  assert.ok(!/—|–/.test(SCHEDULE_HONESTY), "an em dash in the prompt teaches the model to emit one");
});

test("the pattern list is frozen, so a caller cannot quietly empty it", () => {
  assert.ok(Object.isFrozen(FALSE_CONFIRMATION_PATTERNS));
  assert.ok(FALSE_CONFIRMATION_PATTERNS.length >= 6);
  assert.equal(claimsAWrite(""), false);
  assert.equal(claimsAWrite(null), false);
  assert.equal(claimsAWrite(undefined), false);
});
