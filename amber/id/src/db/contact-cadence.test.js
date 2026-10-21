/**
 * A CADENCE IS A CLAIM ABOUT A RELATIONSHIP, so the tests that matter are the
 * ones where it REFUSES to make one:
 *
 *   one email after a silent year   -> not "warming". It is one email.
 *   three messages, all inbound     -> not "they reach out". Three is not a pattern.
 *   a contact with no interactions  -> an empty summary, not "you never talk".
 *
 * Everything here is the pure shaping layer. No database.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { shapeCadence, trendOf, reciprocityOf, rhythmLabel } from "./contact-cadence.js";

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-27T12:00:00Z");
const ago = (days) => new Date(NOW - days * DAY).toISOString();

const ch = (over = {}) => ({
  channel: "email",
  first_at: ago(200),
  last_at: ago(2),
  count_30d: 0,
  count_90d: 0,
  count_all: 0,
  accounts: 1,
  ...over,
});

// ── rhythm ──────────────────────────────────────────────────────────────────

test("an interval is named the way a person would say it", () => {
  assert.equal(rhythmLabel(1), "most days");
  assert.equal(rhythmLabel(3), "a few times a week");
  assert.equal(rhythmLabel(7), "about weekly");
  assert.equal(rhythmLabel(14), "every couple of weeks");
  assert.equal(rhythmLabel(30), "about monthly");
  assert.equal(rhythmLabel(90), "every few months");
  assert.equal(rhythmLabel(300), "once or twice a year");
  assert.equal(rhythmLabel(0), null);
  assert.equal(rhythmLabel(NaN), null);
});

// ── trend ───────────────────────────────────────────────────────────────────

test("more lately than before is warming", () => {
  // 8 in the last 30 days, 2 in the 60 before it.
  assert.equal(trendOf({ count30d: 8, count90d: 10 }), "warming");
});

test("ONE message after a long silence is not warming", () => {
  // The rate genuinely is infinitely higher than zero. It is still one message,
  // and calling it a warming relationship is the kind of confident wrongness
  // that makes people stop trusting the card.
  assert.equal(trendOf({ count30d: 1, count90d: 1 }), "steady");
});

test("a relationship that only just started is not warming either", () => {
  // Everything is inside the last 30 days because there was nothing before it.
  assert.equal(trendOf({ count30d: 6, count90d: 6 }), "steady");
});

test("much less lately than before is cooling", () => {
  assert.equal(trendOf({ count30d: 0, count90d: 12 }), "cooling");
});

test("a thin history is never called cooling", () => {
  assert.equal(trendOf({ count30d: 0, count90d: 2 }), "steady");
});

test("counts that disagree say steady rather than guess", () => {
  assert.equal(trendOf({ count30d: 10, count90d: 3 }), "steady");
});

// ── reciprocity ─────────────────────────────────────────────────────────────

test("who starts it is read from the direction split", () => {
  assert.equal(reciprocityOf({ inbound: 2, outbound: 9 }).lean, "you_reach_out");
  assert.equal(reciprocityOf({ inbound: 9, outbound: 2 }).lean, "they_reach_out");
  assert.equal(reciprocityOf({ inbound: 6, outbound: 5 }).lean, "even");
});

test("three messages is not a pattern", () => {
  assert.equal(reciprocityOf({ inbound: 3, outbound: 0 }), null);
  assert.equal(reciprocityOf({}), null);
  assert.equal(reciprocityOf(), null);
});

// ── shaping ─────────────────────────────────────────────────────────────────

test("a weekly emailer reads as weekly, over email", () => {
  const out = shapeCadence({
    now: NOW,
    channelRows: [ch({ count_30d: 4, count_90d: 13, count_all: 40 })],
    totalRow: {
      first_interaction_at: ago(300),
      last_interaction_at: ago(2),
      count_30d: 4,
      count_90d: 13,
      count_all: 40,
    },
    direction: { inbound: 18, outbound: 22 },
  });
  assert.equal(out.rhythm.label, "about weekly");
  assert.equal(out.primaryChannel, "email");
  assert.equal(out.total.daysSinceLast, 2);
  assert.match(out.summary, /In touch about weekly/);
  assert.match(out.summary, /over email/);
  assert.match(out.summary, /goes both ways/);
});

test("channels are ordered by the recent window, not the lifetime one", () => {
  // Years of email, but lately it is all meetings. What the card should lead
  // with is the meetings.
  const out = shapeCadence({
    now: NOW,
    channelRows: [
      ch({ channel: "email", count_30d: 0, count_90d: 1, count_all: 300 }),
      ch({ channel: "calendar", count_30d: 5, count_90d: 12, count_all: 12 }),
    ],
    totalRow: { first_interaction_at: ago(900), last_interaction_at: ago(1), count_30d: 5, count_90d: 13, count_all: 312 },
  });
  assert.equal(out.primaryChannel, "calendar");
  assert.match(out.summary, /mostly over meetings/);
});

test("a relationship spanning two mailboxes says so", () => {
  const out = shapeCadence({
    now: NOW,
    channelRows: [ch({ count_30d: 6, count_90d: 14, count_all: 90, accounts: 2 })],
    totalRow: { first_interaction_at: ago(400), last_interaction_at: ago(1), count_30d: 6, count_90d: 14, count_all: 90 },
  });
  assert.equal(out.accountSpan, 2);
  assert.match(out.summary, /across 2 of your accounts/);
});

test("a sparse history still gets a rhythm, read off the whole span", () => {
  // Four touches in two years -- one every six months. The 90-day window knows
  // nothing about this relationship; the lifetime span puts it at "once or
  // twice a year", which is both true and the thing a person would say.
  const out = shapeCadence({
    now: NOW,
    channelRows: [ch({ count_30d: 0, count_90d: 0, count_all: 4 })],
    totalRow: { first_interaction_at: ago(730), last_interaction_at: ago(120), count_30d: 0, count_90d: 0, count_all: 4 },
  });
  assert.equal(out.rhythm.label, "once or twice a year");
  assert.equal(out.rhythm.everyDays, 182.5);
  assert.equal(out.total.daysSinceLast, 120);
});

test("a contact you have never been in touch with gets an empty summary", () => {
  const out = shapeCadence({ now: NOW, channelRows: [], totalRow: null });
  assert.equal(out.summary, "");
  assert.equal(out.primaryChannel, null);
  assert.equal(out.rhythm.label, null);
  assert.equal(out.total.countAll, 0);
  assert.equal(out.total.daysSinceLast, null);
  assert.equal(out.reciprocity, null);
});

test("a cooling relationship says so, and a warming one says so", () => {
  const cooling = shapeCadence({
    now: NOW,
    channelRows: [ch({ count_30d: 0, count_90d: 14, count_all: 60 })],
    totalRow: { first_interaction_at: ago(500), last_interaction_at: ago(40), count_30d: 0, count_90d: 14, count_all: 60 },
  });
  assert.equal(cooling.rhythm.trend, "cooling");
  assert.match(cooling.summary, /gone quiet lately/);

  const warming = shapeCadence({
    now: NOW,
    channelRows: [ch({ count_30d: 9, count_90d: 11, count_all: 11 })],
    totalRow: { first_interaction_at: ago(80), last_interaction_at: ago(1), count_30d: 9, count_90d: 11, count_all: 11 },
  });
  assert.equal(warming.rhythm.trend, "warming");
  assert.match(warming.summary, /picking up/);
});

test("junk rows do not throw and do not invent numbers", () => {
  const out = shapeCadence({ now: NOW, channelRows: [ch({ count_90d: null, accounts: null })], totalRow: {} });
  assert.equal(out.channels[0].count90d, 0);
  assert.equal(out.channels[0].accounts, 1);
  assert.equal(out.summary, "");
  assert.deepEqual(shapeCadence().channels, []);
});
