/**
 * Smoke tests for `ingestMessageEvent` — the per-direction message ingest
 * helper added for Tab 9 (semantic recall of individual inbound /
 * outbound messages, separate from the combined-exchange chunks
 * `ingestConversation` writes).
 *
 * The helper is fire-and-forget and must never throw on bad input — it
 * just silently no-ops. These tests pin that contract so a future
 * refactor doesn't accidentally start throwing into the hot path.
 *
 * Run with:
 *   node --test Newton/agent/lib/__tests__/ingest-message-event.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { ingestMessageEvent } from "../amber-id-ingest.js";

test("ingestMessageEvent: returns undefined and does not throw on missing text", () => {
  assert.equal(ingestMessageEvent({}), undefined);
  assert.equal(
    ingestMessageEvent({ role: "user", direction: "inbound" }),
    undefined,
  );
});

test("ingestMessageEvent: ignores invalid role / direction silently", () => {
  // Even with text + phone, bad role/direction must not throw.
  assert.doesNotThrow(() =>
    ingestMessageEvent({
      text: "hi",
      role: "robot",
      direction: "inbound",
      phone: "+15551234567",
    }),
  );
  assert.doesNotThrow(() =>
    ingestMessageEvent({
      text: "hi",
      role: "user",
      direction: "sideways",
      phone: "+15551234567",
    }),
  );
});

test("ingestMessageEvent: no-ops without a phone (no tenant fallback)", () => {
  assert.doesNotThrow(() =>
    ingestMessageEvent({
      text: "hi",
      role: "user",
      direction: "inbound",
    }),
  );
});

test("ingestMessageEvent: accepts a valid event without throwing", () => {
  // With AMBER_ID env unset (the test env), ingestToAmberID short-circuits
  // and returns null. The helper attaches a catch() so this stays clean.
  assert.doesNotThrow(() =>
    ingestMessageEvent({
      text: "hello there",
      role: "user",
      direction: "inbound",
      phone: "+15551234567",
      channel: "imessage",
      peerHandle: "+15555550000",
      messageId: "msg_abc",
    }),
  );
  assert.doesNotThrow(() =>
    ingestMessageEvent({
      text: "hey, on it",
      role: "agent",
      direction: "outbound",
      phone: "+15551234567",
      channel: "slack",
      peerHandle: "C0123456",
    }),
  );
});
