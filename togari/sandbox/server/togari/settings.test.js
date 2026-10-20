import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../db.js", () => ({
  listApiKeys: vi.fn(),
  insertApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
}));
vi.mock("./config.js", () => ({
  togariConfig: {
    brand: "bma",
    channels: [{ key: "email" }, { key: "founder-marketing" }],
  },
  isBigQueryConfigured: () => true,
  isMcpConfigured: () => false,
}));

import { listApiKeys, insertApiKey, revokeApiKey } from "../db.js";
import { togariRouter } from "./routes.js";

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.user = { email: "sagar@bma.com", name: "Sagar" };
  next();
});
app.use("/api/togari", togariRouter);

beforeEach(() => {
  listApiKeys.mockReset();
  insertApiKey.mockReset();
  revokeApiKey.mockReset();
});

describe("settings endpoints", () => {
  it("returns brand, flags, user echo, and mapped keys", async () => {
    listApiKeys.mockResolvedValueOnce([
      {
        id: "k1",
        label: "Zapier",
        prefix: "tbk_abcd1234",
        createdAt: "2026-07-20T00:00:00.000Z",
        lastUsedAt: null,
      },
    ]);
    const res = await request(app).get("/api/togari/settings");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.brand).toBe("bma");
    expect(res.body.data.bigquery).toBe(true);
    expect(res.body.data.mcp).toBe(false);
    expect(res.body.data.wikiDb).toBe(true);
    expect(res.body.data.channels).toEqual(["email", "founder-marketing"]);
    expect(res.body.data.user).toEqual({
      email: "sagar@bma.com",
      name: "Sagar",
    });
    expect(res.body.data.keys[0].label).toBe("Zapier");
  });

  it("loads without Postgres, returning empty keys and wikiDb false", async () => {
    listApiKeys.mockRejectedValueOnce(new Error("DATABASE_URL is not set"));
    const res = await request(app).get("/api/togari/settings");
    expect(res.status).toBe(200);
    expect(res.body.data.wikiDb).toBe(false);
    expect(res.body.data.keys).toEqual([]);
  });

  it("mints a tbk_ key and returns it once with a matching prefix", async () => {
    insertApiKey.mockImplementationOnce(async ({ email, label, prefix }) => ({
      id: "k2",
      label,
      prefix,
      createdAt: "2026-07-20T00:00:00.000Z",
    }));
    const res = await request(app)
      .post("/api/togari/settings/keys")
      .send({ label: "Zapier" });
    expect(res.status).toBe(200);
    expect(res.body.data.key).toMatch(/^tbk_[0-9a-f]{32}$/);
    expect(res.body.data.prefix).toBe(res.body.data.key.slice(0, 12));
    expect(res.body.data.label).toBe("Zapier");
    const call = insertApiKey.mock.calls[0][0];
    expect(call.email).toBe("sagar@bma.com");
    expect(call.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a blank label with 400", async () => {
    const res = await request(app)
      .post("/api/togari/settings/keys")
      .send({ label: "   " });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(insertApiKey).not.toHaveBeenCalled();
  });

  it("returns 503 when the database is unavailable on create", async () => {
    insertApiKey.mockRejectedValueOnce(new Error("DATABASE_URL is not set"));
    const res = await request(app)
      .post("/api/togari/settings/keys")
      .send({ label: "Zapier" });
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
  });

  it("revokes a key and returns revoked true", async () => {
    revokeApiKey.mockResolvedValueOnce(true);
    const res = await request(app).delete("/api/togari/settings/keys/k1");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ revoked: true });
    expect(revokeApiKey).toHaveBeenCalledWith({
      email: "sagar@bma.com",
      id: "k1",
    });
  });

  it("returns 404 when the key to revoke is not found", async () => {
    revokeApiKey.mockResolvedValueOnce(false);
    const res = await request(app).delete("/api/togari/settings/keys/nope");
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
