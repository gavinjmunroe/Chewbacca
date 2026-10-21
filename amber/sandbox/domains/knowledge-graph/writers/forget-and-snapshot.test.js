/**
 * Unit tests for the pure helpers behind forget-on-demand + snapshots.
 *
 * Covers filter construction and the ISO-string date comparisons that gate
 * which chunks a forget/snapshot touches. The Pinecone-facing orchestration
 * (forgetMemory / snapshotMemory) is exercised by integration smoke against
 * a live namespace, not here.
 *
 * Run with:  node --test src/knowledge/forget-and-snapshot.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildMemoryFilter,
  timestampOf,
  isBefore,
  isAtOrBefore,
} from "./forget-and-snapshot.js";

test("buildMemoryFilter returns empty object with no selectors", () => {
  assert.deepEqual(buildMemoryFilter({}), {});
  assert.deepEqual(buildMemoryFilter(), {});
});

test("buildMemoryFilter maps scalar selectors to exact matches", () => {
  assert.deepEqual(
    buildMemoryFilter({
      dimension: "social",
      kind: "conversation",
      source_id_match: "msg_123",
    }),
    {
      health_dimension: "social",
      kind: "conversation",
      source: "msg_123",
    },
  );
});

test("buildMemoryFilter maps arrays to $in clauses", () => {
  assert.deepEqual(
    buildMemoryFilter({
      dimension: ["social", "emotional"],
      kind: ["conversation"],
    }),
    {
      health_dimension: { $in: ["social", "emotional"] },
      kind: { $in: ["conversation"] },
    },
  );
});

test("timestampOf prefers created_at, falls back to ingested_at", () => {
  assert.equal(
    timestampOf({ metadata: { created_at: "2026-04-01T00:00:00.000Z" } }),
    "2026-04-01T00:00:00.000Z",
  );
  assert.equal(
    timestampOf({ metadata: { ingested_at: "2026-05-01T00:00:00.000Z" } }),
    "2026-05-01T00:00:00.000Z",
  );
  assert.equal(timestampOf({ metadata: {} }), null);
  assert.equal(timestampOf(null), null);
});

test("isBefore uses lexical ISO comparison and is exclusive", () => {
  const apr = { metadata: { created_at: "2026-04-01T12:00:00.000Z" } };
  assert.equal(isBefore(apr, "2026-05-01T00:00:00.000Z"), true);
  assert.equal(isBefore(apr, "2026-03-01T00:00:00.000Z"), false);
  // exact match is NOT before
  assert.equal(isBefore(apr, "2026-04-01T12:00:00.000Z"), false);
  // no cutoff -> everything passes
  assert.equal(isBefore(apr, null), true);
  // missing timestamp -> excluded when a cutoff is set
  assert.equal(isBefore({ metadata: {} }, "2026-05-01T00:00:00.000Z"), false);
});

test("isAtOrBefore is inclusive of the cutoff instant", () => {
  const cutoff = "2026-04-01T12:00:00.000Z";
  assert.equal(
    isAtOrBefore({ metadata: { created_at: cutoff } }, cutoff),
    true,
  );
  assert.equal(
    isAtOrBefore(
      { metadata: { created_at: "2026-04-01T11:59:59.000Z" } },
      cutoff,
    ),
    true,
  );
  assert.equal(
    isAtOrBefore(
      { metadata: { created_at: "2026-04-01T12:00:01.000Z" } },
      cutoff,
    ),
    false,
  );
  assert.equal(isAtOrBefore({ metadata: {} }, cutoff), false);
});
