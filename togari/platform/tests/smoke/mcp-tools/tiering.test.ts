/**
 * Smoke tests for togari.tiering.* MCP tool modules.
 *
 * The Pub/Sub scheduler is stubbed via __setStartRunImpl so we don't have to
 * mock @google-cloud/pubsub for the run-management tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  startRunTool,
  getRunTool,
  listRunsTool,
  __resetTieringBigQueryClient,
  __setStartRunImpl,
} from "../../../src/mcp/tools/tiering";

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
  __resetTieringBigQueryClient();
  smoke().bq.queries.length = 0;
  smoke().bq.writes.length = 0;
  smoke().bq.queryResponses.length = 0;
  lastSchedulerCall = null;
  __setStartRunImpl(async (kind, tenantId, runId, mode) => {
    lastSchedulerCall = { kind, tenantId, runId, mode: mode ?? "sequential" };
    return 5; // pretend scheduler published 5 messages
  });
});

afterEach(() => {
  __setStartRunImpl(null);
});

describe("togari_tiering_start_run", () => {
  it("validates mandate, inserts run + seeded companies, calls scheduler", async () => {
    // Smoke harness DML mock reports numDmlAffectedRows='1' for every write.
    smoke().bq.queryResponses.push([
      { active_criteria_version_id: "cv-active" },
    ]);

    const res = await startRunTool.handler({ mandateId: "m1" }, CTX);
    expect(res.isError).toBeFalsy();
    const text = res.content[0].text;
    expect(text).toContain("Tiering run started.");
    expect(text).toContain("Mandate**: m1");
    expect(text).toContain("Criteria version**: cv-active");

    // Writes: INSERT run, INSERT...SELECT companies.
    const writes = smoke().bq.writes;
    expect(writes).toHaveLength(2);
    expect(writes[0].sql).toMatch(/INSERT INTO .*tiering_runs/i);
    expect(writes[1].sql).toMatch(/INSERT INTO .*tiering_run_companies/i);
    expect(writes[1].sql).not.toMatch(/NOT EXISTS/);

    const runId = writes[0].params.id as string;
    expect(writes[1].params.run_id).toBe(runId);
    expect(writes[0].params.criteria_id).toBe("cv-active");
    expect(writes[0].params.mode).toBe("sequential");

    expect(lastSchedulerCall).toEqual({
      kind: "tiering",
      tenantId: "48north",
      runId,
      mode: "sequential",
    });
  });

  it("uses caller-supplied criteriaVersionId over mandate's active one", async () => {
    smoke().bq.queryResponses.push([
      { active_criteria_version_id: "cv-active" },
    ]);
    const res = await startRunTool.handler(
      { mandateId: "m1", criteriaVersionId: "cv-explicit", mode: "agent" },
      CTX,
    );
    expect(res.isError).toBeFalsy();
    const writes = smoke().bq.writes;
    expect(writes[0].params.criteria_id).toBe("cv-explicit");
    expect(writes[0].params.mode).toBe("agent");
    expect(lastSchedulerCall?.mode).toBe("agent");
  });

  it("adds NOT EXISTS clause when scope='unprocessed'", async () => {
    smoke().bq.queryResponses.push([
      { active_criteria_version_id: "cv-active" },
    ]);
    await startRunTool.handler({ mandateId: "m1", scope: "unprocessed" }, CTX);
    const seedInsert = smoke().bq.writes[1];
    expect(seedInsert.sql).toMatch(/NOT EXISTS/);
    expect(seedInsert.sql).toMatch(/tiers/);
  });

  it("returns error when mandate not found", async () => {
    smoke().bq.queryResponses.push([]); // mandate lookup empty
    const res = await startRunTool.handler({ mandateId: "missing" }, CTX);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/not found/);
    expect(smoke().bq.writes).toHaveLength(0);
    expect(lastSchedulerCall).toBeNull();
  });

  it("rejects invalid scope", async () => {
    const res = await startRunTool.handler(
      { mandateId: "m1", scope: "weird" as any },
      CTX,
    );
    expect(res.isError).toBe(true);
  });

  it("marks run failed if scheduler throws", async () => {
    smoke().bq.queryResponses.push([
      { active_criteria_version_id: "cv-active" },
    ]);
    __setStartRunImpl(async () => {
      throw new Error("pubsub blew up");
    });
    const res = await startRunTool.handler({ mandateId: "m1" }, CTX);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/pubsub blew up/);
    // Final write should mark the run failed.
    const writes = smoke().bq.writes;
    const lastWrite = writes[writes.length - 1];
    expect(lastWrite.sql).toMatch(/UPDATE .*tiering_runs/i);
    expect(lastWrite.sql).toMatch(/status = 'failed'/);
  });
});

describe("togari_tiering_get_run", () => {
  it("renders run + status counts + tier distribution + cost", async () => {
    // Queue four query responses in order:
    //   1. run lookup
    //   2. company status counts
    //   3. tier distribution
    //   4. cost by service
    smoke().bq.queryResponses.push(
      [
        {
          id: "r1",
          mandate_id: "m1",
          criteria_version_id: "cv1",
          status: "running",
          mode: "sequential",
          priority: 50,
          total_cost_cents: 4275,
          started_at: new Date(Date.now() - 60_000).toISOString(),
          finished_at: null,
          error_message: null,
          created_at: "2026-05-11T19:00:00Z",
        },
      ],
      [
        { status: "completed", n: 10 },
        { status: "pending", n: 4 },
        { status: "running", n: 1 },
      ],
      [
        { tier: 1, n: 2 },
        { tier: 2, n: 5 },
        { tier: 3, n: 3 },
      ],
      [
        { service_type: "ai", cents: 4000 },
        { service_type: "exa", cents: 275 },
      ],
    );

    const res = await getRunTool.handler({ runId: "r1" }, CTX);
    expect(res.isError).toBeFalsy();
    const text = res.content[0].text;
    expect(text).toContain("# Tiering run r1");
    expect(text).toContain("Status**: running");
    expect(text).toContain("Total cost**: $42.75");
    expect(text).toContain("Tier 1: 2");
    expect(text).toContain("Tier 2: 5");
    expect(text).toContain("- pending: 4");
    expect(text).toContain("- running: 1");
    expect(text).toContain("- completed: 10");
    expect(text).toMatch(/ai: \$40\.00/);
    expect(text).toMatch(/exa: \$2\.75/);
    expect(text).toMatch(/\*\*ETA\*\*: \d+s|\*\*ETA\*\*: \d+m/);
  });

  it("returns isError when run missing", async () => {
    smoke().bq.queryResponses.push([]);
    const res = await getRunTool.handler({ runId: "missing" }, CTX);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/not found/);
  });
});

describe("togari_tiering_list_runs", () => {
  it("returns table filtered by mandate + status", async () => {
    smoke().bq.queryResponses.push([
      {
        id: "r1",
        mandate_id: "m1",
        status: "completed",
        mode: "sequential",
        total_cost_cents: 1234,
        started_at: "2026-05-10T10:00:00Z",
        finished_at: "2026-05-10T11:00:00Z",
        created_at: "2026-05-10T09:00:00Z",
      },
    ]);
    const res = await listRunsTool.handler(
      { mandateId: "m1", status: "completed" },
      CTX,
    );
    expect(res.isError).toBeFalsy();
    const text = res.content[0].text;
    expect(text).toContain("1 run");
    expect(text).toContain("| r1 | m1 | completed |");
    expect(text).toContain("$12.34");

    const q = smoke().bq.queries[0];
    expect(q.params.tenant_id).toBe("48north");
    expect(q.params.mandate_id).toBe("m1");
    expect(q.params.status).toBe("completed");
  });

  it("returns empty message when no rows", async () => {
    smoke().bq.queryResponses.push([]);
    const res = await listRunsTool.handler({}, CTX);
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toMatch(/No tiering runs found/);
  });
});
