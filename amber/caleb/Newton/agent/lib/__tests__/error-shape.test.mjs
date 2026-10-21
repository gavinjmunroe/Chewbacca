/**
 * Tests for stable error shape normalization in tiwari-proxy-util.
 *
 * Every error response (status >= 400) must include:
 *   { ok: false, error: string, code: string, correlationId: string }
 *
 * Run with:  node --test Newton/agent/lib/__tests__/error-shape.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeJson } from "../tiwari-proxy-util.js";

/**
 * Build a minimal mock response that captures the written JSON.
 */
function mockRes() {
  const captured = { status: null, headers: null, body: null };
  return {
    captured,
    writeHead(status, headers) {
      captured.status = status;
      captured.headers = headers;
    },
    end(data) {
      captured.body = JSON.parse(data);
    },
  };
}

function mockReq(origin = null) {
  return { headers: origin ? { origin } : {} };
}

test("error shape: includes ok=false, error, code, correlationId", () => {
  const res = mockRes();
  const req = mockReq();
  writeJson(res, 401, { error: "missing_bearer_token" }, { req, correlationId: "cid-1" });

  assert.equal(res.captured.status, 401);
  const body = res.captured.body;
  assert.equal(body.ok, false);
  assert.equal(typeof body.error, "string", "error must be a string");
  assert.equal(typeof body.code, "string", "code must be a string");
  assert.equal(body.correlationId, "cid-1");
  assert.ok(body.code.length > 0, "code must be non-empty");
});

test("error shape: code derived from error when not explicitly set", () => {
  const res = mockRes();
  writeJson(res, 403, { error: "identity_not_minted" }, { correlationId: "cid-2" });
  const body = res.captured.body;
  // Derived code: error uppercased with non-alphanum replaced by _
  assert.equal(body.code, "IDENTITY_NOT_MINTED");
});

test("error shape: explicit code is preserved over derived", () => {
  const res = mockRes();
  writeJson(
    res,
    503,
    { error: "service_unavailable", code: "AMBER_ID_DOWN" },
    { correlationId: "cid-3" },
  );
  const body = res.captured.body;
  assert.equal(body.code, "AMBER_ID_DOWN");
  assert.equal(body.error, "service_unavailable");
});

test("error shape: 200 response passes through without normalization", () => {
  const res = mockRes();
  writeJson(res, 200, { data: "hello", ok: true }, {});
  const body = res.captured.body;
  assert.equal(body.data, "hello");
  assert.equal(body.ok, true);
  assert.equal(body.code, undefined);
});

test("error shape: message field is preserved when present", () => {
  const res = mockRes();
  writeJson(
    res,
    400,
    { error: "bad_json", message: "Unexpected token }" },
    { correlationId: "cid-4" },
  );
  const body = res.captured.body;
  assert.equal(body.message, "Unexpected token }");
  assert.equal(body.error, "bad_json");
  assert.equal(body.code, "BAD_JSON");
});

test("error shape: no raw stack trace in response body", () => {
  const res = mockRes();
  const err = new Error("something broke");
  writeJson(
    res,
    500,
    { error: "proxy_error", code: "PROXY_ERROR", message: err.message },
    { correlationId: "cid-5" },
  );
  const body = res.captured.body;
  // Stack trace must never appear in the serialized response.
  const serialized = JSON.stringify(body);
  assert.ok(!serialized.includes("at Object."), "stack trace must not appear in response");
  assert.equal(body.message, "something broke");
});

test("error shape: missing_bearer_token has MISSING_BEARER_TOKEN code", () => {
  const res = mockRes();
  writeJson(res, 401, { error: "missing_bearer_token" }, { correlationId: "cid-6" });
  const body = res.captured.body;
  assert.equal(body.code, "MISSING_BEARER_TOKEN");
  assert.equal(body.ok, false);
  assert.equal(body.correlationId, "cid-6");
});
