/**
 * Unit tests for the pure filters / formatters in scrape-messages.js.
 *
 * The HTTP / Slack-API integration paths live in a future integration
 * suite that needs a stubbed Slack server; this file just locks in the
 * decisions about WHICH messages get indexed and HOW they're rendered.
 *
 * Run with:  node --test src/oauth/slack/scrape-messages.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { __test__ } from "./scrape-messages.js";

const { shouldIndexMessage, textForMessage, channelLabel, isoFromSlackTs } =
  __test__;

test("shouldIndexMessage: indexes a plain user message", () => {
  assert.equal(
    shouldIndexMessage({
      type: "message",
      user: "U123",
      ts: "1700000000.000100",
      text: "hello team",
    }),
    true,
  );
});

test("shouldIndexMessage: skips bot_message subtype", () => {
  assert.equal(
    shouldIndexMessage({
      type: "message",
      subtype: "bot_message",
      bot_id: "B123",
      ts: "1700000000.000100",
      text: "deploy succeeded",
    }),
    false,
  );
});

test("shouldIndexMessage: skips messages from a bot_id even without subtype", () => {
  // Newer apps post with `bot_id` set but `subtype` undefined; the older
  // subtype check alone would let these through.
  assert.equal(
    shouldIndexMessage({
      type: "message",
      bot_id: "B999",
      ts: "1700000000.000100",
      text: "PR opened",
    }),
    false,
  );
});

test("shouldIndexMessage: skips channel_join / channel_topic / pinned_item", () => {
  for (const subtype of [
    "channel_join",
    "channel_leave",
    "channel_topic",
    "channel_purpose",
    "channel_name",
    "group_join",
    "pinned_item",
    "unpinned_item",
  ]) {
    assert.equal(
      shouldIndexMessage({
        type: "message",
        subtype,
        user: "U123",
        ts: "1700000000.000100",
        text: "<@U123> has joined #design",
      }),
      false,
      `expected subtype ${subtype} to be skipped`,
    );
  }
});

test("shouldIndexMessage: skips messages with empty / whitespace text", () => {
  for (const text of [undefined, null, "", "   ", "\n\t"]) {
    assert.equal(
      shouldIndexMessage({
        type: "message",
        user: "U123",
        ts: "1700000000.000100",
        text,
      }),
      false,
      `expected empty text "${JSON.stringify(text)}" to be skipped`,
    );
  }
});

test("textForMessage: includes channel + author + iso timestamp + body", () => {
  const out = textForMessage({
    channelDisplay: "#design",
    authorName: "caleb",
    authorId: "U123",
    isoTs: "2026-05-28T10:30:00.000Z",
    text: "ship the new card grid",
  });
  assert.match(out, /\[Slack #design\]/);
  assert.match(out, /@caleb/);
  assert.match(out, /2026-05-28T10:30:00\.000Z/);
  assert.match(out, /ship the new card grid/);
});

test("textForMessage: falls back to <@uid> when display name missing", () => {
  const out = textForMessage({
    channelDisplay: "#design",
    authorName: null,
    authorId: "U999",
    isoTs: "2026-05-28T10:30:00.000Z",
    text: "hi",
  });
  assert.match(out, /<@U999>/);
  assert.ok(!out.includes("@null"));
});

test("channelLabel: prefers #name, then DM/Group DM, then id", () => {
  assert.equal(channelLabel({ id: "C1", name: "design" }), "#design");
  assert.equal(channelLabel({ id: "D1", is_im: true }), "DM");
  assert.equal(channelLabel({ id: "G1", is_mpim: true }), "Group DM");
  assert.equal(channelLabel({ id: "C9" }), "C9");
  assert.equal(channelLabel(null), "(unknown)");
});

test("isoFromSlackTs: parses Slack's float-seconds timestamp", () => {
  assert.equal(
    isoFromSlackTs("1700000000.000100"),
    new Date(1700000000 * 1000).toISOString(),
  );
});

test("isoFromSlackTs: null/empty/zero ts returns null", () => {
  assert.equal(isoFromSlackTs(null), null);
  assert.equal(isoFromSlackTs(""), null);
  assert.equal(isoFromSlackTs("0"), null);
  assert.equal(isoFromSlackTs("garbage"), null);
});
