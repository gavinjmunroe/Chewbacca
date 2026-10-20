import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { createFixedWindowRateLimit } from "../../../src/middleware/ingest-rate-limit";

function mockReqRes(ip: string) {
  const req = { ip, socket: { remoteAddress: ip } } as unknown as Request;
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader(k: string, v: string) {
      this.headers[k] = v;
    },
  };
  return { req, res: res as unknown as Response & typeof res };
}

describe("createFixedWindowRateLimit", () => {
  it("allows requests up to the limit then 429s", () => {
    const limit = createFixedWindowRateLimit(3);
    const next = vi.fn();

    for (let i = 0; i < 3; i++) {
      const { req, res } = mockReqRes("1.1.1.1");
      limit(req, res, next);
      expect(res.statusCode).toBe(0); // not set → passed through
    }
    expect(next).toHaveBeenCalledTimes(3);

    const { req, res } = mockReqRes("1.1.1.1");
    limit(req, res, next);
    expect(res.statusCode).toBe(429);
    expect((res.body as { error: string }).error).toBe("rate_limited");
    expect(res.headers["Retry-After"]).toBeDefined();
    expect(next).toHaveBeenCalledTimes(3); // not called again
  });

  it("tracks limits independently per IP", () => {
    const limit = createFixedWindowRateLimit(1);
    const next = vi.fn();

    const a = mockReqRes("2.2.2.2");
    limit(a.req, a.res, next);
    expect(a.res.statusCode).toBe(0);

    const b = mockReqRes("3.3.3.3");
    limit(b.req, b.res, next);
    expect(b.res.statusCode).toBe(0); // different IP, own window

    const a2 = mockReqRes("2.2.2.2");
    limit(a2.req, a2.res, next);
    expect(a2.res.statusCode).toBe(429); // same IP over limit
  });
});
