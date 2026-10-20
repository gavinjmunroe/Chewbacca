import { describe, it, expect } from "vitest";
import { queueBqRows, getMockState } from "../../../../tests/smoke/helpers";
import { BigQueryClient } from "../../../bigquery/client";
import {
  buildListStagesTool,
  buildSeedDefaultStagesTool,
  buildMoveDealTool,
  buildActivityLogTool,
  buildActivityRecentTool,
  buildOverdueTool,
} from "../pipeline";

const CTX = { tenantId: "bma", userId: "test-user" };

function makeBq() {
  return new BigQueryClient("test-project", null, null);
}

describe("togari_pipeline_list_stages", () => {
  const tool = buildListStagesTool({ bq: makeBq() });

  it("reports when no stages are configured", async () => {
    queueBqRows([]);
    const result = await tool.handler({}, CTX);
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("No stages configured");
  });

  it("filters by pipeline and orders correctly", async () => {
    queueBqRows([
      {
        stage_id: "s1",
        stage_name: "lead",
        pipeline: "inbound",
        stage_order: 1,
        is_active: true,
      },
    ]);
    await tool.handler({ pipeline: "inbound" }, CTX);
    const last = getMockState().bq.queries.at(-1);
    expect(last.sql).toContain("pipeline = @pipeline");
    expect(last.sql).toContain("ORDER BY pipeline, stage_order");
    expect(last.params.pipeline).toBe("inbound");
    expect(last.params.clientId).toBe("bma");
  });
});

describe("togari_pipeline_seed_default_stages", () => {
  const tool = buildSeedDefaultStagesTool({ bq: makeBq() });

  it("skips when the pipeline already has stages (count > 0)", async () => {
    queueBqRows([{ cnt: 6 }]);
    const before = getMockState().bq.writes.length;
    const result = await tool.handler({ pipeline: "inbound" }, CTX);
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Skipped seeding");
    expect(getMockState().bq.writes.length).toBe(before);
  });

  it("inserts the six canonical stages when count is 0", async () => {
    queueBqRows([{ cnt: 0 }]);
    const before = getMockState().bq.writes.length;
    const result = await tool.handler({ pipeline: "outbound" }, CTX);
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Seeded 6 stages");
    expect(getMockState().bq.writes.length).toBe(before + 1);
    const write = getMockState().bq.writes.at(-1);
    expect(write.sql).toContain("INSERT INTO");
    expect(write.sql).toContain("pipeline_stages");
    expect(write.params.pipeline).toBe("outbound");
    expect(write.params.stageName1).toBe("lead");
    expect(write.params.stageName6).toBe("closed_won");
  });
});

describe("togari_pipeline_move_deal", () => {
  const tool = buildMoveDealTool({ bq: makeBq() });

  it("issues an UPDATE then an activity INSERT", async () => {
    queueBqRows([{ deal_id: "deal_1" }]); // existence-check SELECT finds the deal
    const before = getMockState().bq.writes.length;
    const result = await tool.handler(
      { deal_id: "deal_1", to_stage: "proposal_sent" },
      CTX,
    );
    expect(result.isError).toBeFalsy();
    expect(getMockState().bq.writes.length).toBe(before + 2);

    const [updateW, insertW] = getMockState().bq.writes.slice(-2);
    expect(updateW.sql.trim().toUpperCase().startsWith("UPDATE")).toBe(true);
    expect(updateW.sql).toContain("togari_structured_deals");
    expect(updateW.params.stage).toBe("proposal_sent");
    expect(updateW.params.dealId).toBe("deal_1");
    expect(updateW.params.clientId).toBe("bma");

    expect(insertW.sql.trim().toUpperCase().startsWith("INSERT")).toBe(true);
    expect(insertW.sql).toContain("activities");
    expect(insertW.sql).toContain("'stage_change'");
    expect(insertW.params.content).toBe("moved to proposal_sent");
  });

  it("rejects an invalid target stage", async () => {
    const result = await tool.handler(
      { deal_id: "deal_1", to_stage: "not_a_stage" as any },
      CTX,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid arguments");
  });
});

describe("togari_activity_log", () => {
  const tool = buildActivityLogTool({ bq: makeBq() });

  it("inserts an activity row", async () => {
    const before = getMockState().bq.writes.length;
    const result = await tool.handler(
      { deal_id: "deal_1", type: "note", content: "called them" },
      CTX,
    );
    expect(result.isError).toBeFalsy();
    expect(getMockState().bq.writes.length).toBe(before + 1);
    const write = getMockState().bq.writes.at(-1);
    expect(write.sql).toContain("activities");
    expect(write.params.type).toBe("note");
    expect(write.params.content).toBe("called them");
  });
});

describe("togari_activity_recent", () => {
  const tool = buildActivityRecentTool({ bq: makeBq() });

  it("orders by timestamp desc and filters by deal_id", async () => {
    queueBqRows([
      {
        activity_id: "a1",
        deal_id: "deal_1",
        contact_id: null,
        type: "note",
        content: "hi",
        timestamp: { value: "2026-07-10T00:00:00Z" },
      },
    ]);
    await tool.handler({ deal_id: "deal_1", limit: 5 }, CTX);
    const last = getMockState().bq.queries.at(-1);
    expect(last.sql).toContain("ORDER BY timestamp DESC");
    expect(last.sql).toContain("deal_id = @dealId");
    expect(last.params.limit).toBe(5);
  });
});

describe("togari_pipeline_overdue", () => {
  const tool = buildOverdueTool({ bq: makeBq() });

  it("selects unclosed deals past their next_action_date", async () => {
    queueBqRows([]);
    const result = await tool.handler({}, CTX);
    expect(result.isError).toBeFalsy();
    const last = getMockState().bq.queries.at(-1);
    expect(last.sql).toContain("DATE(next_action_date) < CURRENT_DATE()");
    expect(last.sql).toContain("stage NOT LIKE 'closed%'");
    expect(last.params.clientId).toBe("bma");
  });
});
