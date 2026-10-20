/**
 * Chewbacca Live reads Togari through GET /api/v1/portal/live (2026-10-10).
 * A client key reads only its own client, nothing outside the read tools runs,
 * and every query the tools send is bound to the client in the path.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import { get as httpGet, type Server } from "http";

const queries: { sql: string; params: any }[] = [];
vi.mock("../../../bigquery/client", () => ({
  BigQueryClient: class {
    async executeQuery(sql: string, params: any) {
      queries.push({ sql, params });
      if (/FROM .*reply_items/.test(sql)) {
        return {
          rows: [
            {
              from_address: "a@fund.vc",
              lead_name: "Ann Lee",
              lead_company: "Fund",
              campaign: "Zeutara | Ivy | Pre-seed investors | Wave 2",
              body: "Send the deck",
              category: "autopilot:later",
              received_at: "2026-10-09T10:00:00Z",
            },
          ],
        };
      }
      return { rows: [] };
    }
    async executeWrite() {
      throw new Error("the live read API must never write");
    }
  },
}));
vi.mock("../../../transports/slack/installations", () => ({
  slackBotTokenFor: vi.fn(async () => "xoxb-test"),
}));

import { createLiveReadPortalRouter, readInput } from "../live-read";

// The smoke setup stubs global fetch, so the test talks plain HTTP.
// Every request carries the admin key unless a test says otherwise.
const ADMIN = "admin-key-for-tests-only";
process.env.TOGARI_API_KEY = ADMIN;
function fetch(
  url: string,
  key: string | null = ADMIN,
): Promise<{ status: number; json: () => Promise<any> }> {
  return new Promise((resolve, reject) => {
    httpGet(
      url,
      { headers: key === null ? {} : { "x-togari-key": key } },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          resolve({
            status: res.statusCode || 0,
            json: async () => JSON.parse(body),
          }),
        );
      },
    ).on("error", reject);
  });
}

let server: Server;
let base = "";
let scope: string | undefined;

beforeAll(async () => {
  const app = express();
  // Stands in for portalAuth: a tgc_ key stamps the client, the admin key does not.
  app.use((req, _res, next) => {
    if (scope) (req as any).togariClientId = scope;
    next();
  });
  app.use("/api/v1/portal", createLiveReadPortalRouter());
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/portal`;
});
afterAll(() => server.close());
beforeEach(() => {
  queries.length = 0;
  scope = undefined;
});

describe("live read API", () => {
  it("refuses a request with no key or a wrong key, even with NODE_ENV unset", async () => {
    const saved = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    try {
      for (const path of [
        "live/clients",
        "live/zeutara/list_replies",
        "live/zeutara/summary",
      ]) {
        expect((await fetch(`${base}/${path}`, null)).status).toBe(401);
        expect((await fetch(`${base}/${path}`, "wrong-key")).status).toBe(401);
      }
      expect(queries).toHaveLength(0);
      scope = "zeutara"; // a resolved tgc_ key needs no admin key
      expect((await fetch(`${base}/live/zeutara/summary`, null)).status).toBe(
        200,
      );
    } finally {
      process.env.NODE_ENV = saved;
    }
  });

  it("lists live clients with their brief and Clay scope, and a key sees only its own", async () => {
    const all = await (await fetch(`${base}/live/clients`)).json();
    const z = all.clients.find((c: any) => c.clientId === "zeutara");
    expect(z.campaignPrefix).toBe("Zeutara |");
    expect(z.clayWorkspaceId).toBe("1372623");
    expect(z.brief).toMatch(/Jonah/);
    expect(all.clients.map((c: any) => c.clientId)).not.toContain(
      "zeutara_test",
    );
    scope = "zeutara";
    const mine = await (await fetch(`${base}/live/clients`)).json();
    expect(mine.clients.map((c: any) => c.clientId)).toEqual(["zeutara"]);
  });

  it("binds every query to the client in the path", async () => {
    const r = await fetch(
      `${base}/live/zeutara/list_replies?days=7&company=Ivy`,
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.data[0].company).toBe("Ivy");
    expect(body.data[0].togari_did).toBe("follow up scheduled");
    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) {
      expect(q.sql).toMatch(/client_id = @id/);
      expect(q.params.id).toBe("zeutara");
    }
  });

  it("refuses a zeutara key reading another client, before any query runs", async () => {
    scope = "zeutara";
    const r = await fetch(`${base}/live/serif/list_replies`);
    expect(r.status).toBe(403);
    expect(queries).toHaveLength(0);
  });

  it("refuses act tools and unknown reads", async () => {
    for (const tool of [
      "reply_to_investor",
      "blocklist",
      "tell_team",
      "drop_tables",
    ]) {
      const r = await fetch(`${base}/live/zeutara/${tool}`);
      expect(r.status).toBe(404);
    }
    expect(queries).toHaveLength(0);
  });

  it("404s a client with no live page", async () => {
    expect((await fetch(`${base}/live/hhh/summary`)).status).toBe(404);
  });

  it("keeps only bounded read inputs", () => {
    expect(
      readInput({
        days: "9999",
        company: "  Ivy ",
        evil: "x",
        who: "a".repeat(500),
      }),
    ).toEqual({
      days: 365,
      company: "Ivy",
      who: "a".repeat(120),
    });
  });
});
