import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

vi.mock("../../replies/outcome-check", () => ({ findStuck: vi.fn() }));
vi.mock("../../agents/replybot/client-config", () => ({
  getReplybotClient: vi.fn(),
  clayWorkspace: vi.fn(),
}));

import { findStuck } from "../../replies/outcome-check";
import {
  clayWorkspace,
  getReplybotClient,
} from "../../agents/replybot/client-config";
import { respondStuck, resetStuckCache } from "../client-stuck";

const TOKEN = "b".repeat(40);
const HOUR = 3_600_000;

function call(token: string, now = Date.now()) {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    setHeader(k: string, v: string) {
      this.headers[k] = v;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      return this;
    },
  };
  const done = respondStuck(
    { params: { token } } as unknown as Request,
    res as unknown as Response,
    now,
  );
  return { res, done };
}

async function get(token: string, now = Date.now()) {
  const { res, done } = call(token, now);
  await done;
  return res;
}

describe("GET /dash/:token/stuck.json", () => {
  beforeEach(() => {
    resetStuckCache();
    process.env.DASHBOARD_TOKENS = JSON.stringify({ [TOKEN]: "zeutara" });
    vi.mocked(findStuck).mockReset();
    vi.mocked(getReplybotClient).mockReturnValue({ id: "zeutara" } as never);
    vi.mocked(clayWorkspace).mockReturnValue({
      workspaceId: 1,
      campaignPrefix: "Z",
    } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns findStuck for the token's client as JSON", async () => {
    vi.mocked(findStuck).mockResolvedValue([
      {
        email: "a@fund.example",
        company: "Qube",
        hours: 30,
        reason: "asked for deck",
      },
      { email: "b@fund.example", company: "Vertocol", hours: 26 },
    ]);
    const res = await get(TOKEN);
    expect(findStuck).toHaveBeenCalledWith("zeutara");
    expect(res.statusCode).toBe(200);
    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(res.headers["X-Stuck-As-Of"]).toBeTruthy();
    expect(res.body).toEqual([
      {
        email: "a@fund.example",
        company: "Qube",
        hours: 30,
        reason: "asked for deck",
      },
      { email: "b@fund.example", company: "Vertocol", hours: 26, reason: null },
    ]);
  });

  it("serves a recent result without reading Clay again", async () => {
    vi.mocked(findStuck).mockResolvedValue([]);
    await get(TOKEN);
    const res = await get(TOKEN, Date.now() + HOUR);
    expect(res.statusCode).toBe(200);
    expect(findStuck).toHaveBeenCalledTimes(1);
  });

  it("recomputes a result older than two hours", async () => {
    vi.mocked(findStuck)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { email: "c@fund.example", company: "Qube", hours: 50 },
      ]);
    await get(TOKEN);
    const res = await get(TOKEN, Date.now() + 3 * HOUR);
    expect(findStuck).toHaveBeenCalledTimes(2);
    expect(res.body).toEqual([
      { email: "c@fund.example", company: "Qube", hours: 50, reason: null },
    ]);
  });

  it("503s while a slow first computation runs, never an empty list", async () => {
    vi.useFakeTimers();
    vi.mocked(findStuck).mockReturnValue(new Promise(() => {}));
    const { res, done } = call(TOKEN);
    await vi.advanceTimersByTimeAsync(21_000);
    await done;
    expect(res.statusCode).toBe(503);
    expect(Array.isArray(res.body)).toBe(false);
  });

  it("404s an unknown token without reading anything", async () => {
    const res = await get("c".repeat(40));
    expect(res.statusCode).toBe(404);
    expect(findStuck).not.toHaveBeenCalled();
  });

  it("503s a client with no Clay workspace instead of an empty list", async () => {
    vi.mocked(clayWorkspace).mockReturnValue(null as never);
    const res = await get(TOKEN);
    expect(res.statusCode).toBe(503);
    expect(findStuck).not.toHaveBeenCalled();
  });

  it("503s when findStuck throws", async () => {
    vi.mocked(findStuck).mockRejectedValue(new Error("store down"));
    const res = await get(TOKEN);
    expect(res.statusCode).toBe(503);
  });
});
