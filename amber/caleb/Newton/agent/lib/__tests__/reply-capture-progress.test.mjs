/**
 * Tests for the tool-progress plumbing on the reply-capture context
 * (Tab 14, item 191). Proves emitProgress reaches the active context's
 * onProgress across awaits, and is a safe no-op everywhere else — the exact
 * contract the /quick-call/stream handler and the tool dispatcher rely on.
 *
 * Run with:  node --test Newton/agent/lib/__tests__/reply-capture-progress.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  runWithReplyCapture,
  emitProgress,
  tryCaptureReply,
} from "../reply-capture.js";

test("emitProgress reaches onProgress inside an active capture context", () => {
  const seen = [];
  runWithReplyCapture(
    {
      contact: "+15551234567",
      onMessage: () => {},
      onProgress: (phase, label) => seen.push([phase, label]),
    },
    () => {
      emitProgress("tool", "Checking your calendar");
      emitProgress("tool", "Searching the web");
    },
  );
  assert.deepEqual(seen, [
    ["tool", "Checking your calendar"],
    ["tool", "Searching the web"],
  ]);
});

test("emitProgress propagates across awaits (async tool dispatch)", async () => {
  const seen = [];
  await runWithReplyCapture(
    {
      contact: "+15551234567",
      onMessage: () => {},
      onProgress: (_p, label) => seen.push(label),
    },
    async () => {
      await Promise.resolve();
      emitProgress("tool", "Reading your email");
    },
  );
  assert.deepEqual(seen, ["Reading your email"]);
});

test("emitProgress is a no-op with no active capture context", () => {
  // Must not throw when called outside any run (every normal iMessage turn).
  assert.doesNotThrow(() => emitProgress("tool", "Working on it"));
});

test("emitProgress is a no-op when the context registered no onProgress", () => {
  assert.doesNotThrow(() =>
    runWithReplyCapture({ contact: "+15550000000", onMessage: () => {} }, () =>
      emitProgress("tool", "Working on it"),
    ),
  );
});

test("a throwing onProgress never breaks the agent run", () => {
  assert.doesNotThrow(() =>
    runWithReplyCapture(
      {
        contact: "+15550000000",
        onMessage: () => {},
        onProgress: () => {
          throw new Error("sink blew up");
        },
      },
      () => emitProgress("tool", "Working on it"),
    ),
  );
});

test("progress plumbing coexists with reply capture in the same context", () => {
  const progress = [];
  const messages = [];
  runWithReplyCapture(
    {
      contact: "+15551112222",
      onMessage: (text) => messages.push(text),
      onProgress: (_p, label) => progress.push(label),
    },
    () => {
      emitProgress("tool", "Checking your calendar");
      tryCaptureReply("+15551112222", "here is your schedule");
    },
  );
  assert.deepEqual(progress, ["Checking your calendar"]);
  assert.deepEqual(messages, ["here is your schedule"]);
});
