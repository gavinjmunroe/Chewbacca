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
  callTogariTool.mockResolvedValue({ parsed: "ok" });
});

describe("management endpoints", () => {
  it("lists won clients with parsed attributes and grouped open tasks", async () => {
    runQuery
      .mockResolvedValueOnce([
        {
          client_id: "acme",
          name: "Acme",
          status: "won",
          attributes: '{"slack_url":"https://s"}',
        },
        {
          client_id: "globex",
          name: "Globex",
          status: "won",
          attributes: null,
        },
      ])
      .mockResolvedValueOnce([
        {
          client_id: "acme",
          task_id: "t1",
          description: "Send proposal",
          due_date: "2026-07-20",
          overdue: true,
        },
        {
          client_id: "acme",
          task_id: "t2",
          description: "Book kickoff",
          due_date: null,
          overdue: false,
        },
      ]);
    const res = await request(app).get("/api/togari/management");
    expect(res.body.data.scope).toBe("paying");
    const [acme, globex] = res.body.data.clients;
    expect(acme.attributes.slack_url).toBe("https://s");
    expect(acme.tasks).toHaveLength(2);
    expect(acme.tasks[0]).toMatchObject({ task_id: "t1", overdue: true });
    expect(globex.tasks).toEqual([]);
    // Second query fetches open tasks for exactly the listed clients.
    expect(runQuery.mock.calls[1][0]).toMatch(/status = 'open'/);
    expect(runQuery.mock.calls[1][1]).toEqual({ ids: ["acme", "globex"] });
  });

  it("widens to all active accounts with scope=all", async () => {
    runQuery.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const res = await request(app).get("/api/togari/management?scope=all");
    expect(res.body.data.scope).toBe("all");
    expect(runQuery.mock.calls[0][0]).toMatch(/status = 'active'/);
    expect(runQuery.mock.calls[0][0]).not.toMatch(/Closed Won/);
    // No clients means the tasks query is skipped entirely.
    expect(runQuery).toHaveBeenCalledTimes(1);
  });

  it("updates client meta through MCP upsert", async () => {
    const res = await request(app)
      .post("/api/togari/management/acme/meta")
      .send({
        name: "Acme",
        slack_url: "https://slack.test",
        contract_url: "https://c",
      });
    expect(res.status).toBe(200);
    expect(callTogariTool).toHaveBeenCalledWith("togari_client_upsert", {
      client_id: "acme",
      name: "Acme",
      attributes: {
        slack_url: "https://slack.test",
        contract_url: "https://c",
      },
    });
  });

  it("stores a DNC upload as client context", async () => {
    const res = await request(app)
      .post("/api/togari/management/acme/dnc")
      .send({ name: "Acme", filename: "dnc.csv", content: "email\na@b.com" });
    expect(res.status).toBe(200);
    expect(callTogariTool).toHaveBeenCalledWith("togari_context_add", {
      client_id: "acme",
      title: "Do not contact list (dnc.csv)",
      content: "email\na@b.com",
      content_type: "file",
      source: "dashboard",
    });
  });

  it("rejects a DNC upload without content", async () => {
    const res = await request(app)
      .post("/api/togari/management/acme/dnc")
      .send({ name: "Acme", filename: "dnc.csv" });
    expect(res.status).toBe(400);
  });
});
