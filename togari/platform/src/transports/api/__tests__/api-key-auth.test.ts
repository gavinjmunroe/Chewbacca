/**
 * The shared X-Togari-Key check must not swallow routes that carry their own
 * auth. Until 2026-10-18 it 401'd every website form fill (Bearer
 * WEBSITE_INGEST_API_KEY) before /api/v1/website could see it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import { request as httpRequest, type Server } from "http";
import { apiKeyAuth } from "../router";

const KEY = "org-key-for-tests-only";
let server: Server;
let base = "";
const savedKey = process.env.TOGARI_API_KEY;

// The smoke setup stubs global fetch, so the test talks plain HTTP.
function get(path: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(`${base}${path}`, { headers }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode || 0));
    });
    req.on("error", reject);
    req.end();
  });
}

beforeAll(async () => {
  process.env.TOGARI_API_KEY = KEY;
  const app = express();
  app.use("/api/v1", apiKeyAuth);
  app.get(/.*/, (_req, res) => {
    res.json({ ok: true });
  });
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
  process.env.TOGARI_API_KEY = savedKey;
});

describe("apiKeyAuth", () => {
  it("requires the org key on ordinary /api/v1 routes", async () => {
    expect(await get("/api/v1/message")).toBe(401);
    expect(await get("/api/v1/message", { "x-togari-key": "wrong" })).toBe(401);
    expect(await get("/api/v1/message", { "x-togari-key": KEY })).toBe(200);
  });

  it("lets website and portal routes through to their own auth", async () => {
    expect(await get("/api/v1/website/icp-status/x")).toBe(200);
    expect(await get("/api/v1/portal/probe")).toBe(200);
  });

  it("does not exempt look-alike prefixes", async () => {
    expect(await get("/api/v1/websites-admin")).toBe(401);
    expect(await get("/api/v1/portalx")).toBe(401);
  });
});
