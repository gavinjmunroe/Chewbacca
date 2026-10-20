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

describe("companies endpoints", () => {
  it("lists companies with total count", async () => {
    runQuery
      .mockResolvedValueOnce([
        { client_id: "c001", name: "Horizon Robotics", stage: "prospect" },
      ])
      .mockResolvedValueOnce([{ total: 1 }]);
    const res = await request(app).get("/api/togari/companies");
    expect(res.status).toBe(200);
    expect(res.body.data.rows[0].name).toBe("Horizon Robotics");
    expect(res.body.data.total).toBe(1);
  });

  it("passes the search term through to the query", async () => {
    runQuery
      .mockResolvedValueOnce([
        { client_id: "c002", name: "Meridian Health", stage: "prospect" },
      ])
      .mockResolvedValueOnce([{ total: 1 }]);
    const res = await request(app).get("/api/togari/companies?search=meridian");
    expect(res.status).toBe(200);
    expect(res.body.data.rows[0].name).toBe("Meridian Health");
    const listParams = runQuery.mock.calls[0][1];
    expect(listParams.search).toBe("meridian");
  });

  it("returns an empty list with a zero total", async () => {
    runQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([{ total: 0 }]);
    const res = await request(app).get("/api/togari/companies?search=nomatch");
    expect(res.status).toBe(200);
    expect(res.body.data.rows).toEqual([]);
    expect(res.body.data.total).toBe(0);
  });
});
