/**
 * NO QUERY READS OBSERVATIONS WITHOUT NAMING AN OWNER.
 *
 * A fact belongs to exactly one tenant. Amber's whole promise is that one
 * person's input never reaches another person's agent, and in Cloud SQL that
 * promise is one thing: every statement that touches `observations` also
 * constrains `owner_id`.
 *
 * That is enforced today by everyone remembering to type it. This test makes it
 * structural: it reads every SQL template literal in src/, finds the ones that
 * select from or join `observations`, and fails if the same statement never
 * mentions an owner. A cross-tenant leak would have to get past a red build
 * rather than past a reviewer at midnight.
 *
 * WHAT COUNTS AS NAMING AN OWNER: `owner_id` anywhere in the statement. That is
 * deliberately loose -- this is a tripwire for a MISSING filter, not a proof
 * that the filter is correct. A statement that mentions owner_id can still be
 * wrong; a statement that never mentions it is wrong for certain.
 *
 * WHY STATIC AND NOT A RUNTIME CHECK: a runtime assertion only fires on the code
 * paths a test happens to exercise. The leak we care about is the query nobody
 * called yet.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Statements that touch observations and legitimately have no single owner.
 * Every entry needs a reason, because an allowlist without reasons becomes the
 * place leaks are hidden.
 */
const ALLOWED = [
  // Fleet-wide analytics: counts and percentages across all tenants, never row
  // content, and the k-anonymity floor in analytics.js suppresses small cohorts.
  "db/analytics.js",
  // The classification worker's queue: picks up pending rows for every owner by
  // design, then classifies each in isolation. It reads body text, not
  // cross-tenant joins.
  "db/dimension-queue.js",
  // Maintenance and backfill passes that walk the whole table on purpose.
  "db/contact-rollup.js",
  // The embedding worker's queue: same shape as the classification queue. It
  // selects rows with no vector across all owners and embeds each one on its
  // own; it never joins one owner's rows to another's.
  "db/embedding-queue.js",
];

/**
 * A statement pinned to observation_id touches exactly one row the caller
 * already resolved, so it cannot return somebody else's life -- there is no set
 * to leak. Those are accepted without an owner filter; anything that can match
 * more than one row is not.
 */
const PINNED_TO_ONE_ROW = /\bobservation_id\s*=\s*\$\d/i;

function jsFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { jsFiles(full, out); continue; }
    if (e.name.endsWith(".js") && !e.name.includes(".test.")) out.push(full);
  }
  return out;
}

/** Every backtick template literal that looks like SQL. */
function sqlLiterals(source) {
  const out = [];
  const re = /`([^`\\]*(?:\\.[^`\\]*)*)`/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const body = m[1];
    if (/\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(body)) out.push(body);
  }
  return out;
}

const TOUCHES_OBSERVATIONS = /\b(FROM|JOIN|INTO|UPDATE)\s+observations\b/i;

test("every SQL statement touching observations names an owner", () => {
  const offenders = [];

  for (const file of jsFiles(SRC)) {
    const rel = path.relative(SRC, file);
    if (ALLOWED.some((a) => rel === a)) continue;

    for (const sql of sqlLiterals(fs.readFileSync(file, "utf8"))) {
      if (!TOUCHES_OBSERVATIONS.test(sql)) continue;
      if (/owner_id/i.test(sql)) continue;
      if (PINNED_TO_ONE_ROW.test(sql)) continue;
      offenders.push(`${rel}: ${sql.replace(/\s+/g, " ").trim().slice(0, 120)}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `\n\nThese statements read or write observations without constraining owner_id.\n` +
      `A fact belongs to one tenant; a query without an owner can return another\n` +
      `person's life. Add the filter, or add the file to ALLOWED with a reason.\n\n` +
      offenders.map((o) => `  ${o}`).join("\n") +
      "\n",
  );
});
