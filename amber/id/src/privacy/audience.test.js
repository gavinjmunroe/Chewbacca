/**
 * There were two authorization systems over one dataset. These assert they now
 * speak one vocabulary, and that the new audiences grant exactly what they
 * should and nothing beyond it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { emptyAudience, audienceReaches } from "./audience.js";
import { canView, filterForViewer } from "./field-policy.js";
import { SCOPE_TYPES } from "../db/viewer-reach.js";

const audience = (over = {}) => ({ ...emptyAudience(), ...over });

test("THE TWO SIDES KNOW THE SAME AUDIENCES", () => {
  // viewer-reach.js is SQL inside a feed query; audienceReaches is JS over a
  // loaded object. They exist separately for that reason and for no other, so
  // a scope one can resolve and the other cannot is a bug by construction.
  const everything = audience({
    connected: true,
    contactIds: ["c"],
    circleIds: ["r"],
    cohortIds: ["h"],
    orgId: "o-1",
    groupIds: ["g"],
  });
  for (const scopeType of SCOPE_TYPES) {
    const reached = audienceReaches(everything, {
      scopeType,
      scopeRef: { contact: "c", circle: "r", cohort: "h", group: "g" }[scopeType] ?? null,
    });
    assert.equal(reached, true, `${scopeType} is in SCOPE_TYPES but unreachable in JS`);
  }
  assert.deepEqual([...SCOPE_TYPES], ["network", "circle", "contact", "cohort", "org", "group"]);
});

/**
 * THE CEILING IS NOT ONLY ON THE FEED.
 *
 * This file's header is about two authorization systems that disagreed. A
 * policy enforced in the SQL predicate and not here would be the same bug
 * wearing the same clothes: the note would vanish from the feed and the profile
 * fields it unlocked would stay unlocked.
 */
test("A SHARE MADE IN A COMPANY IS GOVERNED BY THAT COMPANY'S CEILING, here too", () => {
  const member = audience({
    connected: true,
    contactIds: ["c"],
    orgId: "o-1",
    groupIds: ["g"],
    policy: { public: "customer_group", internal: "org", customer_safe: "customer", private: "self" },
  });

  // Internal, addressed to the company: inside the cap.
  assert.equal(audienceReaches(member, { scopeType: "org", orgId: "o-1", classification: "internal" }), true);
  // Internal, addressed outward to one contact: above it, even though this
  // viewer IS that contact. The audience matched; the policy refused.
  assert.equal(
    audienceReaches(member, { scopeType: "contact", scopeRef: "c", orgId: "o-1", classification: "internal" }),
    false,
  );
  // Private stops at the author, whatever the audience says.
  assert.equal(audienceReaches(member, { scopeType: "org", orgId: "o-1", classification: "private" }), false);
});

test("a share made in ANOTHER company reaches nobody here", () => {
  const member = audience({ connected: true, orgId: "o-1", groupIds: ["g"], policy: { internal: "org" } });
  assert.equal(audienceReaches(member, { scopeType: "org", orgId: "o-2", classification: "internal" }), false);
  // Including via an audience that would otherwise match.
  assert.equal(
    audienceReaches(member, { scopeType: "network", orgId: "o-2", classification: "public" }),
    false,
  );
});

test("a consumer share is untouched by any ceiling", () => {
  const consumer = audience({ connected: true, contactIds: ["c"] });
  assert.equal(audienceReaches(consumer, { scopeType: "network" }), true);
  assert.equal(audienceReaches(consumer, { scopeType: "contact", scopeRef: "c" }), true);
});

test("an org share with no policy loaded resolves for nobody", () => {
  // The fail-closed case: a viewer whose audience carries an orgId but no
  // policy -- a failed lookup -- must not be treated as unrestricted.
  const noPolicy = audience({ orgId: "o-1", policy: null });
  assert.equal(audienceReaches(noPolicy, { scopeType: "org", orgId: "o-1", classification: "internal" }), false);
});

test("AN UNKNOWN SCOPE IS NOT A PERMISSIVE ONE", () => {
  const everything = audience({
    connected: true, contactIds: ["c"], circleIds: ["r"], cohortIds: ["h"],
  });
  assert.equal(audienceReaches(everything, { scopeType: "typo" }), false);
  assert.equal(audienceReaches(everything, { scopeType: undefined }), false);
  assert.equal(audienceReaches(everything, {}), false);
});

test("the empty audience grants nothing at all", () => {
  for (const scopeType of SCOPE_TYPES) {
    assert.equal(audienceReaches(emptyAudience(), { scopeType, scopeRef: "x" }), false);
  }
  assert.equal(audienceReaches(null, { scopeType: "network" }), false);
});

test("a scope matches only its own ref", () => {
  const a = audience({ circleIds: ["circle-1"], cohortIds: ["cohort-1"] });
  assert.equal(audienceReaches(a, { scopeType: "circle", scopeRef: "circle-1" }), true);
  assert.equal(audienceReaches(a, { scopeType: "circle", scopeRef: "circle-2" }), false);
  // And a circle id must not unlock a cohort scope.
  assert.equal(audienceReaches(a, { scopeType: "cohort", scopeRef: "circle-1" }), false);
});

// ── what an audience opens, and what it must never open ─────────────────────

test("BEING PUT IN AN AUDIENCE OPENS BASELINE FIELDS", () => {
  // The drift this fixes: a viewer in a circle the owner shares their whole
  // life to was still told nothing about their profile, because field-policy
  // only knew about privacy_tier.
  const inCircle = audience({ circleIds: ["r"] });
  assert.equal(canView({ viewerId: "v", ownerId: "o", field: "company", audience: inCircle }), true);

  const inCohort = audience({ cohortIds: ["h"] });
  assert.equal(canView({ viewerId: "v", ownerId: "o", field: "school", audience: inCohort }), true);
});

test("A DERIVED AUDIENCE NEVER HANDS OUT A PHONE NUMBER", () => {
  // The whole point of a cohort is that nobody reviewed the membership one by
  // one. Contact methods are released by the intro flow and by nothing else.
  const inCohort = audience({ cohortIds: ["h"], circleIds: ["r"], connected: true });
  for (const field of ["phone", "phone_primary", "email", "emails", "phones_all"]) {
    assert.equal(
      canView({ viewerId: "v", ownerId: "o", field, audience: inCohort }),
      false,
      `${field} was released by an audience`,
    );
  }
  for (const field of ["notes", "facts", "birthday", "enrichment", "last_contacted_at"]) {
    assert.equal(canView({ viewerId: "v", ownerId: "o", field, audience: inCohort }), false);
  }
});

test("a stranger in no audience sees nothing", () => {
  const none = emptyAudience();
  for (const field of ["company", "bio", "city", "phone", "notes"]) {
    assert.equal(canView({ viewerId: "v", ownerId: "o", field, audience: none }), false);
  }
});

test("the owner still sees their own everything", () => {
  assert.equal(canView({ viewerId: "me", ownerId: "me", field: "notes" }), true);
  assert.equal(canView({ viewerId: "v", ownerId: "o", field: "notes", audience: audience({ self: true }) }), true);
});

test("the old two-boolean callers still work unchanged", () => {
  // Nothing is forced to migrate in one commit; a caller that has not moved
  // over gets exactly the behavior it had before.
  assert.equal(canView({ viewerId: "v", ownerId: "o", field: "company", connected: true, ownerShares: true }), true);
  assert.equal(canView({ viewerId: "v", ownerId: "o", field: "company", connected: true, ownerShares: false }), false);
  assert.equal(canView({ viewerId: "v", ownerId: "o", field: "phone", connected: true, ownerShares: true }), false);
});

test("filterForViewer passes the audience through", () => {
  const record = { full_name: "Sagar", company: "Amber", phone: "+15551234567", notes: "private" };
  const out = filterForViewer(record, {
    viewerId: "v",
    ownerId: "o",
    audience: audience({ cohortIds: ["h"] }),
  });
  assert.deepEqual(Object.keys(out).sort(), ["company", "full_name"]);
});
