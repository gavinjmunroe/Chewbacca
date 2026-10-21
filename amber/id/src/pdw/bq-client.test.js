/**
 * A rollup over 962 contacts printed 962 identical "Not found: Table" lines
 * and spent minutes on a thousand doomed BigQuery round trips. From outside
 * that is indistinguishable from a hang.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { isStructuralBqError } from "./bq-client.js";

test("A MISSING TABLE IS STRUCTURAL", () => {
  // The exact string BigQuery returned.
  assert.equal(
    isStructuralBqError(
      "Not found: Table midyear-glazing-485303-u3:medha_pdw.contact_cadence was not found in location US",
    ),
    true,
  );
  assert.equal(isStructuralBqError("Dataset medha_pdw does not exist"), true);
  assert.equal(isStructuralBqError("Permission denied on table"), true);
  assert.equal(isStructuralBqError("403 Access Denied"), true);
});

test("A BLIP IS NOT, and must not disable a mirror for the life of a server", () => {
  // These resolve on their own. Turning a throttled write into an outage for
  // the rest of the process is a worse failure than the one being fixed.
  assert.equal(isStructuralBqError("Exceeded rate limits: too many requests"), false);
  assert.equal(isStructuralBqError("Deadline exceeded"), false);
  assert.equal(isStructuralBqError("socket hang up"), false);
  assert.equal(isStructuralBqError("ETIMEDOUT"), false);
  assert.equal(isStructuralBqError("503 Service Unavailable"), false);
  assert.equal(isStructuralBqError(""), false);
  assert.equal(isStructuralBqError(null), false);
  assert.equal(isStructuralBqError(undefined), false);
});
