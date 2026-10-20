/**
 * Smoke tests for togari.enrichment.* MCP tool modules.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  startRunTool,
  getRunTool,
  listRunsTool,
  __resetEnrichmentBigQueryClient,
  __setStartRunImpl,
} from "../../../src/mcp/tools/enrichment";

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

let lastSchedulerCall: {
  kind: string;
  tenantId: string;
  runId: string;
  mode: string;
} | null = null;

beforeEach(() => {
  __resetEnrichmentBigQueryClient();
  smoke().bq.queries.length = 0;
  smoke().bq.writes.length = 0;
  smoke().bq.queryResponses.length = 0;
  lastSchedulerCall = null;
  __setStartRunImpl(async (kind, tenantId, runId, mode) => {
    lastSchedulerCall = { kind, tenantId, runId, mode: mode ?? "agent" };
    return 3;
  });
});

afterEach(() => {
  __setStartRunImpl(null);
});

describe("togari_enrichment_start_run", () => {
  it("validates mandate, inserts run + seeded companies, calls scheduler", async () => {
    smoke().bq.queryResponses.push([
      { active_criteria_version_id: "cv-active" },
    ]);

    const res = await startRunTool.handler({ mandateId: "m1" }, CTX);
    expect(res.isError).toBeFalsy();
    const text = res.content[0].text;
    expect(text).toContain("Enrichment run started.");
    expect(text).toContain("Mandate**: m1");
    expect(text).toContain("Mode**: agent");

    const writes = smoke().bq.writes;
    expect(writes).toHaveLength(2);
    expect(writes[0].sql).toMatch(/INSERT INTO .*enrichment_runs/i);
    expect(writes[1].sql).toMatch(/INSERT INTO .*enrichment_run_companies/i);
    expect(writes[1].sql).not.toMatch(/NOT EXISTS/);

    const runId = writes[0].params.id as string;
    expect(writes[1].params.run_id).toBe(runId);
    expect(writes[0].params.mode).toBe("agent");

    expect(lastSchedulerCall).toEqual({
      kind: "enrichment",
      tenantId: "48north",
      runId,
      mode: "agent",
    });
  });

  it("adds NOT EXISTS clause against enrichment_run_companies when scope='unprocessed'", async () => {
    smoke().bq.queryResponses.push([
      { active_criteria_version_id: "cv-active" },
    ]);
    await startRunTool.handler({ mandateId: "m1", scope: "unprocessed" }, CTX);
    const seedInsert = smoke().bq.writes[1];
    expect(seedInsert.sql).toMatch(/NOT EXISTS/);
    expect(seedInsert.sql).toMatch(/enrichment_run_companies/);
  });

  it("returns error when mandate not found", async () => {
    smoke().bq.queryResponses.push([]);
    const res = await startRunTool.handler({ mandateId: "missing" }, CTX);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/not found/);
    expect(smoke().bq.writes).toHaveLength(0);
    expect(lastSchedulerCall).toBeNull();
  });

  it("supports sequential mode", async () => {
    smoke().bq.queryResponses.push([{ active_criteria_version_id: "cv1" }]);
    await startRunTool.handler({ mandateId: "m1", mode: "sequential" }, CTX);
    expect(lastSchedulerCall?.mode).toBe("sequential");
    expect(smoke().bq.writes[0].params.mode).toBe("sequential");
  });

  it("marks run failed if scheduler throws", async () => {
    smoke().bq.queryResponses.push([
      { active_criteria_version_id: "cv-active" },
    ]);
    __setStartRunImpl(async () => {
      throw new Error("topic missing");
    });
    const res = await startRunTool.handler({ mandateId: "m1" }, CTX);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/topic missing/);
    const lastWrite = smoke().bq.writes[smoke().bq.writes.length - 1];
    expect(lastWrite.sql).toMatch(/UPDATE .*enrichment_runs/i);
    expect(lastWrite.sql).toMatch(/status = 'failed'/);
  });
});

describe("togari_enrichment_get_run", () => {
  it("renders run + counts + cost + agent_summary when present", async () => {
    smoke().bq.queryResponses.push(
      [
        {
          id: "r1",
          mandate_id: "m1",
          criteria_version_id: "cv1",
          status: "completed",
          mode: "agent",
          priority: null,
          total_cost_cents: 1500,
          agent_summary:
            "Reviewed 8 companies, identified 3 high-confidence primary contacts.",
          started_at: "2026-05-11T18:00:00Z",
          finished_at: "2026-05-11T18:45:00Z",
          error_message: null,
          created_at: "2026-05-11T17:55:00Z",
        },
      ],
      [
        { status: "completed", n: 8 },
        { status: "failed", n: 0 },
      ],
      [{ service_type: "ai", cents: 1500 }],
    );

    const res = await getRunTool.handler({ runId: "r1" }, CTX);
    expect(res.isError).toBeFalsy();
    const text = res.content[0].text;
    expect(text).toContain("# Enrichment run r1");
    expect(text).toContain("Status**: completed");
    expect(text).toContain("Mode**: agent");
    expect(text).toContain("Total cost**: $15.00");
    expect(text).toContain("- completed: 8");
    expect(text).toContain("## Agent summary");
    expect(text).toContain("high-confidence primary contacts");
  });

  it("returns isError when run missing", async () => {
    smoke().bq.queryResponses.push([]);
    const res = await getRunTool.handler({ runId: "missing" }, CTX);
    expect(res.isError).toBe(true);
  });
});

describe("togari_enrichment_list_runs", () => {
  it("returns table filtered by status", async () => {
    smoke().bq.queryResponses.push([
      {
        id: "r1",
        mandate_id: "m1",
        status: "running",
        mode: "agent",
        total_cost_cents: 800,
        started_at: "2026-05-11T18:00:00Z",
        finished_at: null,
        created_at: "2026-05-11T17:55:00Z",
      },
      {
        id: "r2",
        mandate_id: "m2",
        status: "running",
        mode: "sequential",
        total_cost_cents: null,
        started_at: "2026-05-11T17:00:00Z",
        finished_at: null,
        created_at: "2026-05-11T16:55:00Z",
      },
    ]);
    const res = await listRunsTool.handler({ status: "running" }, CTX);
    expect(res.isError).toBeFalsy();
    const text = res.content[0].text;
    expect(text).toContain("2 runs");
    expect(text).toContain("| r1 | m1 | running | agent |");
    expect(text).toContain("| r2 | m2 | running | sequential |");
    expect(text).toContain("$8.00");

    const q = smoke().bq.queries[0];
    expect(q.params.status).toBe("running");
    expect(q.params.mandate_id).toBeUndefined();
  });
});
