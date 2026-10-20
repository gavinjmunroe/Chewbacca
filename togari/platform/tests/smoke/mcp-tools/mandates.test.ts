/**
 * Smoke tests for the togari.mandates.* MCP tool modules.
 *
 * BigQuery is mocked by tests/smoke/setup.ts; tests queue per-query response
 * rows on globalThis.__smoke.bq.queryResponses and assert against captured
 * SQL fragments + params.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  listMandatesTool,
  getMandateTool,
  createMandateTool,
  __resetMandatesBigQueryClient,
} from "../../../src/mcp/tools/mandates";

type SmokeState = {
  bq: {
    queries: Array<{ sql: string; params: Record<string, unknown> }>;
    writes: Array<{ sql: string; params: Record<string, unknown> }>;
    queryResponses: unknown[][];
  };
};

function smoke(): SmokeState {
  return (globalThis as any).__smoke as SmokeState;
}

const CTX = { tenantId: "48north", userId: "test-user" };

beforeEach(() => {
  __resetMandatesBigQueryClient();
  smoke().bq.queries.length = 0;
  smoke().bq.writes.length = 0;
  smoke().bq.queryResponses.length = 0;
  (smoke() as any).bq.inserts.length = 0;
});

describe("togari_mandates_list", () => {
  it("returns a markdown table for active mandates", async () => {
    smoke().bq.queryResponses.push([
      {
        id: "m1",
        name: "Industrial Services 2026",
        active_criteria_version_id: "cv1",
        is_deleted: false,
        created_at: "2026-05-01T10:00:00Z",
        updated_at: "2026-05-10T10:00:00Z",
        active_company_count: 42,
      },
      {
        id: "m2",
        name: "B2B SaaS LMM",
        active_criteria_version_id: null,
        is_deleted: false,
        created_at: "2026-04-15T10:00:00Z",
        updated_at: "2026-05-09T10:00:00Z",
        active_company_count: 0,
      },
    ]);

    const res = await listMandatesTool.handler({}, CTX);
    expect(res.isError).toBeFalsy();
    const text = res.content[0].text;
    expect(text).toContain("2 mandates");
    expect(text).toContain("Industrial Services 2026");
    expect(text).toContain("B2B SaaS LMM");
    expect(text).toContain("| 42 |");
    expect(text).toContain("| 0 |");

    expect(smoke().bq.queries).toHaveLength(1);
    const q = smoke().bq.queries[0];
    expect(q.params.tenant_id).toBe("48north");
    expect(q.params.limit).toBe(50);
    expect(q.sql).toMatch(/is_deleted = FALSE/);
  });

  it("honors status=archived filter", async () => {
    smoke().bq.queryResponses.push([]);
    const res = await listMandatesTool.handler({ status: "archived" }, CTX);
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toContain("No mandates found");
    expect(smoke().bq.queries[0].sql).toMatch(/is_deleted = TRUE/);
  });

  it("honors status=all (no filter)", async () => {
    smoke().bq.queryResponses.push([]);
    await listMandatesTool.handler({ status: "all" }, CTX);
    const sql = smoke().bq.queries[0].sql;
    expect(sql).not.toMatch(/is_deleted = TRUE/);
    expect(sql).not.toMatch(/is_deleted = FALSE/);
  });

  it("rejects an invalid limit", async () => {
    const res = await listMandatesTool.handler({ limit: 9999 }, CTX);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/Invalid input/);
  });
});

describe("togari_mandates_get", () => {
  it("renders mandate with active criteria version", async () => {
    smoke().bq.queryResponses.push([
      {
        id: "m1",
        name: "Industrial Services 2026",
        context: "Lower middle market industrials with $5-25M EBITDA.",
        active_criteria_version_id: "cv1",
        tool_settings: null,
        is_deleted: false,
        created_at: "2026-05-01T10:00:00Z",
        updated_at: "2026-05-10T10:00:00Z",
        active_version_number: 1,
        active_spec_text: "Companies must operate in industrial services.",
        active_key_data_points: ["revenue", "employee_count"],
        active_company_count: 17,
      },
    ]);
    const res = await getMandateTool.handler({ id: "m1" }, CTX);
    expect(res.isError).toBeFalsy();
    const text = res.content[0].text;
    expect(text).toContain("# Mandate: Industrial Services 2026");
    expect(text).toContain("Active criteria version**: v1 (cv1)");
    expect(text).toContain("Active companies**: 17");
    expect(text).toContain("operate in industrial services");

    const q = smoke().bq.queries[0];
    expect(q.params.tenant_id).toBe("48north");
    expect(q.params.id).toBe("m1");
  });

  it("returns isError when mandate missing", async () => {
    smoke().bq.queryResponses.push([]);
    const res = await getMandateTool.handler({ id: "missing" }, CTX);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/not found/);
  });

  it("rejects empty id", async () => {
    const res = await getMandateTool.handler({ id: "" }, CTX);
    expect(res.isError).toBe(true);
  });
});

describe("togari_mandates_create", () => {
  it("streams mandate insert, inserts criteria v1 via SQL, and updates mandate to point at it", async () => {
    const res = await createMandateTool.handler(
      {
        name: "Healthcare Services 2026",
        context: "Roll-up plays in ambulatory healthcare.",
        criteriaSpecText: "PE-backed healthcare services platforms.",
        keyDataPoints: ["revenue", "ebitda"],
      },
      CTX,
    );
    expect(res.isError).toBeFalsy();

    // Mandate row goes through the streaming insertAll API (table().insert(...))
    // so it lands on smoke.bq.inserts, NOT smoke.bq.writes. This bypasses the
    // executeWrite guard which rejects any SQL containing the substring
    // "DELETE" (matched by the `is_deleted` column name).
    const inserts = (smoke() as any).bq.inserts as Array<{
      dataset: string;
      table: string;
      rows: unknown[];
    }>;
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe("mandates");
    const mandateRow = inserts[0].rows[0] as Record<string, unknown>;
    expect(mandateRow.tenant_id).toBe("48north");
    expect(mandateRow.name).toBe("Healthcare Services 2026");
    expect(mandateRow.context).toBe("Roll-up plays in ambulatory healthcare.");
    expect(mandateRow.is_deleted).toBe(false);
    expect(mandateRow.active_criteria_version_id).toBeNull();
    const mandateId = mandateRow.id as string;
    expect(mandateId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    // Criteria insert + mandate update both go through executeWrite -> writes[]
    const writes = smoke().bq.writes;
    expect(writes).toHaveLength(2);
    expect(writes[0].sql).toMatch(/INSERT INTO .*mandate_criteria_versions/i);
    expect(writes[1].sql).toMatch(/UPDATE .*mandates/i);

    const criteriaInsert = writes[0];
    expect(criteriaInsert.params.mandate_id).toBe(mandateId);
    expect(criteriaInsert.params.spec_text).toBe(
      "PE-backed healthcare services platforms.",
    );
    expect(JSON.parse(criteriaInsert.params.key_data_points as string)).toEqual(
      ["revenue", "ebitda"],
    );
    const criteriaId = criteriaInsert.params.id as string;

    const update = writes[1];
    expect(update.params.criteria_id).toBe(criteriaId);
    expect(update.params.mandate_id).toBe(mandateId);

    const text = res.content[0].text;
    expect(text).toContain("Mandate created");
    expect(text).toContain(mandateId);
    expect(text).toContain(criteriaId);
  });

  it("defaults key_data_points to []", async () => {
    await createMandateTool.handler(
      {
        name: "Test Mandate",
        criteriaSpecText: "spec",
      },
      CTX,
    );
    const writes = smoke().bq.writes;
    expect(writes[0].params.key_data_points).toBe("[]");
  });

  it("rejects missing required fields", async () => {
    const res = await createMandateTool.handler(
      { name: "Test" } /* no criteriaSpecText */,
      CTX,
    );
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/Invalid input/);
  });
});
