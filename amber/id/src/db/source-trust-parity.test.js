/**
 * THE MIGRATION AND THE REGISTRY MUST AGREE.
 *
 * Tier classification exists twice, and it has to: src/lib/source-trust.js decides
 * what may overwrite what at write time, and the CASE expression in
 * db/migrations/20260924_055_merge_undo_and_trust.sql backfilled the tier onto
 * every row that already existed. A migration cannot import JavaScript, so the
 * mapping is repeated there by hand.
 *
 * Two copies of a rule drift. When they do the damage is quiet and specific:
 * historic rows carry one tier, new rows carry another, and the same contact
 * behaves differently depending on when it was written. Nothing throws, nothing
 * logs, and the symptom is a person's correction surviving on some cards and not
 * others.
 *
 * So this test reads the migration, extracts the labels it lists under each tier,
 * and asserts the registry classifies every one of them identically. Editing
 * either side alone fails here.
 *
 * Run with:  node --test src/db/source-trust-parity.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { trustOf, TRUST } from "../lib/source-trust.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIGRATION = path.join(
  ROOT,
  "db",
  "migrations",
  "20260924_055_merge_undo_and_trust.sql",
);

/**
 * Pull `WHEN lower(source) IN ('a','b') ... THEN <n>` out of the backfill.
 * Returns [{ labels, tier }] in file order.
 */
function tiersFromMigration(sql) {
  const backfill = sql.slice(sql.indexOf("UPDATE contacts SET source_tier"));
  const out = [];
  const re = /WHEN\s+lower\(source\)\s+IN\s*\(([^)]*)\)([\s\S]*?)THEN\s+(\d)/g;
  for (const m of backfill.matchAll(re)) {
    const labels = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    out.push({ labels, tier: Number(m[3]) });
  }
  return out;
}

test("the migration file is where the test thinks it is", () => {
  assert.ok(
    fs.existsSync(MIGRATION),
    `missing ${path.relative(ROOT, MIGRATION)} -- if it was renamed, update this test rather than deleting it`,
  );
});

test("every label the migration classifies gets the same tier from the registry", () => {
  const sql = fs.readFileSync(MIGRATION, "utf8");
  const groups = tiersFromMigration(sql);

  assert.ok(groups.length >= 3, "expected at least three tier groups in the backfill");

  const mismatches = [];
  let checked = 0;
  for (const { labels, tier } of groups) {
    for (const label of labels) {
      checked += 1;
      const fromJs = trustOf(label);
      if (fromJs !== tier) {
        mismatches.push(`${label}: migration says ${tier}, source-trust.js says ${fromJs}`);
      }
    }
  }

  assert.deepEqual(
    mismatches,
    [],
    `the backfill and the registry disagree:\n  ${mismatches.join("\n  ")}`,
  );
  assert.ok(checked >= 20, `only ${checked} labels checked -- the parser probably broke`);
});

test("the migration's fallback and the registry's fallback are both the bottom tier", () => {
  // `ELSE 0` in the backfill, UNKNOWN_TRUST in the registry. If either side ever
  // makes an unclassified source anything but the least trusted, a label nobody
  // has reviewed gains the power to overwrite a person's own corrections.
  const sql = fs.readFileSync(MIGRATION, "utf8");
  const backfill = sql.slice(sql.indexOf("UPDATE contacts SET source_tier"));
  assert.match(backfill, /ELSE\s+0\b/, "the backfill's ELSE branch must be tier 0");
  assert.equal(trustOf("a_label_nobody_has_classified"), TRUST.VENDOR);
});
