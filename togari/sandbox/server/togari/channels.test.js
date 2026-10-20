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

describe("channel endpoints", () => {
  it("aggregates raw channels into configured groups", async () => {
    runQuery.mockResolvedValueOnce([
      {
        channel: "gmail",
        interactions: 40,
        people: 12,
        inbound: 9,
        last_activity: "2026-07-19",
      },
      {
        channel: "linkedin",
        interactions: 5,
        people: 4,
        inbound: 2,
        last_activity: "2026-07-18",
      },
    ]);
    const res = await request(app).get("/api/togari/channels");
    const email = res.body.data.channels.find((c) => c.key === "email");
    const fm = res.body.data.channels.find(
      (c) => c.key === "founder-marketing",
    );
    expect(email.interactions).toBe(40);
    expect(email.inbound).toBe(9);
    expect(fm.interactions).toBe(5);
  });

  it("404s on unknown channel key", async () => {
    const res = await request(app).get("/api/togari/channels/telegraph");
    expect(res.status).toBe(404);
  });

  it("returns weekly series and top people for a channel", async () => {
    runQuery
      .mockResolvedValueOnce([{ week: "2026-07-13", count: 7, inbound: 3 }])
      .mockResolvedValueOnce([
        {
          person_id: "p1",
          full_name: "Ada",
          company: "Acme",
          total: 6,
          inbound: 3,
        },
      ]);
    const res = await request(app).get("/api/togari/channels/email");
    expect(res.body.data.analytics.weekly[0].count).toBe(7);
    expect(res.body.data.related.topPeople[0].full_name).toBe("Ada");
    expect(res.body.data.entity.label).toBe("Email Outbound");
    const topPeopleSql = runQuery.mock.calls[1][0];
    expect(topPeopleSql).toContain(
      "i.occurred_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 84 DAY)",
    );
  });
});
