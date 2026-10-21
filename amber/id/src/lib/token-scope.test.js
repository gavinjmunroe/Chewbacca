/**
 * THE TOKEN THAT LIVES IN A BROWSER.
 *
 * A web session signs in exactly the way the app does, and the credential then
 * sits in browser storage, which is the most stealable place a token can live.
 * These are the properties that have to hold before that is acceptable:
 *
 *   1. a scoped token reaches the graph and the cards, and NOTHING else
 *   2. an unscoped token -- every token iOS holds -- is completely unaffected
 *   3. a route nobody thought about is DENIED to a scoped token, not allowed
 *
 * Point 3 is the one that decides whether this survives contact with a growing
 * codebase. An allowlist fails safe when somebody forgets; a denylist does not.
 *
 * Run with:  node --test src/lib/token-scope.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { scopeAllows, knownScopes, WEB_SESSION_SCOPE } from "./token-scope.js";

const WEB = [...WEB_SESSION_SCOPE];

test("a web token can read the network graph and the contact cards", () => {
  assert.equal(scopeAllows(WEB, "GET", "/v1/me/network/edges"), true);
  assert.equal(scopeAllows(WEB, "GET", "/v1/me/contacts"), true);
  assert.equal(scopeAllows(WEB, "GET", "/v1/me/contacts/:contactId"), true);
  assert.equal(scopeAllows(WEB, "GET", "/v1/me/contacts/:contactId/profile"), true);
  assert.equal(scopeAllows(WEB, "GET", "/v1/me/contacts/search"), true);
  assert.equal(scopeAllows(WEB, "GET", "/v1/me/contacts/:contactId/provenance"), true);
});

test("THE CARD'S CONTENT IS REACHABLE, and that was a decision", () => {
  // These two were denied until the web contact card needed them. They are
  // the things somebody actually wrote about a person, so widening to them is
  // a real widening and is asserted here rather than left to the source list:
  // if either ever needs taking back, this test is where the argument is.
  assert.equal(scopeAllows(WEB, "GET", "/v1/me/contacts/:contactId/facts"), true);
  assert.equal(scopeAllows(WEB, "GET", "/v1/me/contacts/:id/experiences"), true);
  // And still read-only. Reading a fact is not resolving, editing or deleting
  // one; all of that stays on the phone.
  assert.equal(scopeAllows(WEB, "POST", "/v1/me/contacts/:contactId/facts"), false);
  assert.equal(scopeAllows(WEB, "PATCH", "/v1/me/contacts/:contactId/facts"), false);
  assert.equal(scopeAllows(WEB, "DELETE", "/v1/me/contacts/:id/experiences"), false);
});

test("A WEB TOKEN CANNOT READ ANYTHING ELSE", () => {
  for (const route of [
    "GET /v1/me/inbox",
    "GET /v1/me/reminders",
    "GET /v1/auth/sessions",
    "GET /v1/me/voice-bio",
    "GET /v1/me/contacts/duplicates",
  ]) {
    const [method, path] = route.split(" ");
    assert.equal(scopeAllows(WEB, method, path), false, `${route} was reachable`);
  }
});

test("A WEB TOKEN CANNOT WRITE, even to the things it can read", () => {
  assert.equal(scopeAllows(WEB, "POST", "/v1/me/contacts"), false);
  assert.equal(scopeAllows(WEB, "PATCH", "/v1/me/contacts/:contactId"), false);
  assert.equal(scopeAllows(WEB, "DELETE", "/v1/me/contacts/:contactId"), false);
  assert.equal(scopeAllows(WEB, "POST", "/v1/me/contacts/merge"), false);
});

test("A ROUTE NOBODY ADDED TO THE LIST IS DENIED, not allowed", () => {
  // The whole reason this is an allowlist. A route invented tomorrow is
  // unreachable by a browser token until somebody decides otherwise.
  assert.equal(scopeAllows(WEB, "GET", "/v1/me/something-invented-tomorrow"), false);
});

test("AN UNSCOPED TOKEN IS UNAFFECTED -- this is what iOS holds", () => {
  for (const scope of [null, undefined]) {
    assert.equal(scopeAllows(scope, "GET", "/v1/me/inbox"), true);
    assert.equal(scopeAllows(scope, "POST", "/v1/me/contacts"), true);
    assert.equal(scopeAllows(scope, "DELETE", "/v1/auth/sessions/:id"), true);
  }
});

test("a session can always end itself, whatever its scope", () => {
  assert.equal(scopeAllows(WEB, "POST", "/v1/auth/invalidate"), true);
  assert.equal(scopeAllows(WEB, "POST", "/v1/auth/refresh"), true);
});

test("A REQUEST WITH NO MATCHED ROUTE IS DENIED", () => {
  // An authorization check that cannot tell which route it is looking at must
  // not answer yes. This is what makes a future Fastify change fail closed.
  assert.equal(scopeAllows(WEB, "GET", null), false);
  assert.equal(scopeAllows(WEB, "GET", undefined), false);
  assert.equal(scopeAllows(WEB, "GET", ""), false);
});

test("an unknown scope grants nothing rather than everything", () => {
  assert.equal(scopeAllows(["admin:everything"], "GET", "/v1/me/contacts"), false);
  assert.equal(scopeAllows([], "GET", "/v1/me/contacts"), false);
});

test("the method is part of the decision, not decoration", () => {
  assert.equal(scopeAllows(WEB, "GET", "/v1/me/network/edges"), true);
  assert.equal(scopeAllows(WEB, "POST", "/v1/me/network/edges"), false);
});

test("every scope the web session asks for is one this service knows", () => {
  const known = knownScopes();
  for (const s of WEB_SESSION_SCOPE) {
    assert.ok(known.includes(s), `${s} is requested but grants nothing`);
  }
});
