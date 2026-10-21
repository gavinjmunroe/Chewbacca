/**
 * THE CEILING, AND THE THREE WAYS IT MUST FAIL CLOSED.
 *
 * A policy check that returns true when it does not know the answer is not a
 * policy check. The cohort work already demonstrated the cost of a scope
 * vocabulary that two files disagree about; this is the same risk one layer up,
 * where disagreement means a share that leaves the building.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AUDIENCE_RANK,
  CLASSIFICATIONS,
  DEFAULT_POLICY,
  ORG_SHARE_SCOPES,
  audiencePermitted,
  audienceRank,
  permittedScopes,
  scopePermitted,
} from "./org-scopes.js";

const POLICY = { public: "customer_group", internal: "org", customer_safe: "customer", private: "self" };

test("a scope at or below the cap is permitted, above it is not", () => {
  assert.equal(scopePermitted(POLICY, "internal", "self"), true);
  assert.equal(scopePermitted(POLICY, "internal", "group"), true);
  assert.equal(scopePermitted(POLICY, "internal", "org"), true);
  assert.equal(scopePermitted(POLICY, "internal", "customer"), false);
  assert.equal(scopePermitted(POLICY, "internal", "customer_group"), false);
});

test("LEAVING THE BUILDING RANKS ABOVE STAYING IN IT, whatever the headcount", () => {
  // One customer is fewer people than the whole company and is still wider,
  // because the ceiling measures blast radius. An ordering by headcount would
  // get exactly this backwards and let an org-capped thing go to a customer.
  assert.ok(ORG_SHARE_SCOPES.indexOf("customer") > ORG_SHARE_SCOPES.indexOf("org"));
  assert.equal(scopePermitted({ internal: "org" }, "internal", "customer"), false);
});

test("an unknown scope, an unknown classification, or a missing row all refuse", () => {
  assert.equal(scopePermitted(POLICY, "internal", "everyone"), false);
  assert.equal(scopePermitted(POLICY, "top_secret", "org"), false);
  assert.equal(scopePermitted({}, "internal", "self"), false);
  assert.equal(scopePermitted(null, "internal", "self"), false);
  assert.equal(scopePermitted({ internal: "nonsense" }, "internal", "self"), false);
});

test("the default policy covers every classification, and private means private", () => {
  for (const c of CLASSIFICATIONS) {
    assert.ok(ORG_SHARE_SCOPES.includes(DEFAULT_POLICY[c]), `${c} has no default cap`);
  }
  assert.deepEqual(permittedScopes(DEFAULT_POLICY, "private"), ["self"]);
  assert.deepEqual(permittedScopes(DEFAULT_POLICY, "internal"), ["self", "group", "org"]);
});

test("permittedScopes is what the picker renders, and it is never wider than the cap", () => {
  const allowed = permittedScopes(POLICY, "customer_safe");
  assert.deepEqual(allowed, ["self", "group", "org", "customer"]);
  for (const s of allowed) assert.equal(scopePermitted(POLICY, "customer_safe", s), true);
});

/**
 * THE CEILING HAS FOUR DOORS CUT IN IT IF THE WIDER TABLE IS WRONG.
 *
 * An admin capping `private` at `self` means it. A member who could still send
 * a private note to one contact, or to a circle, or to their whole network, has
 * a policy that governs two of six audiences -- which is worse than no policy,
 * because the screen says otherwise.
 */
test("the ceiling governs the consumer audiences too, not only the org ladder", () => {
  const policy = { ...DEFAULT_POLICY }; // private: self, internal: org
  for (const scope of ["group", "org", "contact", "circle", "cohort", "network"]) {
    assert.equal(audiencePermitted(policy, "private", scope), false, `private escaped via ${scope}`);
  }
  // Internal stops at the company edge: inside is fine, every outward audience is not.
  assert.equal(audiencePermitted(policy, "internal", "org"), true);
  assert.equal(audiencePermitted(policy, "internal", "group"), true);
  for (const scope of ["contact", "circle", "cohort", "network"]) {
    assert.equal(audiencePermitted(policy, "internal", scope), false, `internal escaped via ${scope}`);
  }
});

test("an unknown audience is permitted by no ceiling", () => {
  assert.equal(audienceRank("something_new"), 99);
  assert.equal(audiencePermitted({ public: "customer_group" }, "public", "something_new"), false);
});

/**
 * THE SAME TABLE EXISTS IN SQL, and two copies of a rule drift. This parses
 * org_scope_rank() out of the migration and compares it value by value, so the
 * day somebody adds an audience to one and not the other, this fails -- rather
 * than the predicate and the write path quietly disagreeing about whether a
 * share was allowed.
 */
test("org_scope_rank() in migration 063 agrees with AUDIENCE_RANK, exactly", () => {
  const sql = readFileSync(
    new URL("../../db/migrations/20261014_063_org_share_scopes.sql", import.meta.url),
    "utf8",
  );
  const body = /CREATE OR REPLACE FUNCTION org_scope_rank[\s\S]*?END\s*;/.exec(sql);
  assert.ok(body, "org_scope_rank is not in the migration any more");

  const fromSql = {};
  for (const m of body[0].matchAll(/WHEN\s+'(\w+)'\s+THEN\s+(\d+)/g)) {
    fromSql[m[1]] = Number(m[2]);
  }
  assert.deepEqual(fromSql, { ...AUDIENCE_RANK }, "the SQL ranks and the JS ranks disagree");

  // And the fall-through has to be the never-permitted one, or an audience the
  // SQL has not been taught would rank 0 and pass every ceiling.
  assert.match(body[0], /ELSE\s+99/);
});
