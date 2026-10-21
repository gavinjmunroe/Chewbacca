/**
 * THE ONE PREDICATE, PINNED STRUCTURALLY.
 *
 * There is no Postgres in this suite, so these are assertions about the SQL
 * text rather than about rows it returns. That sounds weak and is not: every
 * failure this file guards against is a MISSING CLAUSE, and a missing clause is
 * exactly what you can see in the text.
 *
 * The history is the argument. shares-store once kept its own copy of this
 * predicate, testing columns that had not existed since migration 004, so its
 * network leg matched nothing at all while another copy's worked. Nobody
 * noticed, because the failure of an authorization rule is silent in both
 * directions: too strict looks like "nothing shared with me", too loose looks
 * like nothing.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { AUDIENCE_SQL, CEILING_SQL, SCOPE_TYPES, VIEWER_REACH_SQL } from "./viewer-reach.js";

/**
 * The predicate without its commentary. Every assertion below is about SQL that
 * executes, and a rule satisfied only by a line explaining the rule is not a
 * rule -- that is how a test starts passing because somebody wrote a comment.
 */
const CODE = AUDIENCE_SQL.split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

test("EVERY SCOPE THE STORE WILL ACCEPT HAS A LEG THAT CAN RESOLVE IT", () => {
  // A scope accepted on write with no leg here is a share the owner believes
  // they made and that reaches nobody, forever, with no error anywhere.
  for (const scope of SCOPE_TYPES) {
    assert.ok(
      CODE.includes(`s.scope_type = '${scope}'`),
      `no viewer-reach leg for the '${scope}' scope`,
    );
  }
});

test("the exported predicate is the audience AND the ceiling, never one alone", () => {
  assert.ok(VIEWER_REACH_SQL.includes(AUDIENCE_SQL));
  assert.ok(VIEWER_REACH_SQL.includes(CEILING_SQL));
  assert.match(VIEWER_REACH_SQL, /\)\s*AND\s*\(/);
});

test("A COMPANY'S SHARES ARE KEYED ON THE SHARE'S COMPANY, not the author's current one", () => {
  // s.org_id, not a lookup of the owner's membership. An author who leaves does
  // not take what they shared with them, and cannot carry it into the next one.
  assert.ok(CODE.includes("m.org_id = s.org_id"));
  assert.ok(CODE.includes("gm.org_id = s.org_id"));
  assert.equal(/m\.org_id\s*=\s*\(\s*SELECT/.test(CODE), false);
});

test("a suspended member resolves nothing, on both org legs", () => {
  // Two occurrences in executable SQL: the org leg, and the group leg's join
  // through org_members. The composite foreign key on org_group_members proves
  // somebody IS a member; only this proves the membership is still live.
  assert.equal((CODE.match(/m\.status = 'active'/g) ?? []).length, 2);
});

test("the group leg requires the viewer to be that viewer, in that group, in that company", () => {
  const leg = CODE.split("s.scope_type = 'group'")[1] ?? "";
  assert.ok(leg.includes("gm.group_id = s.scope_ref"));
  assert.ok(leg.includes("gm.amber_id = $1"));
});

test("A PERSONAL SHARE IS UNTOUCHED BY THE CEILING, which is what keeps the consumer product working", () => {
  assert.ok(CEILING_SQL.includes("s.org_id IS NULL"));
});

test("THE CEILING FAILS CLOSED when a company has no policy row for a classification", () => {
  // COALESCE(..., 'self') is the whole guarantee: no row means the narrowest
  // possible cap, so nothing resolves. The alternative -- no row meaning no cap
  // -- is the one failure mode nobody would ever notice.
  assert.match(CEILING_SQL, /COALESCE\([\s\S]*'self'\)/);
  assert.ok(CEILING_SQL.includes("org_scope_rank(s.scope_type)"));
  assert.ok(CEILING_SQL.includes("p.classification = s.classification"));
});

test("the predicate takes exactly one bound parameter, and it is the viewer", () => {
  // A second parameter is how the old version took a client-supplied phone
  // number and handed any member's audience to anybody who knew it.
  const params = new Set(VIEWER_REACH_SQL.match(/\$\d+/g) ?? []);
  assert.deepEqual([...params], ["$1"]);
});
