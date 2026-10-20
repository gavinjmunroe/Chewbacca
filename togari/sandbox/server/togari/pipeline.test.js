import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("./bigquery.js", () => ({
  runQuery: vi.fn(),
  table: (d, n) => `\`p.${d}.${n}\``,
}));
vi.mock("./mcpClient.js", () => ({ callTogariTool: vi.fn() }));
import { runQuery } from "./bigquery.js";
import { callTogariTool } from "./mcpClient.js";
import { togariRouter } from "./routes.js";

const app = express();
app.use(express.json());
app.use("/api/togari", togariRouter);

beforeEach(() => {
  runQuery.mockReset();
  callTogariTool.mockReset();
});

describe("pipeline endpoints", () => {
  it("groups clients by stage in canonical order", async () => {
    runQuery.mockResolvedValueOnce([
      { client_id: "a", name: "A", stage: "won" },
      { client_id: "b", name: "B", stage: "prospect" },
      { client_id: "c", name: "C", stage: null },
    ]);
    const res = await request(app).get("/api/togari/pipeline");
    const stages = res.body.data.stages.map((s) => s.stage);
    expect(stages.indexOf("prospect")).toBeLessThan(stages.indexOf("won"));
    expect(stages).toContain("unstaged");
  });

  it("moves a client to a new stage via MCP upsert", async () => {
    callTogariTool.mockResolvedValue({ parsed: "updated" });
    const res = await request(app)
      .patch("/api/togari/pipeline/acme")
      .send({ stage: "call", name: "Acme" });
    expect(res.body.data).toEqual({ moved: true, stage: "call" });
    expect(callTogariTool).toHaveBeenCalledWith("togari_client_upsert", {
      client_id: "acme",
      name: "Acme",
      stage: "call",
    });
  });

  it("rejects a stage move without name or stage", async () => {
    const res = await request(app).patch("/api/togari/pipeline/acme").send({});
    expect(res.status).toBe(400);
  });

  it("returns client detail with task and context analytics", async () => {
    runQuery
      .mockResolvedValueOnce([
        { client_id: "acme", name: "Acme", stage: "call" },
      ])
      .mockResolvedValueOnce([
        { task_id: "t1", status: "open" },
        { task_id: "t2", status: "done" },
      ])
      .mockResolvedValueOnce([
        { context_id: "c1", content_type: "email", occurred_at: "2026-07-18" },
      ]);
    const res = await request(app).get("/api/togari/clients/acme");
    expect(res.body.data.analytics.openTasks).toBe(1);
    expect(res.body.data.analytics.doneTasks).toBe(1);
    expect(res.body.data.analytics.contextByType).toEqual({ email: 1 });
  });
});
