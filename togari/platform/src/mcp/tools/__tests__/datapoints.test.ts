import { describe, it, expect } from "vitest";
import { queueBqRows, getMockState } from "../../../../tests/smoke/helpers";
import { BigQueryClient } from "../../../bigquery/client";
import { buildDatapointsGetTool } from "../datapoints";

const CTX = { tenantId: "test_tenant", userId: "test-user" };
function makeBq() {
  return new BigQueryClient("test-project", null, null);
}

describe("togari_datapoints_get", () => {
  const tool = buildDatapointsGetTool({ bq: makeBq() });

  it("groups datapoints by source_type and renders a table per group", async () => {
    queueBqRows([
      {
        key: "industry",
        value: "Industrial Distribution",
        source_type: "clay",
        source_evidence_url: null,
        created_at: { value: "2026-05-10T10:00:00Z" },
      },
      {
        key: "headcount_estimate",
        value: "120",
        source_type: "clay",
        source_evidence_url: "https://clay.example/run/1",
        created_at: { value: "2026-05-10T10:00:00Z" },
      },
      {
        key: "ceo_name",
        value: "Jane Owner",
        source_type: "agent_research",
        source_evidence_url: "https://acme.com/about",
        created_at: { value: "2026-05-11T09:00:00Z" },
      },
    ]);

    const result = await tool.handler({ companyId: "c1" }, CTX);
    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain("Total: 3 across 2 source types.");
    expect(text).toContain("**Source: clay** (2)");
    expect(text).toContain("**Source: agent_research** (1)");
    expect(text).toContain("industry");
    expect(text).toContain("Jane Owner");

    const last = getMockState().bq.queries.at(-1);
    expect(last.params.companyId).toBe("c1");
    expect(last.params.tenantId).toBe("test_tenant");
    expect(last.sql).not.toContain("IN UNNEST(@keys)");
  });

  it("adds the IN UNNEST(@keys) filter when keys are passed", async () => {
    queueBqRows([]);
    const result = await tool.handler(
      { companyId: "c1", keys: ["industry", "headcount_estimate"] },
      CTX,
    );
    expect(result.content[0].text).toContain("No datapoints found");
    expect(result.content[0].text).toContain("industry, headcount_estimate");

    const last = getMockState().bq.queries.at(-1);
    expect(last.sql).toContain("IN UNNEST(@keys)");
    expect(last.params.keys).toEqual(["industry", "headcount_estimate"]);
  });

  it("rejects missing companyId", async () => {
    const result = await tool.handler({} as any, CTX);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid arguments");
  });
});
