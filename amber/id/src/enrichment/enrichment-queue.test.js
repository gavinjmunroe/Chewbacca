/**
 * Unit tests for the concurrency-limited retrying enrichment queue
 * (src/enrichment/enrichment-queue.js, items 172, 177).
 *
 * No network, no real timers (sleep is injected). Run with:
 *   node --test src/enrichment/enrichment-queue.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { createEnrichmentQueue } from "./enrichment-queue.js";

// A no-op sleep so retries don't add wall-clock time.
const instantSleep = async () => {};

test("never exceeds the concurrency limit", async () => {
  let active = 0;
  let peak = 0;
  const q = createEnrichmentQueue({ concurrency: 2, sleep: instantSleep });
  const task = () =>
    new Promise((resolve) => {
      active++;
      peak = Math.max(peak, active);
      setTimeout(() => {
        active--;
        resolve("done");
      }, 5);
    });
  await Promise.all(Array.from({ length: 6 }, () => q.add(task)));
  assert.ok(peak <= 2, `peak concurrency was ${peak}`);
});

test("retries a transient failure up to maxRetries then succeeds", async () => {
  let attempts = 0;
  const q = createEnrichmentQueue({ maxRetries: 3, sleep: instantSleep });
  const value = await q.add(async () => {
    attempts++;
    if (attempts < 3) throw new Error("transient");
    return "ok";
  });
  assert.equal(value, "ok");
  assert.equal(attempts, 3);
});

test("gives up after maxRetries and rejects with the last error", async () => {
  let attempts = 0;
  const q = createEnrichmentQueue({ maxRetries: 1, sleep: instantSleep });
  await assert.rejects(
    q.add(async () => {
      attempts++;
      throw new Error("always");
    }),
    /always/,
  );
  assert.equal(attempts, 2); // initial + 1 retry
});

test("shouldRetry=false skips retries for non-transient errors", async () => {
  let attempts = 0;
  const q = createEnrichmentQueue({
    maxRetries: 5,
    sleep: instantSleep,
    shouldRetry: (err) => err.message !== "fatal",
  });
  await assert.rejects(
    q.add(async () => {
      attempts++;
      throw new Error("fatal");
    }),
    /fatal/,
  );
  assert.equal(attempts, 1); // never retried
});

test("addAll returns settled results and never throws on a failing task", async () => {
  const q = createEnrichmentQueue({
    concurrency: 3,
    maxRetries: 0,
    sleep: instantSleep,
  });
  const results = await q.addAll([
    async () => "a",
    async () => {
      throw new Error("boom");
    },
    async () => "c",
  ]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[0].value, "a");
  assert.equal(results[1].status, "rejected");
  assert.equal(results[2].value, "c");
});

test("onIdle resolves once the queue drains", async () => {
  const q = createEnrichmentQueue({ concurrency: 1, sleep: instantSleep });
  q.add(() => new Promise((r) => setTimeout(r, 5)));
  q.add(() => new Promise((r) => setTimeout(r, 5)));
  assert.ok(q.size + q.pending > 0);
  await q.onIdle();
  assert.equal(q.size, 0);
  assert.equal(q.pending, 0);
});

test("add rejects a non-function task", async () => {
  const q = createEnrichmentQueue({ sleep: instantSleep });
  await assert.rejects(q.add("not a function"), /must be a function/);
});
