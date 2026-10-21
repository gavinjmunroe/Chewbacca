import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── In-memory store + DB mock using vi.hoisted ────────────────────────────────
const { rows, dbMock } = vi.hoisted(() => {
  const rows: Record<string, { status_code: number; response_body: string }> = {};

  const dbMock = {
    db: {
      prepare: vi.fn((sql: string) => ({
        get: vi.fn((...args: unknown[]) => {
          const [key, userId, method, path] = args;
          return rows[`${key}:${userId}:${method}:${path}`] ?? undefined;
        }),
        run: vi.fn((...args: unknown[]) => {
          const [key, userId, method, path, status_code, response_body] = args as [string, number, string, string, number, string];
          const k = `${key}:${userId}:${method}:${path}`;
          if (!rows[k]) rows[k] = { status_code, response_body };
        }),
      })),
    },
  };

  return { rows, dbMock };
});

vi.mock('../../../src/db/database', () => dbMock);

import { applyIdempotency } from '../../../src/middleware/idempotency';
import type { Request, Response, NextFunction } from 'express';

function makeReq(method = 'POST', headers: Record<string, string> = {}, path = '/api/test'): Request {
  return { method, path, headers } as unknown as Request;
}

function makeRes(statusCode = 200): Response {
  const ctx = { status: statusCode };
  const res = {
    get statusCode() { return ctx.status; },
    status(code: number) { ctx.status = code; return res; },
    json: vi.fn((_body: unknown) => res),
  } as unknown as Response;
  return res;
}

beforeEach(() => {
  Object.keys(rows).forEach(k => delete rows[k]);
  vi.clearAllMocks();
});

describe('applyIdempotency', () => {
  it('calls next() for GET requests', () => {
    const req = makeReq('GET', { 'x-idempotency-key': 'key1' });
    const res = makeRes();
    const next = vi.fn();
    applyIdempotency(req, res, next, 1);
    expect(next).toHaveBeenCalledOnce();
  });

  it('calls next() when header is absent for POST', () => {
    const req = makeReq('POST', {});
    const res = makeRes();
    const next = vi.fn();
    applyIdempotency(req, res, next, 1);
    expect(next).toHaveBeenCalledOnce();
  });

  it('replays cached response when key+user+method+path already stored', () => {
    rows['cached-key:42:POST:/api/test'] = { status_code: 201, response_body: JSON.stringify({ id: 99 }) };
    const req = makeReq('POST', { 'x-idempotency-key': 'cached-key' });
    const res = makeRes();
    const next = vi.fn();
    applyIdempotency(req, res, next, 42);
    expect(next).not.toHaveBeenCalled();
    expect(res.json as ReturnType<typeof vi.fn>).toHaveBeenCalledWith({ id: 99 });
  });

  it('different user same key does NOT replay', () => {
    rows['cached-key:1:POST:/api/test'] = { status_code: 200, response_body: JSON.stringify({ ok: true }) };
    const req = makeReq('POST', { 'x-idempotency-key': 'cached-key' });
    const res = makeRes();
    const next = vi.fn();
    applyIdempotency(req, res, next, 99); // different user
    expect(next).toHaveBeenCalledOnce();
  });

  it('same key+user on different path does NOT replay (scoped cache)', () => {
    // Key 'dual-key' is cached under /api/a but reused against /api/b.
    // Without the (key, user_id, method, path) scoping, /api/b would
    // have replayed /api/a's body — a silent cross-endpoint leak.
    rows['dual-key:7:POST:/api/a'] = { status_code: 200, response_body: JSON.stringify({ from: 'a' }) };
    const req = makeReq('POST', { 'x-idempotency-key': 'dual-key' }, '/api/b');
    const res = makeRes();
    const next = vi.fn(() => {
      (res.json as ReturnType<typeof vi.fn>)({ from: 'b' });
    });
    applyIdempotency(req, res, next, 7);
    expect(next).toHaveBeenCalledOnce();
    expect(rows['dual-key:7:POST:/api/b']).toBeDefined();
    expect(JSON.parse(rows['dual-key:7:POST:/api/b'].response_body)).toEqual({ from: 'b' });
    // /api/a's row is untouched.
    expect(JSON.parse(rows['dual-key:7:POST:/api/a'].response_body)).toEqual({ from: 'a' });
  });

  it('same key+user+path but different method does NOT replay', () => {
    rows['m-key:3:POST:/api/x'] = { status_code: 201, response_body: JSON.stringify({ m: 'post' }) };
    const req = makeReq('PATCH', { 'x-idempotency-key': 'm-key' }, '/api/x');
    const res = makeRes();
    const next = vi.fn();
    applyIdempotency(req, res, next, 3);
    expect(next).toHaveBeenCalledOnce();
  });

  it('stores 2xx response on first execution via wrapped res.json', () => {
    const req = makeReq('POST', { 'x-idempotency-key': 'new-key' });
    const res = makeRes(201);
    const next = vi.fn(() => {
      // Simulate handler calling res.json
      (res.json as ReturnType<typeof vi.fn>)({ id: 5 });
    });
    applyIdempotency(req, res, next, 7);
    expect(next).toHaveBeenCalledOnce();
    expect(rows['new-key:7:POST:/api/test']).toBeDefined();
    expect(rows['new-key:7:POST:/api/test'].status_code).toBe(201);
    expect(JSON.parse(rows['new-key:7:POST:/api/test'].response_body)).toEqual({ id: 5 });
  });

  it('does NOT store 4xx responses', () => {
    const req = makeReq('POST', { 'x-idempotency-key': 'fail-key' });
    const res = makeRes(422);
    const next = vi.fn(() => {
      (res.json as ReturnType<typeof vi.fn>)({ error: 'Invalid' });
    });
    applyIdempotency(req, res, next, 3);
    expect(rows['fail-key:3:POST:/api/test']).toBeUndefined();
  });

  it('returns 400 when X-Idempotency-Key exceeds 128 characters', () => {
    const longKey = 'a'.repeat(129);
    const req = makeReq('POST', { 'x-idempotency-key': longKey });
    const res = makeRes();
    const next = vi.fn();
    applyIdempotency(req, res, next, 1);
    expect(next).not.toHaveBeenCalled();
    expect(res.json as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('128') }),
    );
  });

  it('does NOT cache response body exceeding 256 KiB', () => {
    const req = makeReq('POST', { 'x-idempotency-key': 'big-key' });
    const res = makeRes(200);
    const originalJsonSpy = res.json as ReturnType<typeof vi.fn>;
    const largePayload = { data: 'x'.repeat(256 * 1024 + 1) };
    const next = vi.fn(() => {
      // res.json is now the wrapper; calling it exercises the size-cap branch
      res.json(largePayload);
    });
    applyIdempotency(req, res, next, 5);
    expect(next).toHaveBeenCalledOnce();
    // Underlying spy was called (response reached the client)
    expect(originalJsonSpy).toHaveBeenCalledWith(largePayload);
    // But NOT stored in the idempotency store
    expect(rows['big-key:5:POST:/api/test']).toBeUndefined();
  });

  it('handles PUT, PATCH, and DELETE the same as POST', () => {
    for (const method of ['PUT', 'PATCH', 'DELETE'] as const) {
      const req = makeReq(method, { 'x-idempotency-key': `key-${method}` });
      const res = makeRes(200);
      const next = vi.fn();
      applyIdempotency(req, res, next, 1);
      expect(next).toHaveBeenCalled();
      vi.clearAllMocks();
    }
  });
});
