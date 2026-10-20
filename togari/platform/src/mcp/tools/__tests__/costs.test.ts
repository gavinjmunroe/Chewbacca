import { describe, it, expect } from "vitest";
import { queueBqRows, getMockState } from "../../../../tests/smoke/helpers";
import { BigQueryClient } from "../../../bigquery/client";
import {
  buildCostsSummaryForRunTool,
  buildCostsSummaryForMandateTool,
} from "../costs";

const CTX = { tenantId: "test_tenant", userId: "test-user" };
function makeBq() {
  return new BigQueryClient("test-project", null, null);
}

describe("togari_costs_summary_for_run", () => {
  const tool = buildCostsSummaryForRunTool({ bq: makeBq() });

  it("aggregates by service_type and computes per-company average", async () => {
    // 1. run row lookup
    queueBqRows([
      {
        id: "run_a",
        status: "completed",
        total_cost_cents: 1234,
        mandate_id: "mandate_42",
        started_at: { value: "2026-05-11T10:00:00Z" },
        finished_at: { value: "2026-05-11T10:05:00Z" },
      },
    ]);
    // 2. service_type breakdown
    queueBqRows([
      {
        service_type: "ai",
        call_count: 30,
        total_cents: 1000,
        input_tokens: 500000,
        output_tokens: 200000,
      },
      {
        service_type: "zoominfo",
        call_count: 5,
        total_cents: 234,
        input_tokens: 0,
        output_tokens: 0,
      },
    ]);
    // 3. completed companies
    queueBqRows([{ completed: 10 }]);

    const result = await tool.handler({ runId: "run_a", kind: "tiering" }, CTX);
    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain("computed total (cents):** 1234");
    expect(text).toContain("computed total ($):** $12.34");
    expect(text).toContain("per-company average (cents):** 123");
    expect(text).toContain("ai");
    expect(text).toContain("zoominfo");

    const queries = getMockState().bq.queries;
    expect(queries).toHaveLength(3);
    for (const q of queries) {
      expect(q.params.tenantId).toBe("test_tenant");
      expect(q.params.runId).toBe("run_a");
    }
    // Tiering kind uses tiering_runs + tiering_run_companies + tiering_run_id
    expect(queries[0].sql).toContain("tiering_runs");
    expect(queries[1].sql).toContain("tiering_run_id = @runId");
    expect(queries[2].sql).toContain("tiering_run_companies");
  });

  it("hits enrichment tables when kind=enrichment", async () => {
    queueBqRows([
      {
        id: "run_e",
        status: "completed",
        total_cost_cents: 0,
        mandate_id: "mandate_42",
        started_at: null,
        finished_at: null,
      },
    ]);
    queueBqRows([]);
    queueBqRows([{ completed: 0 }]);

    await tool.handler({ runId: "run_e", kind: "enrichment" }, CTX);
    const queries = getMockState().bq.queries;
    expect(queries[0].sql).toContain("enrichment_runs");
    expect(queries[1].sql).toContain("enrichment_run_id = @runId");
    expect(queries[2].sql).toContain("enrichment_run_companies");
  });

  it("errors when the run is not found", async () => {
    queueBqRows([]);
    const result = await tool.handler(
      { runId: "missing", kind: "tiering" },
      CTX,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No tiering run found");
  });

  it("rejects unsupported kind", async () => {
    const result = await tool.handler(
      { runId: "x", kind: "bogus" } as any,
      CTX,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid arguments");
  });
});

describe("togari_costs_summary_for_mandate", () => {
  const tool = buildCostsSummaryForMandateTool({ bq: makeBq() });

  it("rolls up cost_logs across all runs for the mandate", async () => {
    queueBqRows([
      {
        service_type: "ai",
        call_count: 100,
        total_cents: 5000,
        input_tokens: 1000000,
        output_tokens: 500000,
      },
      {
        service_type: "zoominfo",
        call_count: 30,
        total_cents: 750,
        input_tokens: 0,
        output_tokens: 0,
      },
    ]);
    const result = await tool.handler({ mandateId: "mandate_42" }, CTX);
    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain("total (cents):** 5750");
    expect(text).toContain("total ($):** $57.50");

    const last = getMockState().bq.queries.at(-1);
    expect(last.params.mandateId).toBe("mandate_42");
    expect(last.sql).toContain("tiering_runs");
    expect(last.sql).toContain("enrichment_runs");
    expect(last.sql).not.toContain("TIMESTAMP(@since)");
  });

  it("adds the since filter when provided", async () => {
    queueBqRows([]);
    await tool.handler(
      { mandateId: "mandate_42", since: "2026-05-01T00:00:00Z" },
      CTX,
    );
    const last = getMockState().bq.queries.at(-1);
    expect(last.sql).toContain("TIMESTAMP(@since)");
    expect(last.params.since).toBe("2026-05-01T00:00:00Z");
  });

  it("rejects an invalid since timestamp", async () => {
    const result = await tool.handler(
      { mandateId: "mandate_42", since: "not-a-date" },
      CTX,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid arguments");
  });
});
