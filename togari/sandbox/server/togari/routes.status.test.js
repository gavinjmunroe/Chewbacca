import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { togariRouter } from "./routes.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/togari", togariRouter);
  return app;
}

describe("GET /api/togari/status", () => {
  it("reports configuration state in the standard envelope", async () => {
    const res = await request(makeApp()).get("/api/togari/status");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("bigquery");
    expect(res.body.data).toHaveProperty("mcp");
    expect(res.body.data).toHaveProperty("brand");
  });
});
