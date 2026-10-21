/**
 * HMAC contract tests. signRequest is the exact function both the KG
 * service (verify path) and amber-id's kg-client (produce path) call.
 * A mismatch here breaks every cross-service request.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { signRequest } from "./auth.js";

const SECRET = "test-shared-secret";
const TIMESTAMP = "1725100000";

test("signRequest is deterministic for the same inputs", () => {
  const a = signRequest({
    secret: SECRET,
    timestamp: TIMESTAMP,
    method: "POST",
    path: "/upsert",
    body: '{"did":"did:privy:x"}',
  });
  const b = signRequest({
    secret: SECRET,
    timestamp: TIMESTAMP,
    method: "POST",
    path: "/upsert",
    body: '{"did":"did:privy:x"}',
  });
  assert.equal(a, b);
});

test("signRequest matches the canonical formula", () => {
  const method = "POST";
  const path = "/query";
  const body = '{"did":"did:privy:x","queryText":"hi"}';
  const payload = `${TIMESTAMP}\n${method}\n${path}\n${body}`;
  const mac = crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
  assert.equal(
    signRequest({ secret: SECRET, timestamp: TIMESTAMP, method, path, body }),
    `sha256=${mac}`,
  );
});

test("signRequest uppercases the method so GET and get produce the same signature", () => {
  const a = signRequest({
    secret: SECRET,
    timestamp: TIMESTAMP,
    method: "get",
    path: "/healthz",
    body: "",
  });
  const b = signRequest({
    secret: SECRET,
    timestamp: TIMESTAMP,
    method: "GET",
    path: "/healthz",
    body: "",
  });
  assert.equal(a, b);
});

test("signRequest differs when any input field differs", () => {
  const base = {
    secret: SECRET,
    timestamp: TIMESTAMP,
    method: "POST",
    path: "/upsert",
    body: '{"a":1}',
  };
  const s0 = signRequest(base);
  assert.notEqual(s0, signRequest({ ...base, secret: "other" }));
  assert.notEqual(s0, signRequest({ ...base, timestamp: "1725100001" }));
  assert.notEqual(s0, signRequest({ ...base, method: "PUT" }));
  assert.notEqual(s0, signRequest({ ...base, path: "/upsert/x" }));
  assert.notEqual(s0, signRequest({ ...base, body: '{"a":2}' }));
});

test("signRequest handles an empty body as an empty string", () => {
  const s = signRequest({
    secret: SECRET,
    timestamp: TIMESTAMP,
    method: "POST",
    path: "/forget",
    body: "",
  });
  const s2 = signRequest({
    secret: SECRET,
    timestamp: TIMESTAMP,
    method: "POST",
    path: "/forget",
    body: undefined,
  });
  assert.equal(s, s2);
});
