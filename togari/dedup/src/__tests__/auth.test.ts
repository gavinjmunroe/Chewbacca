/**
 * Auth Surface Tests
 *
 * Verifies the verify-or-reject contract of:
 *   1. validateOAuthToken (src/services/oauth.ts) — used on the SSE / messages routes
 *   2. requireJwt        (src/middleware/auth.ts) — used on direct-api routes
 *
 * Run:  npx tsx src/__tests__/auth.test.ts
 */

import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

import { validateOAuthToken } from "../services/oauth";
import { requireJwt } from "../middleware/auth";

// ─── Test runner (mirrors src/tests/governance.test.ts) ──────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed++;
      process.stdout.write(`  ✓ ${name}\n`);
    })
    .catch((err) => {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`${name}: ${msg}`);
      process.stdout.write(`  ✗ ${name}\n    ${msg}\n`);
    });
}

function describe(suite: string): void {
  process.stdout.write(`\n── ${suite}\n`);
}

// ─── Mock helpers ─────────────────────────────────────────────────────────────

interface MockResponse {
  statusCode: number;
  body: unknown;
  locals: Record<string, unknown>;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
}

function mockReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

function mockRes(): MockResponse {
  const res: MockResponse = {
    statusCode: 0,
    body: undefined,
    locals: {},
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

function mockNext(): { called: boolean; fn: NextFunction } {
  const state = { called: false } as { called: boolean; fn: NextFunction };
  state.fn = ((err?: unknown) => {
    if (err) throw err;
    state.called = true;
  }) as NextFunction;
  return state;
}

/**
 * Replace jwt.verify with a stub that synchronously calls the verify callback
 * with the provided err/payload pair.
 *
 * jwt.verify's runtime signature with a getKey function is:
 *   verify(token, getKey, options, callback)
 * We don't actually fetch the JWKS — we just shortcut to the final callback.
 */
function stubJwtVerify(result: {
  err: Error | null;
  payload?: jwt.JwtPayload;
}): () => void {
  const original = jwt.verify;
  // @ts-expect-error overriding the overloaded function for tests
  jwt.verify = (
    _token: string,
    _keyOrGetter: unknown,
    _options: unknown,
    callback: (err: Error | null, payload?: jwt.JwtPayload) => void,
  ) => {
    callback(result.err, result.payload);
  };
  return () => {
    jwt.verify = original;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// validateOAuthToken (src/services/oauth.ts)
// ═══════════════════════════════════════════════════════════════════════════

describe("validateOAuthToken — verify-or-reject");

async function run(): Promise<void> {
  await test("missing Authorization header → 401", async () => {
    const req = mockReq();
    const res = mockRes();
    const next = mockNext();
    await validateOAuthToken(req, res as unknown as Response, next.fn);
    assert.equal(res.statusCode, 401);
    assert.equal(next.called, false);
  });

  await test("Bearer prefix missing → 401", async () => {
    const req = mockReq({ authorization: "token-without-bearer-prefix" });
    const res = mockRes();
    const next = mockNext();
    await validateOAuthToken(req, res as unknown as Response, next.fn);
    assert.equal(res.statusCode, 401);
    assert.equal(next.called, false);
  });

  await test("expired token → 401 (no userinfo fallback)", async () => {
    const restore = stubJwtVerify({
      err: new jwt.TokenExpiredError("jwt expired", new Date()),
    });
    try {
      const req = mockReq({ authorization: "Bearer expired.jwt.token" });
      const res = mockRes();
      const next = mockNext();
      await validateOAuthToken(req, res as unknown as Response, next.fn);
      assert.equal(
        res.statusCode,
        401,
        "expired token must return 401, not 200",
      );
      assert.equal(
        next.called,
        false,
        "expired token must NOT reach next() via userinfo fallback",
      );
    } finally {
      restore();
    }
  });

  await test("wrong audience → 401", async () => {
    const restore = stubJwtVerify({
      err: new jwt.JsonWebTokenError("jwt audience invalid"),
    });
    try {
      const req = mockReq({ authorization: "Bearer wrong.aud.token" });
      const res = mockRes();
      const next = mockNext();
      await validateOAuthToken(req, res as unknown as Response, next.fn);
      assert.equal(res.statusCode, 401);
      assert.equal(next.called, false);
    } finally {
      restore();
    }
  });

  await test("valid token without client_id claim → 403", async () => {
    const restore = stubJwtVerify({
      err: null,
      payload: {
        sub: "auth0|abc",
        iss: "https://dev-4prs757badfajpi5.us.auth0.com/",
      },
    });
    try {
      const req = mockReq({ authorization: "Bearer no.client.id" });
      const res = mockRes();
      const next = mockNext();
      await validateOAuthToken(req, res as unknown as Response, next.fn);
      assert.equal(res.statusCode, 403);
      assert.equal(next.called, false);
    } finally {
      restore();
    }
  });

  await test("valid token with namespaced client_id claim → next() called, res.locals set", async () => {
    const restore = stubJwtVerify({
      err: null,
      payload: {
        sub: "auth0|abc",
        "https://mcp.bluemodern.ai/client_id": "bma",
        permissions: ["read:contacts"],
      } as jwt.JwtPayload,
    });
    try {
      const req = mockReq({ authorization: "Bearer good.token" });
      const res = mockRes();
      const next = mockNext();
      await validateOAuthToken(req, res as unknown as Response, next.fn);
      assert.equal(next.called, true, "next() should be called");
      assert.equal(res.locals.clientId, "bma");
      assert.deepEqual(res.locals.permissions, ["read:contacts"]);
    } finally {
      restore();
    }
  });

  await test("valid token with root-level client_id claim → accepted", async () => {
    const restore = stubJwtVerify({
      err: null,
      payload: {
        sub: "auth0|abc",
        client_id: "fallback-tenant",
      } as jwt.JwtPayload,
    });
    try {
      const req = mockReq({ authorization: "Bearer fallback.token" });
      const res = mockRes();
      const next = mockNext();
      await validateOAuthToken(req, res as unknown as Response, next.fn);
      assert.equal(next.called, true);
      assert.equal(res.locals.clientId, "fallback-tenant");
    } finally {
      restore();
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // requireJwt (src/middleware/auth.ts) — TENANT_ID gating
  // ═══════════════════════════════════════════════════════════════════════════

  describe("requireJwt — TENANT_ID gated to non-production");

  /**
   * requireJwt does its JWT work asynchronously (through jwks-rsa). For the
   * production-bypass tests we want to assert that the JWT path is taken;
   * we don't need it to succeed. Asserting that next() is NOT called
   * immediately (synchronously) is enough — the bypass would have called
   * next() inline.
   */
  await test("TENANT_ID set + NODE_ENV=development → bypass taken", async () => {
    const prevEnv = process.env.NODE_ENV;
    const prevTenant = process.env.TENANT_ID;
    process.env.NODE_ENV = "development";
    process.env.TENANT_ID = "bma-dev";
    try {
      const req = mockReq();
      const res = mockRes();
      const next = mockNext();
      requireJwt(req, res as unknown as Response, next.fn);
      assert.equal(next.called, true, "dev-mode TENANT_ID should bypass JWT");
      assert.equal(req.clientId, "bma-dev");
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevTenant === undefined) delete process.env.TENANT_ID;
      else process.env.TENANT_ID = prevTenant;
    }
  });

  await test("TENANT_ID set + NODE_ENV=production → bypass NOT taken (JWT path runs)", async () => {
    const prevEnv = process.env.NODE_ENV;
    const prevTenant = process.env.TENANT_ID;
    process.env.NODE_ENV = "production";
    process.env.TENANT_ID = "bma-prod-leak";
    try {
      const req = mockReq(); // no Authorization header
      const res = mockRes();
      const next = mockNext();
      requireJwt(req, res as unknown as Response, next.fn);
      // No Authorization header + bypass refused → 403 from the missing-Bearer branch
      assert.equal(
        next.called,
        false,
        "production must NOT take the TENANT_ID bypass",
      );
      assert.equal(
        res.statusCode,
        403,
        "production with no Bearer token should return 403, not silently accept TENANT_ID",
      );
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevTenant === undefined) delete process.env.TENANT_ID;
      else process.env.TENANT_ID = prevTenant;
    }
  });

  await test("no TENANT_ID + no Authorization header → 403", async () => {
    const prevEnv = process.env.NODE_ENV;
    const prevTenant = process.env.TENANT_ID;
    process.env.NODE_ENV = "development";
    delete process.env.TENANT_ID;
    try {
      const req = mockReq();
      const res = mockRes();
      const next = mockNext();
      requireJwt(req, res as unknown as Response, next.fn);
      assert.equal(next.called, false);
      assert.equal(res.statusCode, 403);
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (prevTenant !== undefined) process.env.TENANT_ID = prevTenant;
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // RESULTS
  // ═══════════════════════════════════════════════════════════════════════════

  process.stdout.write("\n══════════════════════════════════════════════\n");
  process.stdout.write(`  Results: ${passed} passed, ${failed} failed\n`);
  process.stdout.write("══════════════════════════════════════════════\n");

  if (failures.length > 0) {
    process.stdout.write("\nFailures:\n");
    for (const f of failures) {
      process.stdout.write(`  ✗ ${f}\n`);
    }
    process.exit(1);
  }

  process.stdout.write("\nAll auth tests passed\n");
}

run().catch((err) => {
  process.stderr.write(`Unhandled test runner error: ${err}\n`);
  process.exit(1);
});
