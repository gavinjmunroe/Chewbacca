import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("./bigquery.js", () => ({
  runQuery: vi.fn(),
  table: (d, n) => `\`p.${d}.${n}\``,
}));
import { runQuery } from "./bigquery.js";
import { togariRouter } from "./routes.js";

const app = express();
app.use(express.json());
app.use("/api/togari", togariRouter);

beforeEach(() => runQuery.mockReset());

describe("people endpoints", () => {
  it("lists people with total count", async () => {
    runQuery
      .mockResolvedValueOnce([
        { person_id: "p1", full_name: "Ada", company: "Acme" },
      ])
      .mockResolvedValueOnce([{ total: 1 }]);
    const res = await request(app).get("/api/togari/people?search=ada");
    expect(res.status).toBe(200);
    expect(res.body.data.rows[0].full_name).toBe("Ada");
    expect(res.body.data.total).toBe(1);
  });

  it("returns 404 for a missing person", async () => {
    runQuery.mockResolvedValue([]);
    const res = await request(app).get("/api/togari/people/nope");
    expect(res.status).toBe(404);
  });

  it("returns entity, related interactions, and analytics for a person", async () => {
    runQuery
      .mockResolvedValueOnce([{ person_id: "p1", full_name: "Ada" }])
      .mockResolvedValueOnce([
        {
          interaction_id: "i1",
          channel: "gmail",
          sentiment: 0.5,
          occurred_at: "2026-07-01",
        },
        {
          interaction_id: "i2",
          channel: "gmail",
          sentiment: 0.1,
          occurred_at: "2026-07-02",
        },
      ])
      .mockResolvedValueOnce([{ month: "2026-07", count: 2 }]);
    const res = await request(app).get("/api/togari/people/p1");
    expect(res.body.data.entity.full_name).toBe("Ada");
    expect(res.body.data.related.interactions).toHaveLength(2);
    expect(res.body.data.analytics.byChannel).toEqual({ gmail: 2 });
    expect(res.body.data.analytics.avgSentiment).toBeCloseTo(0.3);
    expect(res.body.data.analytics.monthly).toEqual([
      { month: "2026-07", count: 2 },
    ]);
  });
});
