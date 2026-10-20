import { describe, it, expect } from "vitest";
import type { Request, Response } from "express";
import { queueBqRows, getMockState } from "../../../tests/smoke/helpers";
import { BigQueryClient } from "../../bigquery/client";
import { hashKey, resolveClientKey, issueClientKey } from "../client-keys";
import { portalAuth } from "../../middleware/portal-auth";

function makeBq(): BigQueryClient {
  return new BigQueryClient("test-project", null, null);
}

describe("hashKey", () => {
  it("is stable and hex sha-256", () => {
    const a = hashKey("tgc_abc");
    const b = hashKey("tgc_abc");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashKey("tgc_abc")).not.toBe(hashKey("tgc_xyz"));
  });
});

describe("resolveClientKey", () => {
  it("returns the client_id + scopes when a matching hash row is queued", async () => {
    queueBqRows([{ client_id: "acme", scopes: "portal:dnc,portal:list" }]);
    const result = await resolveClientKey(makeBq(), "tgc_matches");
    expect(result).not.toBeNull();
    expect(result?.clientId).toBe("acme");
    expect(result?.scopes).toEqual(["portal:dnc", "portal:list"]);

    // The lookup queries by the hash of the raw key, never the plaintext.
    const q = getMockState().bq.queries.at(-1);
    expect(q.params.hash).toBe(hashKey("tgc_matches"));
  });

  it("returns null when no row matches", async () => {
    queueBqRows([]);
    const result = await resolveClientKey(makeBq(), "tgc_nope");
    expect(result).toBeNull();
  });
});

describe("issueClientKey", () => {
  it("writes an INSERT with the hash and returns a tgc_ raw key", async () => {
    const { keyId, rawKey } = await issueClientKey(makeBq(), {
      clientId: "acme",
      label: "Acme portal",
    });

    expect(rawKey).toMatch(/^tgc_[0-9a-f]{48}$/);
    expect(keyId).toBeTruthy();

    const write = getMockState().bq.writes.at(-1);
    expect(write.sql.toUpperCase()).toContain("INSERT");
    // Only the hash is persisted, never the raw key.
    expect(write.params.key_hash).toBe(hashKey(rawKey));
    expect(write.params.client_id).toBe("acme");
    expect(JSON.stringify(write.params)).not.toContain(rawKey);
  });
});

describe("portalAuth middleware", () => {
  function mockReq(headers: Record<string, string>): Request {
    const lower: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
    return {
      header: (name: string) => lower[name.toLowerCase()],
    } as unknown as Request;
  }

  function mockRes(): Response & { statusCode?: number; body?: unknown } {
    const res: any = {};
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (payload: unknown) => {
      res.body = payload;
      return res;
    };
    return res;
  }

  it("sets req.togariClientId for a valid tgc_ key", async () => {
    queueBqRows([{ client_id: "acme", scopes: "portal:dnc" }]);
    const req = mockReq({ "x-client-key": "tgc_valid" });
    const res = mockRes();
    let called = false;

    await portalAuth()(req, res, () => {
      called = true;
    });

    expect(called).toBe(true);
    expect(req.togariClientId).toBe("acme");
  });

  it("401s on a bad tgc_ key", async () => {
    queueBqRows([]);
    const req = mockReq({ authorization: "Bearer tgc_bad" });
    const res = mockRes();
    let called = false;

    await portalAuth()(req, res, () => {
      called = true;
    });

    expect(called).toBe(false);
    expect(res.statusCode).toBe(401);
    expect((res.body as { error: string }).error).toBe("invalid client key");
  });

  it("lets the internal TOGARI_API_KEY bypass without a client scope", async () => {
    const prev = process.env.TOGARI_API_KEY;
    process.env.TOGARI_API_KEY = "internal-secret";
    try {
      const req = mockReq({ "x-togari-key": "internal-secret" });
      const res = mockRes();
      let called = false;

      await portalAuth()(req, res, () => {
        called = true;
      });

      expect(called).toBe(true);
      expect(req.togariClientId).toBeUndefined();
    } finally {
      process.env.TOGARI_API_KEY = prev;
    }
  });
});
