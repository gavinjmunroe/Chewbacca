import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { verifyIdToken } = vi.hoisted(() => ({ verifyIdToken: vi.fn() }));
vi.mock("google-auth-library", () => ({
  OAuth2Client: function OAuth2Client() {
    return { verifyIdToken };
  },
}));

vi.mock("./db.js", () => ({
  findApiKeyByHash: vi.fn(),
}));
// Stub settings.js so importing verify.js in isolation does not pull in the
// real routes.js registration chain (routes.js <-> settings.js is a cycle that
// only resolves in load order at app startup, not when verify.js loads first).
vi.mock("./togari/settings.js", () => ({
  hashKey: (key) => "hash:" + key,
}));

import { findApiKeyByHash } from "./db.js";
import { requireBMAUser } from "./verify.js";

const app = express();
app.get("/protected", requireBMAUser, (req, res) => {
  res.json({ user: req.user });
});

beforeEach(() => {
  verifyIdToken.mockReset();
  findApiKeyByHash.mockReset();
});

describe("requireBMAUser with API keys", () => {
  it("accepts a valid tbk_ key and marks the user viaApiKey", async () => {
    findApiKeyByHash.mockResolvedValueOnce({
      id: "k1",
      email: "sagar@bluemodernadvisory.com",
      label: "Zapier",
    });
    const res = await request(app)
      .get("/protected")
      .set("Authorization", "Bearer tbk_deadbeef");
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      email: "sagar@bluemodernadvisory.com",
      name: "Zapier",
      viaApiKey: true,
    });
    expect(findApiKeyByHash).toHaveBeenCalledWith("hash:tbk_deadbeef");
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it("rejects an unknown or revoked tbk_ key with 401", async () => {
    findApiKeyByHash.mockResolvedValueOnce(null);
    const res = await request(app)
      .get("/protected")
      .set("Authorization", "Bearer tbk_unknown");
    expect(res.status).toBe(401);
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it("rejects a tbk_ key with 401 when the database errors", async () => {
    findApiKeyByHash.mockRejectedValueOnce(
      new Error("DATABASE_URL is not set"),
    );
    const res = await request(app)
      .get("/protected")
      .set("Authorization", "Bearer tbk_dberror");
    expect(res.status).toBe(401);
  });

  it("still accepts a valid Google token", async () => {
    verifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({
        email_verified: true,
        email: "user@bluemodernadvisory.com",
        name: "Real User",
        hd: "bluemodernadvisory.com",
      }),
    });
    const res = await request(app)
      .get("/protected")
      .set("Authorization", "Bearer google-id-token");
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      email: "user@bluemodernadvisory.com",
      name: "Real User",
    });
    expect(findApiKeyByHash).not.toHaveBeenCalled();
  });
});
