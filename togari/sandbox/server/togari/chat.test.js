import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("./bigquery.js", () => ({
  runQuery: vi.fn(),
  table: (d, n) => `\`p.${d}.${n}\``,
}));
vi.mock("./mcpClient.js", () => ({ callTogariTool: vi.fn() }));
import { callTogariTool } from "./mcpClient.js";
import { togariRouter } from "./routes.js";

const app = express();
app.use(express.json());
app.use("/api/togari", togariRouter);

beforeEach(() => callTogariTool.mockReset());

describe("chat and refresh", () => {
  it("proxies chat messages to togari_ask", async () => {
    callTogariTool.mockResolvedValue({ parsed: "You have 3 open tasks." });
    const res = await request(app)
      .post("/api/togari/chat")
      .send({ message: "what are my open tasks" });
    expect(res.body.data.answer).toBe("You have 3 open tasks.");
    expect(callTogariTool).toHaveBeenCalledWith("togari_ask", {
      question: "what are my open tasks",
    });
  });

  it("rejects empty messages", async () => {
    const res = await request(app).post("/api/togari/chat").send({});
    expect(res.status).toBe(400);
  });

  it("triggers a full pull on refresh", async () => {
    callTogariTool.mockResolvedValue({ parsed: "Pulled 12 items" });
    const res = await request(app)
      .post("/api/togari/refresh")
      .send({ sinceDays: 3 });
    expect(res.body.data.summary).toBe("Pulled 12 items");
    expect(callTogariTool).toHaveBeenCalledWith("togari_pull", {
      source: "all",
      since_days: 3,
    });
  });
});
