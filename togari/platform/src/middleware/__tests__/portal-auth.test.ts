/**
 * portalAuth fails closed. Prod runs on Railway with NODE_ENV unset, and on
 * 2026-10-10 GET /api/v1/portal/dnc/list answered 200 with no key, reading
 * whichever client the x-togari-client header named.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import { request as httpRequest, type Server } from "http";
import { keylessAllowed, portalAuth, sameSecret } from "../portal-auth";

const ADMIN = "admin-key-for-tests-only";
let server: Server;
let base = "";
const savedEnv = process.env.NODE_ENV;
const savedKey = process.env.TOGARI_API_KEY;

// The smoke setup stubs global fetch, so the test talks plain HTTP.
function get(
  path: string,
  headers: Record<string, string> = {},
): Promise<number> {
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
  process.env.TOGARI_API_KEY = ADMIN;
  const app = express();
  app.use(express.json());
  app.use("/api/v1/portal", portalAuth());
  // A stand-in behind the auth (the DNC portal this used to call was removed).
  app.get("/api/v1/portal/probe", (_req, res) => {
    res.json({ ok: true });
  });
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
  process.env.TOGARI_API_KEY = savedKey;
});
afterEach(() => {
  process.env.NODE_ENV = savedEnv;
});

describe("portalAuth", () => {
  it("refuses a keyless request when NODE_ENV is unset, as on prod", async () => {
    delete process.env.NODE_ENV;
    expect(keylessAllowed()).toBe(false);
    expect(await get("/api/v1/portal/probe")).toBe(401);
    expect(
      await get("/api/v1/portal/probe", { "x-togari-client": "zeutara" }),
    ).toBe(401);
    expect(
      await get("/api/v1/portal/probe", { "x-togari-key": "wrong" }),
    ).toBe(401);
  });

  it("refuses a keyless request in production and any other unrecognised NODE_ENV", async () => {
    for (const name of ["production", "staging", ""]) {
      process.env.NODE_ENV = name;
      expect(await get("/api/v1/portal/probe")).toBe(401);
    }
  });

  it("lets the admin key through whatever NODE_ENV says", async () => {
    delete process.env.NODE_ENV;
    expect(
      await get("/api/v1/portal/probe", { "x-togari-key": ADMIN }),
    ).not.toBe(401);
  });

  it("compares the admin key in constant time and still exactly", () => {
    expect(sameSecret(ADMIN, ADMIN)).toBe(true);
    expect(sameSecret(`${ADMIN}x`, ADMIN)).toBe(false);
    expect(sameSecret(ADMIN.slice(0, -1), ADMIN)).toBe(false);
    expect(sameSecret("", ADMIN)).toBe(false);
  });

  it("allows keyless only when NODE_ENV is development or test", () => {
    process.env.NODE_ENV = "development";
    expect(keylessAllowed()).toBe(true);
    process.env.NODE_ENV = "test";
    expect(keylessAllowed()).toBe(true);
  });
});
