/**
 * WHAT A BROWSER TOKEN MAY REACH ONCE COMPANIES EXIST, and the token an
 * email-only account has to be able to hold at all.
 *
 * Two changes meet here, and both are the kind that fail quietly:
 *
 *   - signSessionToken used to REQUIRE a phone. An org member invited by work
 *     email has none, so that throw was the difference between the enterprise
 *     fork working and every email account being unable to hold a session.
 *     What must not change is the other direction: a token with a phone still
 *     carries the claim, because every existing resolver reads it first.
 *
 *   - The scope list is no longer one frozen array for everybody. The risk of
 *     computing it is handing somebody MORE than before, so that is what is
 *     pinned: the original two scopes are present in every case, and org:admin
 *     appears only for an active admin.
 */

import test from "node:test";
import assert from "node:assert/strict";

process.env.AMBER_JWT_SECRET ||= "test-only-jwt-secret-at-least-32-characters-long";

const { signSessionToken, verifySessionToken } = await import("./amber-jwt.js");
const { scopeAllows, webSessionScopeFor, WEB_SESSION_SCOPE } = await import("./token-scope.js");

const AMBER = "11111111-2222-3333-4444-555555555555";

test("A SESSION WITHOUT A PHONE IS VALID, and one with a phone still carries it", async () => {
  const { token } = signSessionToken({ did: `did:amber:${AMBER}` });
  const claims = verifySessionToken(token);
  assert.equal(claims.did, `did:amber:${AMBER}`);
  assert.equal(claims.phone, null);

  const withPhone = verifySessionToken(signSessionToken({ did: "did:amber:x", phone: "+13105550100" }).token);
  assert.equal(withPhone.phone, "+13105550100");
});

test("a token still needs a subject", () => {
  assert.throws(() => signSessionToken({ phone: "+13105550100" }), /requires did/);
});

test("every web session keeps the two scopes it already had", () => {
  for (const membership of [null, { role: "member", status: "active" }, { role: "admin", status: "active" }]) {
    const scope = webSessionScopeFor(membership);
    for (const s of WEB_SESSION_SCOPE) assert.ok(scope.includes(s));
  }
});

/**
 * THE SCOPE LIST IS THE SAME FOR EVERY BROWSER SESSION, and this test is the
 * record of why it stopped depending on the person holding it.
 *
 * It used to be computed from membership: org:create only for somebody not in a
 * company, org:admin only for an active admin. A scope is baked into a token at
 * mint time and the facts behind it are not, so what that produced was this:
 * sign in, create your company -- which makes you an admin one millisecond
 * after your token said you were not -- and every admin call for the next eight
 * hours is refused with "this session can only read your network and your
 * contacts". It happened in production the day it shipped.
 *
 * The role is checked by requireOrgAdmin, against the database, on every single
 * request. That is the check that can be honest about who somebody is right
 * now. Scope keeps the job it is good at: bounding which routes a stolen
 * browser token can reach at all.
 */
test("every browser session carries the same scopes, whatever the membership", () => {
  const none = [...webSessionScopeFor(null)];
  const member = [...webSessionScopeFor({ role: "member", status: "active" })];
  const admin = [...webSessionScopeFor({ role: "admin", status: "active" })];
  assert.deepEqual(member, none);
  assert.deepEqual(admin, none);
  assert.ok(none.includes("org:admin"));
  assert.ok(none.includes("org:create"));
});

test("THE LIST STILL WITHHOLDS WHAT A STOLEN BROWSER TOKEN MUST NOT REACH", () => {
  // Static does not mean unrestricted. Default-deny is the whole design, and
  // these are the routes a web session has never been able to call.
  const scope = [...webSessionScopeFor(null)];
  for (const [method, route] of [
    ["DELETE", "/v1/me/contacts/:contactId"],
    ["POST", "/v1/me/contacts/merge"],
    ["POST", "/v1/me/contacts/:contactId/enrich"],
    ["GET", "/v1/me/dms"],
    ["GET", "/v1/me/secrets"],
  ]) {
    assert.equal(scopeAllows(scope, method, route), false, `${method} ${route} was reachable`);
  }
});

test("the scopes still gate by route, and the org console is reachable", () => {
  const scope = [...webSessionScopeFor(null)];
  assert.equal(scopeAllows(scope, "GET", "/v1/org/me"), true);
  assert.equal(scopeAllows(scope, "POST", "/v1/org/invites"), true);
  assert.equal(scopeAllows(scope, "POST", "/v1/org/groups"), true);
  assert.equal(scopeAllows(scope, "PUT", "/v1/org/policy"), true);
  // A route nobody added to the list is refused, which is the failure mode
  // this design chooses: a 403 somebody notices in four seconds.
  assert.equal(scopeAllows(scope, "POST", "/v1/org/invented"), false);
});

test("an unrestricted token -- what iOS holds -- is untouched by any of this", () => {
  assert.equal(scopeAllows(null, "POST", "/v1/org/invites"), true);
});
