/**
 * Tests for the proxy response helper.
 *
 * Run with:  node --test Newton/agent/lib/__tests__/tiwari-proxy-util.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { writeJson, correlationIdOf } from "../tiwari-proxy-util.js";

function fakeRes() {
  let status = 0;
  let headers = null;
  let chunk = null;
  return {
    writeHead(s, h) { status = s; headers = h; },
    end(b) { chunk = b; },
    get statusCode() { return status; },
    get headers() { return headers; },
    get body() { return chunk; },
  };
}

test("correlationIdOf: prefers x-correlation-id", () => {
  const id = correlationIdOf({ headers: { "x-correlation-id": "trace-1" } });
  assert.equal(id, "trace-1");
});

test("correlationIdOf: falls back to x-request-id", () => {
  const id = correlationIdOf({ headers: { "x-request-id": "req-7" } });
  assert.equal(id, "req-7");
});

test("correlationIdOf: synthesizes a fresh UUID when absent", () => {
  const id = correlationIdOf({ headers: {} });
  assert.match(id, /^[0-9a-f-]{36}$/);
});

test("writeJson: 2xx responses are written verbatim", () => {
  const res = fakeRes();
  writeJson(res, 200, { ok: true, hello: "world" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["Content-Type"], "application/json");
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.deepEqual(JSON.parse(res.body), { ok: true, hello: "world" });
});

test("writeJson: 4xx/5xx are normalized to envelope shape with correlationId", () => {
  const res = fakeRes();
  writeJson(res, 401, { error: "missing_bearer_token" }, { correlationId: "cid-1" });
  assert.equal(res.statusCode, 401);
  assert.equal(res.headers["x-correlation-id"], "cid-1");
  const body = JSON.parse(res.body);
  assert.equal(body.ok, false);
  assert.equal(body.error, "missing_bearer_token");
  assert.equal(body.correlationId, "cid-1");
});

test("writeJson: defaults error to 'internal_error' if missing", () => {
  const res = fakeRes();
  writeJson(res, 500, {}, { correlationId: "cid-2" });
  const body = JSON.parse(res.body);
  assert.equal(body.error, "internal_error");
});

test("writeJson: never echoes Access-Control-Allow-Origin: * by default in prod", () => {
  // Without an explicit allowlist match, no CORS header is emitted at
  // all (the previous helper hard-coded "*"). The test just enforces
  // that `*` no longer appears unconditionally.
  const before = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const res = fakeRes();
    writeJson(res, 200, { ok: true }, { req: { headers: { origin: "https://attacker.example" } } });
    assert.notEqual(res.headers["Access-Control-Allow-Origin"], "*");
  } finally {
    process.env.NODE_ENV = before;
  }
});
