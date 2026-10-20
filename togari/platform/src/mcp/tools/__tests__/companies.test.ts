import { describe, it, expect } from "vitest";
import { queueBqRows, getMockState } from "../../../../tests/smoke/helpers";
import { BigQueryClient } from "../../../bigquery/client";
import { buildCompaniesSearchTool, buildCompaniesGetTool } from "../companies";

const CTX = { tenantId: "test_tenant", userId: "test-user" };

function makeBq() {
  return new BigQueryClient("test-project", null, null);
}

describe("togari_companies_search", () => {
  const tool = buildCompaniesSearchTool({ bq: makeBq() });

  it("renders a markdown table of matching companies and filters by tenant_id", async () => {
    queueBqRows([
      {
        id: "c1",
        name: "Acme Industrial",
        website: "https://acme.com",
        address: "Pittsburgh, PA",
        dc_id: "DC-1001",
        source_original: "clay",
        created_at: { value: "2026-05-10T10:00:00Z" },
      },
      {
        id: "c2",
        name: "Acme Holdings",
        website: null,
        address: null,
        dc_id: null,
        source_original: "manual",
        created_at: { value: "2026-05-09T08:00:00Z" },
      },
    ]);

    const result = await tool.handler({ query: "Acme", limit: 10 }, CTX);
    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain("Acme Industrial");
    expect(text).toContain("Acme Holdings");
    expect(text).toContain("Returned 2 of up to 10");
    expect(text).toContain('query="Acme"');

    const last = getMockState().bq.queries.at(-1);
    expect(last.params.tenantId).toBe("test_tenant");
    expect(last.params.queryPattern).toBe("%Acme%");
    expect(last.params.limit).toBe(10);
    expect(last.sql).toMatch(/FROM\s+`[^`]+companies`/);
    expect(last.sql).toContain("c.tenant_id = @tenantId");
  });

  it("joins mandate_companies when mandateId is provided", async () => {
    queueBqRows([]);
    const result = await tool.handler({ mandateId: "mandate_42" }, CTX);
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Returned 0 of up to 25");

    const last = getMockState().bq.queries.at(-1);
    expect(last.sql).toContain("mandate_companies");
    expect(last.sql).toContain("mc.removed_at IS NULL");
    expect(last.params.mandateId).toBe("mandate_42");
  });

  it("joins latest tier subquery when tier is provided", async () => {
    queueBqRows([]);
    await tool.handler({ tier: 1 }, CTX);
    const last = getMockState().bq.queries.at(-1);
    expect(last.sql).toContain("ROW_NUMBER() OVER");
    expect(last.sql).toContain("latest_tier.tier = @tier");
    expect(last.params.tier).toBe(1);
  });

  it("rejects an unsupported tier value", async () => {
    const result = await tool.handler({ tier: 99 as any }, CTX);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid arguments");
  });

  it("clamps an oversized limit to the 100 max", async () => {
    queueBqRows([]);
    // Zod max() enforces 100, so 200 is rejected. Verify error path.
    const result = await tool.handler({ limit: 200 }, CTX);
    expect(result.isError).toBe(true);
  });
});

describe("togari_companies_get", () => {
  const tool = buildCompaniesGetTool({ bq: makeBq() });

  it("returns the company DL + datapoints summary + recent tier history", async () => {
    queueBqRows([
      {
        id: "c1",
        name: "Acme Industrial",
        website: "https://acme.com",
        address: "Pittsburgh, PA",
        dc_id: "DC-1001",
        source_original: "clay",
        created_at: { value: "2026-05-10T10:00:00Z" },
        updated_at: { value: "2026-05-11T11:11:11Z" },
      },
    ]);
    queueBqRows([
      { source_type: "clay", count: 12 },
      { source_type: "agent_research", count: 5 },
    ]);
    queueBqRows([
      {
        tier: 1,
        confidence_score: 0.91,
        rationale: "Owner-led PE thesis fit.",
        created_at: { value: "2026-05-11T09:00:00Z" },
        tiering_run_id: "run_a",
      },
    ]);

    const result = await tool.handler({ id: "c1" }, CTX);
    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain("Acme Industrial");
    expect(text).toContain("**Datapoints by source_type** (2)");
    expect(text).toContain("clay");
    expect(text).toContain("**Recent tier history (up to 5)**");
    expect(text).toContain("Owner-led PE thesis fit.");

    const queries = getMockState().bq.queries;
    expect(queries).toHaveLength(3);
    for (const q of queries) {
      expect(q.params.tenantId).toBe("test_tenant");
      expect(q.params.id).toBe("c1");
    }
  });

  it("errors when the company is not found for this tenant", async () => {
    queueBqRows([]);
    const result = await tool.handler({ id: "missing" }, CTX);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No company found");
  });

  it("rejects missing id", async () => {
    const result = await tool.handler({} as any, CTX);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid arguments");
  });
});
