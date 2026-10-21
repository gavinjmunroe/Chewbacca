import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runWithReplyCapture,
  tryCaptureReply,
  isCapturing,
} from "../reply-capture.js";

test("no capture context: tryCaptureReply is a no-op", () => {
  assert.equal(isCapturing(), false);
  assert.equal(tryCaptureReply("+15551234567", "hi", {}), false);
});

test("captures DM replies to the bound caller and diverts them", () => {
  const seen = [];
  const result = runWithReplyCapture(
    { contact: "+15551234567", onMessage: (t) => seen.push(t) },
    () => {
      assert.equal(isCapturing(), true);
      const captured = tryCaptureReply(
        "+15551234567",
        "your calendar is clear",
        {},
      );
      assert.equal(captured, true);
      return "ran";
    },
  );
  assert.equal(result, "ran");
  assert.deepEqual(seen, ["your calendar is clear"]);
});

test("does not capture sends to a different contact", () => {
  runWithReplyCapture(
    {
      contact: "+15551234567",
      onMessage: () => assert.fail("should not fire"),
    },
    () => {
      assert.equal(
        tryCaptureReply("+19998887777", "for someone else", {}),
        false,
      );
    },
  );
});

test("never captures group sends", () => {
  runWithReplyCapture(
    {
      contact: "+15551234567",
      onMessage: () => assert.fail("should not fire"),
    },
    () => {
      assert.equal(
        tryCaptureReply(null, "group blast", { group: "grp_1" }),
        false,
      );
    },
  );
});

test("a throwing sink still reports captured (reply is not delivered over Loop)", () => {
  runWithReplyCapture(
    {
      contact: "+15551234567",
      onMessage: () => {
        throw new Error("sink boom");
      },
    },
    () => {
      assert.equal(tryCaptureReply("+15551234567", "hello", {}), true);
    },
  );
});

test("capture context propagates across async timers (burst-flush parity)", async () => {
  const seen = [];
  await runWithReplyCapture(
    { contact: "+15551234567", onMessage: (t) => seen.push(t) },
    () =>
      new Promise((resolve) => {
        setTimeout(() => {
          // Sends flushed on a timer created inside the run scope must still
          // capture, the way the agent's burst-flush setTimeout does.
          tryCaptureReply("+15551234567", "delayed reply", {});
          resolve();
        }, 5);
      }),
  );
  assert.deepEqual(seen, ["delayed reply"]);
});
