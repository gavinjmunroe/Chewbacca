/**
 * The memory union: which surfaces it searches, what it refuses to do, and that
 * no user text is ever interpolated into the statement.
 *
 * Run with:  node --test src/db/memory-search.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { buildMemorySearchSql } from "./memory-search.js";

const OWNER = "11111111-2222-3333-4444-555555555555";

test("it searches every surface information can land on", () => {
  const { sql } = buildMemorySearchSql({ ownerId: OWNER, q: "chinese food" });
  // The Chinese-food case failed because the answer was in a note and the
  // question only looked at facts. Facts, notes, experiences and self-knowledge
  // are all `observations` now, separated by kind and by whether anyone is
  // attached -- so the assertion is on the KINDS the union covers, which is what
  // the test was always really about, rather than on four table names.
  for (const table of [
    "'fact'",
    "'note'",
    "'experience'",
    "'self'",
    "conversation_messages",
  ]) {
    assert.ok(sql.includes(table), `missing surface: ${table}`);
  }
  // Every branch is owner-scoped and skips soft-deleted rows.
  assert.equal((sql.match(/owner_id = \$1/g) || []).length, 5);
  // FIVE, not four. user_facts had no deleted_at at all, so a deleted self-fact
  // kept coming back in search; as an observation it is soft-deletable like
  // everything else and the branch filters it.
  assert.equal((sql.match(/deleted_at IS NULL/g) || []).length, 5);
});

test("what the user SAID is searched, and only their own turns", () => {
  const { sql } = buildMemorySearchSql({ ownerId: OWNER, q: "boss" });
  // Amber's own replies are not memories of the user's life; matching them would
  // let the assistant's guesses come back as though the user had said them.
  assert.ok(sql.includes("m.role = 'user'"));
});

test("every hit carries where it came from and who it involves", () => {
  const { sql } = buildMemorySearchSql({ ownerId: OWNER, q: "x" });
  assert.ok(sql.includes("AS kind"));
  assert.ok(sql.includes("contact_ids"));
  assert.ok(sql.includes("conversation_id"));
  // Newest first: a preference stated last month should outrank one from a year ago.
  assert.ok(sql.includes("ORDER BY at DESC NULLS LAST"));
  // Real total, separate from the page — same rule as contact search.
  assert.ok(sql.includes("count(*) OVER () AS total"));
});

test("an empty term is refused rather than matching everything ever written", () => {
  assert.equal(buildMemorySearchSql({ ownerId: OWNER, q: "" }), null);
  assert.equal(buildMemorySearchSql({ ownerId: OWNER, q: "   " }), null);
  assert.equal(buildMemorySearchSql({ ownerId: OWNER }), null);
  assert.equal(buildMemorySearchSql({ q: "x" }), null);
});

test("nothing the user typed reaches the SQL text", () => {
  const nasty = "'; DROP TABLE observations; --";
  const { sql, params } = buildMemorySearchSql({ ownerId: OWNER, q: nasty });
  assert.ok(!sql.includes("DROP"));
  assert.ok(!sql.includes(nasty));
  assert.deepEqual(params.slice(0, 2), [OWNER, `%${nasty}%`]);
});

test("`only` narrows the union, which is how a missing table degrades", () => {
  const built = buildMemorySearchSql({ ownerId: OWNER, q: "x", only: ["fact", "note"] });
  assert.deepEqual(built.kinds, ["fact", "note"]);
  assert.ok(built.sql.includes("'fact'"));
  assert.ok(built.sql.includes("'note'"));
  assert.ok(!built.sql.includes("'experience'"));
  assert.ok(!built.sql.includes("conversation_messages"));
  // Narrowed to nothing is null, not a query that returns the whole table.
  assert.equal(buildMemorySearchSql({ ownerId: OWNER, q: "x", only: ["nope"] }), null);
});

test("the limit is clamped and always bound as a parameter", () => {
  const big = buildMemorySearchSql({ ownerId: OWNER, q: "x", limit: 99999 });
  assert.ok(big.params.includes(300));
  const dflt = buildMemorySearchSql({ ownerId: OWNER, q: "x" });
  assert.ok(dflt.params.includes(60));
  const neg = buildMemorySearchSql({ ownerId: OWNER, q: "x", limit: -3 });
  assert.ok(neg.params.includes(60));
  assert.ok(/LIMIT \$\d+/.test(dflt.sql));
});
