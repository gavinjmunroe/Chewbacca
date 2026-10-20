/**
 * V1Service — ingest dedup on (brand, source, source_ref) and single-row
 * context correction (moveContext). BigQuery is faked: tests script the
 * SELECT responses and assert on the SQL the service issues.
 */

import { describe, expect, it, vi } from "vitest";
import { V1Service } from "../service";
import type { BigQueryClient } from "../../bigquery/client";

interface Call {
  sql: string;
  params: Record<string, unknown>;
}

function fakeBq(queryResponses: Array<Record<string, unknown>[]>) {
  const queries: Call[] = [];
  const writes: Call[] = [];
  const deletes: Call[] = [];
  const bq = {
    executeQuery: vi.fn(async (sql: string, params = {}) => {
      queries.push({ sql, params });
      return { rows: queryResponses.shift() ?? [] };
    }),
    executeWrite: vi.fn(async (sql: string, params = {}) => {
      writes.push({ sql, params });
      return { rows: [] };
    }),
    executeDelete: vi.fn(async (sql: string, params = {}) => {
      deletes.push({ sql, params });
      return { rows: [] };
    }),
  };
  return { bq: bq as unknown as BigQueryClient, queries, writes, deletes };
}

describe("addContext dedup", () => {
  it("inserts when no row exists for (source, source_ref)", async () => {
    const { bq, writes } = fakeBq([[]]);
    const svc = new V1Service({ bq });
    const res = await svc.addContext({
      content: "hello",
      source: "fireflies",
      sourceRef: "01KY8GCBJE8K76EM31CRBRS74Y",
    });
    expect(res.operation).toBe("created");
    expect(writes).toHaveLength(1);
    expect(writes[0].sql).toContain("INSERT INTO");
  });

  it("updates in place when the same (source, source_ref) was already ingested", async () => {
    const { bq, writes } = fakeBq([
      [{ context_id: "ctx_existing", client_id: "freedom_c5624c" }],
    ]);
    const svc = new V1Service({ bq });
    const res = await svc.addContext({
      clientId: "some_other_client",
      content: "updated overview",
      source: "fireflies",
      sourceRef: "01KY8GCBJE8K76EM31CRBRS74Y",
    });
    expect(res).toEqual({ contextId: "ctx_existing", operation: "updated" });
    expect(writes).toHaveLength(1);
    expect(writes[0].sql).toContain("UPDATE");
    // The existing attachment is preserved — a refresh never reassigns
    // (or duplicates) a row that was already filed or manually moved.
    expect(writes[0].sql).not.toContain("client_id =");
    expect(writes[0].params.context_id).toBe("ctx_existing");
  });

  it("always inserts when there is no source_ref to dedupe on", async () => {
    const { bq, writes, queries } = fakeBq([]);
    const svc = new V1Service({ bq });
    const res = await svc.addContext({ content: "a note", source: "ask" });
    expect(res.operation).toBe("created");
    expect(queries).toHaveLength(0);
    expect(writes[0].sql).toContain("INSERT INTO");
  });
});

describe("existingContextRefs", () => {
  it("returns the set of already-ingested source refs", async () => {
    const { bq, queries } = fakeBq([[{ source_ref: "m1" }]]);
    const svc = new V1Service({ bq });
    const set = await svc.existingContextRefs(["m1", "e1", "m1"]);
    expect(set.has("m1")).toBe(true);
    expect(set.has("e1")).toBe(false);
    expect(queries).toHaveLength(1);
  });

  it("issues no query for an empty ref list", async () => {
    const { bq, queries } = fakeBq([]);
    const svc = new V1Service({ bq });
    const set = await svc.existingContextRefs([]);
    expect(set.size).toBe(0);
    expect(queries).toHaveLength(0);
  });
});

describe("moveContext", () => {
  it("reattaches a row to an existing client", async () => {
    const { bq, writes } = fakeBq([
      [{ context_id: "ctx_1", client_id: "spinach_records_425af0" }],
      [{ client_id: "blue_modern_advisory_c5d8f0" }],
    ]);
    const svc = new V1Service({ bq });
    const res = await svc.moveContext("ctx_1", "blue_modern_advisory_c5d8f0");
    expect(res).toEqual({
      moved: true,
      previousClientId: "spinach_records_425af0",
    });
    expect(writes).toHaveLength(1);
    expect(writes[0].sql).toContain("SET client_id = @newClientId");
    expect(writes[0].params.newClientId).toBe("blue_modern_advisory_c5d8f0");
  });

  it("detaches a row when the target is null", async () => {
    const { bq, writes } = fakeBq([
      [{ context_id: "ctx_1", client_id: "spinach_records_425af0" }],
    ]);
    const svc = new V1Service({ bq });
    const res = await svc.moveContext("ctx_1", null);
    expect(res.moved).toBe(true);
    expect(writes[0].params.newClientId).toBeNull();
  });

  it("refuses to move to a client that does not exist", async () => {
    const { bq, writes } = fakeBq([
      [{ context_id: "ctx_1", client_id: null }],
      [],
    ]);
    const svc = new V1Service({ bq });
    const res = await svc.moveContext("ctx_1", "nope");
    expect(res).toEqual({ moved: false, reason: "target client not found" });
    expect(writes).toHaveLength(0);
  });

  it("reports a missing context row honestly", async () => {
    const { bq, writes } = fakeBq([[]]);
    const svc = new V1Service({ bq });
    const res = await svc.moveContext("ctx_missing", null);
    expect(res).toEqual({ moved: false, reason: "context not found" });
    expect(writes).toHaveLength(0);
  });
});
