import { describe, it, expect } from "vitest";
import { queueBqRows, getMockState } from "../../../../tests/smoke/helpers";
import { BigQueryClient } from "../../../bigquery/client";
import { buildClayListImportsTool, buildClayGetImportTool } from "../clay";

const CTX = { tenantId: "test_tenant", userId: "test-user" };
function makeBq() {
  return new BigQueryClient("test-project", null, null);
}

describe("togari_clay_list_imports", () => {
  const tool = buildClayListImportsTool({ bq: makeBq() });

  it("renders a markdown table of recent imports", async () => {
    queueBqRows([
      {
        id: "imp_1",
        clay_run_id: "run_a",
        mandate_id: "mandate_42",
        status: "completed",
        total_records: 50,
        company_count: 50,
        contact_count: 87,
        received_at: { value: "2026-05-11T20:00:00Z" },
        processed_at: { value: "2026-05-11T20:00:05Z" },
        error_message: null,
      },
      {
        id: "imp_2",
        clay_run_id: "run_b",
        mandate_id: null,
        status: "failed",
        total_records: 10,
        company_count: 0,
        contact_count: 0,
        received_at: { value: "2026-05-11T18:00:00Z" },
        processed_at: null,
        error_message: "schema validation failed",
      },
    ]);

    const result = await tool.handler({ limit: 50 }, CTX);
    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain("Returned 2 of up to 50");
    expect(text).toContain("run_a");
    expect(text).toContain("schema validation failed");

    const last = getMockState().bq.queries.at(-1);
    expect(last.params.tenantId).toBe("test_tenant");
    expect(last.params.limit).toBe(50);
    expect(last.sql).toContain("ORDER BY received_at DESC");
  });

  it("adds status filter when provided", async () => {
    queueBqRows([]);
    await tool.handler({ status: "failed" }, CTX);
    const last = getMockState().bq.queries.at(-1);
    expect(last.sql).toContain("status = @status");
    expect(last.params.status).toBe("failed");
  });

  it("rejects unknown status enum value", async () => {
    const result = await tool.handler({ status: "halfway" as any }, CTX);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid arguments");
  });
});

describe("togari_clay_get_import", () => {
  const tool = buildClayGetImportTool({ bq: makeBq() });

  it("looks up by id", async () => {
    queueBqRows([
      {
        id: "imp_1",
        clay_run_id: "run_a",
        clay_table_id: "tbl_x",
        mandate_id: "mandate_42",
        payload_hash: "hash_abc",
        total_records: 50,
        company_count: 50,
        contact_count: 87,
        status: "completed",
        error_message: null,
        received_at: { value: "2026-05-11T20:00:00Z" },
        processed_at: { value: "2026-05-11T20:00:05Z" },
      },
    ]);
    const result = await tool.handler({ id: "imp_1" }, CTX);
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Clay import");
    expect(result.content[0].text).toContain("hash_abc");

    const last = getMockState().bq.queries.at(-1);
    expect(last.sql).toContain("id = @id AND tenant_id = @tenantId");
    expect(last.params.id).toBe("imp_1");
  });

  it("looks up by clay_run_id when id is omitted", async () => {
    queueBqRows([]);
    const result = await tool.handler({ clay_run_id: "run_z" }, CTX);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No Clay import found");

    const last = getMockState().bq.queries.at(-1);
    expect(last.sql).toContain("clay_run_id = @clayRunId");
    expect(last.params.clayRunId).toBe("run_z");
  });

  it("rejects when both id and clay_run_id are provided", async () => {
    const result = await tool.handler(
      { id: "imp_1", clay_run_id: "run_a" },
      CTX,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid arguments");
  });

  it("rejects when neither id nor clay_run_id is provided", async () => {
    const result = await tool.handler({}, CTX);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid arguments");
  });
});
