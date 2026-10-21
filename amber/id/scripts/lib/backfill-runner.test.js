import { test } from "node:test";
import assert from "node:assert/strict";

import {
  chunkArray,
  parseFlags,
  emptyTotals,
  mergeTotals,
  runBackfill,
} from "./backfill-runner.js";

test("chunkArray splits into batches of the given size", () => {
  assert.deepEqual(chunkArray([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunkArray([], 2), []);
  assert.deepEqual(chunkArray([1], 100), [[1]]);
});

test("parseFlags reads --dry-run", () => {
  assert.deepEqual(parseFlags([]), { dryRun: false });
  assert.deepEqual(parseFlags(["--dry-run"]), { dryRun: true });
});

test("mergeTotals accumulates every field", () => {
  const into = emptyTotals();
  mergeTotals(into, { scanned: 2, indexed: 1, skipped: 0, failed: 1 });
  mergeTotals(into, { scanned: 3, indexed: 3, skipped: 0, failed: 0 });
  assert.deepEqual(into, { scanned: 5, indexed: 4, skipped: 0, failed: 1 });
});

test("runBackfill returns zeros for an empty list", async () => {
  const res = await runBackfill({
    items: [],
    indexOne: async () => ({ indexed: true }),
  });
  assert.deepEqual(res, { scanned: 0, indexed: 0, skipped: 0, failed: 0 });
});

test("runBackfill tallies indexed vs failed and calls indexOne per item", async () => {
  const seen = [];
  const indexOne = async (item) => {
    seen.push(item);
    return { indexed: item % 2 === 0 }; // even succeeds, odd fails
  };
  const res = await runBackfill({
    items: [1, 2, 3, 4],
    indexOne,
    delayMs: 0,
    concurrency: 2,
  });
  assert.equal(res.scanned, 4);
  assert.equal(res.indexed, 2);
  assert.equal(res.failed, 2);
  assert.equal(res.skipped, 0);
  assert.deepEqual(seen.sort(), [1, 2, 3, 4]);
});

test("runBackfill counts a thrown indexOne as failed, not a crash", async () => {
  const res = await runBackfill({
    items: [1, 2],
    indexOne: async () => {
      throw new Error("boom");
    },
    delayMs: 0,
  });
  assert.equal(res.failed, 2);
  assert.equal(res.indexed, 0);
});

test("runBackfill dry-run skips all items without calling indexOne", async () => {
  let called = 0;
  const res = await runBackfill({
    items: [1, 2, 3],
    indexOne: async () => {
      called += 1;
      return { indexed: true };
    },
    dryRun: true,
  });
  assert.equal(called, 0);
  assert.equal(res.scanned, 3);
  assert.equal(res.skipped, 3);
  assert.equal(res.indexed, 0);
});

test("runBackfill respects concurrency batching", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const indexOne = async () => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    return { indexed: true };
  };
  await runBackfill({
    items: [1, 2, 3, 4, 5, 6],
    indexOne,
    concurrency: 2,
    delayMs: 0,
  });
  assert.ok(maxInFlight <= 2, `maxInFlight was ${maxInFlight}, expected <= 2`);
});
