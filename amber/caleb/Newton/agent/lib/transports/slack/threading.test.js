/**
 * Tests for decideSlackThreadTs — the Tab 29 reply-placement policy.
 *
 * Run with:
 *   node --test Newton/agent/lib/transports/slack/threading.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { decideSlackThreadTs, LONG_REPLY_THRESHOLD } from "./threading.js";

test("inbound already in a thread always stays in that thread", () => {
  // Short OR long, channel OR DM — an existing thread is never broken out of.
  assert.equal(
    decideSlackThreadTs({
      inThread: true,
      threadTs: "1700000000.000100",
      messageTs: "1700000000.000200",
      channelType: "channel",
      textLength: 5,
    }),
    "1700000000.000100",
  );
  assert.equal(
    decideSlackThreadTs({
      inThread: true,
      threadTs: "1700000000.000100",
      messageTs: "1700000000.000200",
      channelType: "channel",
      textLength: LONG_REPLY_THRESHOLD + 999,
    }),
    "1700000000.000100",
  );
});

test("DM replies stay flat regardless of length", () => {
  assert.equal(
    decideSlackThreadTs({
      inThread: false,
      threadTs: null,
      messageTs: "1700000000.000200",
      channelType: "im",
      textLength: 10,
    }),
    undefined,
  );
  assert.equal(
    decideSlackThreadTs({
      inThread: false,
      threadTs: null,
      messageTs: "1700000000.000200",
      channelType: "im",
      textLength: LONG_REPLY_THRESHOLD + 500,
    }),
    undefined,
  );
});

test("short top-level channel reply posts inline (no thread)", () => {
  assert.equal(
    decideSlackThreadTs({
      inThread: false,
      threadTs: null,
      messageTs: "1700000000.000200",
      channelType: "channel",
      textLength: 42,
    }),
    undefined,
  );
});

test("long top-level channel reply opens a thread off the inbound ts", () => {
  assert.equal(
    decideSlackThreadTs({
      inThread: false,
      threadTs: null,
      messageTs: "1700000000.000200",
      channelType: "channel",
      textLength: LONG_REPLY_THRESHOLD + 1,
    }),
    "1700000000.000200",
  );
});

test("exactly at the threshold stays inline (strictly greater required)", () => {
  assert.equal(
    decideSlackThreadTs({
      inThread: false,
      threadTs: null,
      messageTs: "1700000000.000200",
      channelType: "channel",
      textLength: LONG_REPLY_THRESHOLD,
    }),
    undefined,
  );
});

test("app_mention with no channel_type is treated as a channel", () => {
  // channelType undefined (app_mention events omit it) → long reply threads.
  assert.equal(
    decideSlackThreadTs({
      inThread: false,
      threadTs: null,
      messageTs: "1700000000.000200",
      channelType: undefined,
      textLength: LONG_REPLY_THRESHOLD + 50,
    }),
    "1700000000.000200",
  );
  // ...and a short one stays inline.
  assert.equal(
    decideSlackThreadTs({
      inThread: false,
      threadTs: null,
      messageTs: "1700000000.000200",
      channelType: undefined,
      textLength: 12,
    }),
    undefined,
  );
});

test("long top-level reply with no messageTs cannot open a thread", () => {
  // Defensive: without an anchor ts there is nothing to thread off, so it
  // degrades to a top-level post rather than threading off nothing.
  assert.equal(
    decideSlackThreadTs({
      inThread: false,
      threadTs: null,
      messageTs: null,
      channelType: "channel",
      textLength: LONG_REPLY_THRESHOLD + 100,
    }),
    undefined,
  );
});

test("in-thread flag without a real threadTs falls through to channel rules", () => {
  // inThread true but threadTs missing should not crash; it behaves like a
  // top-level post (long → thread off messageTs).
  assert.equal(
    decideSlackThreadTs({
      inThread: true,
      threadTs: null,
      messageTs: "1700000000.000200",
      channelType: "channel",
      textLength: LONG_REPLY_THRESHOLD + 10,
    }),
    "1700000000.000200",
  );
});

test("threshold override is honored", () => {
  assert.equal(
    decideSlackThreadTs({
      inThread: false,
      threadTs: null,
      messageTs: "1700000000.000200",
      channelType: "channel",
      textLength: 60,
      threshold: 50,
    }),
    "1700000000.000200",
  );
});

test("missing args do not throw and default to inline", () => {
  assert.equal(decideSlackThreadTs(), undefined);
  assert.equal(decideSlackThreadTs({}), undefined);
});
