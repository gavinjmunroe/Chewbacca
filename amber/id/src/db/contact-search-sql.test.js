/**
 * The SQL contact search builds: what it searches, what it refuses to search,
 * and that nothing the user typed is ever interpolated into the statement.
 *
 * Run with:  node --test src/db/contact-search-sql.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { _buildSearchSql } from "./store.js";

const OWNER = "11111111-2222-3333-4444-555555555555";
const build = (filters, wide = true) => _buildSearchSql({ filters: { ownerId: OWNER, ...filters }, wide });

test("with nothing to filter on it refuses rather than dumping the address book", () => {
  assert.equal(build({}), null);
  assert.equal(build({ q: "   " }), null);
  assert.equal(build({ name: "" }), null);
  assert.equal(_buildSearchSql({ filters: {}, wide: true }), null);
});

test("a free-text term searches notes, tags, facts and occupation — not just the name", () => {
  // "All my USC connections" missed everyone whose USC is in a note or a tag.
  const { sql } = build({ q: "usc" });
  for (const surface of [
    "c.full_name ILIKE",
    "c.company ILIKE",
    "c.title ILIKE",
    "c.city ILIKE",
    "c.location ILIKE",
    "c.apple_notes ILIKE",
    "unnest(COALESCE(c.tags",
    // ONE SURFACE WHERE THERE WERE TWO. contact_notes matched on participant_ids
    // and contact_facts on contact_id; both are observations now, and the
    // subject of an observation is also a participant row, so one join through
    // observation_participants covers a fact about this person AND a note that
    // merely mentions them.
    "FROM observations o",
    "observation_participants op",
  ]) {
    assert.ok(sql.includes(surface), `missing: ${surface}`);
  }
  // Child rows are owner-scoped too, never joined across accounts.
  assert.ok(sql.includes("o.owner_id = c.owner_id"));
  assert.ok(sql.includes("o.deleted_at IS NULL"));
});

test("the count is computed BEFORE the limit, in the same query", () => {
  // This is the fix for reporting 25 as the total when there were more.
  const { sql } = build({ q: "usc", limit: 3 });
  assert.ok(sql.includes("count(*) OVER () AS total"));
  assert.ok(/LIMIT \$\d+ OFFSET \$\d+/.test(sql));
});

test("the narrow fallback drops the surfaces that need the extra tables", () => {
  const { sql } = build({ q: "usc" }, false);
  assert.ok(sql.includes("c.full_name ILIKE"));
  assert.ok(!sql.includes("contact_notes"));
  assert.ok(!sql.includes("contact_facts"));
  assert.ok(!sql.includes("unnest("));
});

test("nothing the user typed reaches the SQL text", () => {
  const nasty = "'; DROP TABLE contacts; --";
  const { sql, params } = build({ q: nasty, name: nasty, company: nasty, limit: 10 });
  assert.ok(!sql.includes("DROP"));
  assert.ok(!sql.includes(nasty));
  // Every user value is a bound parameter, wrapped for a substring match.
  assert.ok(params.includes(`%${nasty}%`));
  assert.equal(params[0], OWNER);
});

test("limit is clamped and offset is honored", () => {
  const { params } = build({ q: "x", limit: 99999, offset: 40 });
  assert.ok(params.includes(500), "limit should clamp to 500");
  assert.ok(params.includes(40));
  // A missing/absurd limit falls back to a sane page, not to unbounded.
  const d = build({ q: "x" });
  assert.ok(d.params.includes(50));
  const neg = build({ q: "x", limit: -5, offset: -5 });
  assert.ok(neg.params.includes(50));
  assert.ok(neg.params.includes(0));
});

test("relevance puts a name/company hit above a hit buried in a note", () => {
  const { sql } = build({ q: "usc" });
  assert.ok(sql.includes("AS rel"));
  assert.ok(sql.includes("ORDER BY rel DESC, c.full_name ASC"));
  // A name or role hit scores 3, a note hit 2 — both count, the stronger sorts first.
  assert.ok(/full_name ILIKE \$\d+ THEN 3/.test(sql));
  assert.ok(/apple_notes ILIKE \$\d+ THEN 2/.test(sql));
});

test("attribute-only search still works with no free-text term", () => {
  const { sql, params } = build({ company: "Zocdoc", city: "New York" });
  assert.ok(sql.includes("c.company ILIKE"));
  assert.ok(sql.includes("c.city ILIKE"));
  assert.ok(!sql.includes("contact_notes"));
  assert.ok(sql.includes("0 AS rel"));
  assert.ok(params.includes("%Zocdoc%"));
});
