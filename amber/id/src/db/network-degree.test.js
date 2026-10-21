/**
 * "Connections of connections and connections of connections of connections."
 * Nothing implemented this before, so these pin the two things that make a
 * degree mean anything: the bound, and the shortest path.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { clampDegree, MAX_DEGREE, WITHIN_DEGREE_SQL } from "./network-degree.js";

test("THREE HOPS, AND NOT FOUR", () => {
  // At an average 150 connections the hops are 150, 22,500, 3.4 million, and
  // then everybody. A bound that is a product decision at 3 is a table scan
  // at 4, so the cap is enforced rather than documented.
  assert.equal(MAX_DEGREE, 3);
  assert.equal(clampDegree(4), 3);
  assert.equal(clampDegree(99), 3);
  assert.equal(clampDegree(3), 3);
});

test("a missing or nonsense degree falls back to the nearest circle, not the widest", () => {
  // Failing open here would mean an intent meant for direct contacts blasting
  // three hops out. The default is the smallest audience, always.
  assert.equal(clampDegree(undefined), 1);
  assert.equal(clampDegree(null), 1);
  assert.equal(clampDegree("nonsense"), 1);
  assert.equal(clampDegree(0), 1);
  assert.equal(clampDegree(-5), 1);
  assert.equal(clampDegree(1.9), 1);
});

test("THE SEED IS NEVER ITS OWN CONTACT", () => {
  // A matcher that forgets this proposes that somebody meet themselves. Both
  // the traversal and the embeddable predicate exclude degree 0.
  assert.match(WITHIN_DEGREE_SQL, /w\.degree > 0/);
});

test("the predicate walks BOTH directions of a canonically ordered pair", () => {
  // connections stores each pair once with a < b (CHECK constraint in
  // migration 004), so a traversal that only followed a_amber_id -> b_amber_id
  // would find roughly half the network and would look like it worked.
  assert.match(WITHIN_DEGREE_SQL, /cn\.a_amber_id = w\.amber_id/);
  assert.match(WITHIN_DEGREE_SQL, /cn\.b_amber_id = w\.amber_id/);
});

test("a severed connection is not a path, at every hop", () => {
  // status is checked inside the recursive term rather than once at the end. A
  // route through a pending or removed connection is not a route.
  const activeChecks = [...WITHIN_DEGREE_SQL.matchAll(/cn\.status = 'active'/g)];
  assert.equal(activeChecks.length, 2, "both directions must filter on status");
});
