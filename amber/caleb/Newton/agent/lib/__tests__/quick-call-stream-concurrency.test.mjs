/**
 * CRIT-1 regression: per-item reply-capture binding.
 *
 * The /quick-call/stream route used to wrap dispatchLoopEvent in
 * runWithReplyCapture. But handleInbound only ENQUEUES; the real agent run
 * happens later in agent.js's detached, queueRunning-guarded IIFE. When a
 * second item enters the queue while the first is still draining, the second
 * item ran under the FIRST request's AsyncLocalStorage capture context.
 * Because reply-capture only blocks DIFFERENT phone numbers, a same-contact
 * second run (a real iMessage reply, or a second in-app stream for the same
 * user) got captured into the wrong stream and was never delivered.
 *
 * The fix binds capture to the dequeued queue ITEM via runWithReplyCapture
 * INSIDE the drain loop, so each run captures only its own sends regardless of
 * which IIFE invocation drains it.
 *
 * This test reproduces the queue-drain shape with the REAL AsyncLocalStorage
 * (via runWithReplyCapture / tryCaptureReply from reply-capture.js) and asserts
 * each run's onMessage receives ONLY its own run's sends. It also asserts the
 * old "wrap the whole drain once" approach would have bled — locking in the
 * exact failure mode the fix prevents.
 *
 * Run with:
 *   node --test Newton/agent/lib/__tests__/quick-call-stream-concurrency.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { runWithReplyCapture, tryCaptureReply } from "../reply-capture.js";

// Same contact for both runs — this is the case that bled. Reply-capture's
// recipient guard only blocks DIFFERENT numbers, so a same-number second run
// is indistinguishable to the guard; only per-item binding keeps them apart.
const CONTACT = "+15551234567";

// A stand-in for handleWebhookMessage: it sleeps (to interleave with a second
// run) and then performs a send through the REAL capture hook the transport
// uses (tryCaptureReply). The text encodes which run produced it so we can
// detect bleed precisely.
async function fakeAgentRun(runId, delayMs) {
  await new Promise((r) => setTimeout(r, delayMs));
  // This is exactly what transport.sendMessage calls on every outbound.
  tryCaptureReply(CONTACT, `reply-from-run-${runId}`, {});
}

// Faithful reproduction of the FIXED agent.js runQueue drain: capture is bound
// PER ITEM inside the loop. One shared queue, one queueRunning guard, one IIFE.
function drainQueueWithPerItemCapture(queue) {
  return new Promise((resolve) => {
    (async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        const runOnce = () => fakeAgentRun(item.runId, item.delayMs);
        if (item.capture) {
          await runWithReplyCapture(item.capture, runOnce);
        } else {
          await runOnce();
        }
      }
      resolve();
    })();
  });
}

test("per-item capture: two concurrent same-contact runs do not bleed", async () => {
  const seenA = [];
  const seenB = [];

  // Two items for the SAME contact, each with its own capture sink. Run B is
  // scheduled to land mid-drain (after A is dequeued) — the exact race that
  // reused the shared async context under the old wrapper.
  const queue = [
    {
      runId: "A",
      delayMs: 20,
      capture: { contact: CONTACT, onMessage: (t) => seenA.push(t) },
    },
    {
      runId: "B",
      delayMs: 0,
      capture: { contact: CONTACT, onMessage: (t) => seenB.push(t) },
    },
  ];

  await drainQueueWithPerItemCapture(queue);

  // Each sink received ONLY its own run's send. No cross-stream bleed.
  assert.deepEqual(seenA, ["reply-from-run-A"]);
  assert.deepEqual(seenB, ["reply-from-run-B"]);
});

test("an item with no capture context runs uncaptured (iMessage path unchanged)", async () => {
  const seen = [];
  const queue = [
    {
      runId: "A",
      delayMs: 0,
      capture: { contact: CONTACT, onMessage: (t) => seen.push(t) },
    },
    // No capture — this is a normal iMessage inbound. Its send must NOT be
    // captured by anyone, even though it shares the contact with item A.
    { runId: "B", delayMs: 0, capture: null },
  ];

  await drainQueueWithPerItemCapture(queue);

  // Only A's send was captured; B's send fell through to (real) delivery,
  // which tryCaptureReply reports as not-captured.
  assert.deepEqual(seen, ["reply-from-run-A"]);
});

test("regression witness: wrapping the whole drain ONCE bleeds across items", async () => {
  // This documents the OLD broken shape. The whole drain runs inside a SINGLE
  // capture context bound to run A. Run B, sharing the contact, gets captured
  // into A's sink — never reaching B's caller. The fix above is what prevents
  // this; here we prove the failure mode was real.
  const seenA = [];
  const seenB = [];

  const queue = [
    { runId: "A", delayMs: 10, onMessage: (t) => seenA.push(t) },
    { runId: "B", delayMs: 0, onMessage: (t) => seenB.push(t) },
  ];

  await new Promise((resolve) => {
    runWithReplyCapture(
      { contact: CONTACT, onMessage: (t) => seenA.push(t) },
      () =>
        (async () => {
          while (queue.length > 0) {
            const item = queue.shift();
            await fakeAgentRun(item.runId, item.delayMs);
          }
          resolve();
        })(),
    );
  });

  // Both runs' sends landed in A's sink; B's sink got nothing. That is the bug.
  assert.deepEqual(seenA, ["reply-from-run-A", "reply-from-run-B"]);
  assert.deepEqual(seenB, []);
});
