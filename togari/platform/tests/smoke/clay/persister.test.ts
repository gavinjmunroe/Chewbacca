/**
 * Persister integration test using the smoke harness's mocked BigQuery.
 *
 * The mock at tests/smoke/setup.ts intercepts createQueryJob and records
 * every SELECT/INSERT/UPDATE. We queue per-query response rows via
 * `globalThis.__smoke.bq.queryResponses` and assert against captured writes.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { persistClayPayload } from "../../../src/ingest/clay/persister";
import { ClayWebhookPayloadSchema } from "../../../src/ingest/clay/schema";
import { BigQueryClient } from "../../../src/bigquery/client";

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

const PAYLOAD = ClayWebhookPayloadSchema.parse({
  clay_run_id: "run_abc",
  mandate_id: "mandate_42",
  tenant_id: "48north",
  completed_at: "2026-05-11T20:00:00Z",
  rows: [
    {
      company: {
        name: "Acme Industrial",
        website: "https://acme.com",
      },
      contacts: [
        { full_name: "Jane Owner", email: "jane@acme.com", title: "CEO" },
        { full_name: "Bob VP", email: "bob@acme.com", title: "COO" },
      ],
    },
    {
      company: { name: "Beta Holdings", website: "https://beta.io" },
      contacts: [{ full_name: "Cara CEO", email: "cara@beta.io" }],
    },
  ],
});

function makeBq() {
  return new BigQueryClient("test-project", null, null);
}

function fixedUuid(): () => string {
  let n = 0;
  return () => `uuid-${++n}`;
}

beforeEach(() => {
  // smoke setup already clears between tests, but explicit is safe
  smoke().bq.queries.length = 0;
  smoke().bq.writes.length = 0;
  smoke().bq.queryResponses.length = 0;
});

describe("persistClayPayload", () => {
  it("inserts audit row, upserts companies, links mandate_companies, and inserts contacts", async () => {
    // Response queue order matches query order in persister:
    //   1. idempotency lookup (clay_imports) → empty
    //   2. row 0 company lookup (companies) → empty
    //   3. row 0 mandate_companies lookup → empty
    //   4. row 0 contact[0] email dedupe (contacts) → empty
    //   5. row 0 contact[1] email dedupe (contacts) → empty
    //   6. row 1 company lookup → empty
    //   7. row 1 mandate_companies lookup → empty
    //   8. row 1 contact[0] email dedupe → empty
    smoke().bq.queryResponses.push([], [], [], [], [], [], [], []);

    const result = await persistClayPayload(PAYLOAD, {
      bq: makeBq(),
      uuid: fixedUuid(),
    });

    expect(result.status).toBe("completed");
    expect(result.companyCount).toBe(2);
    expect(result.contactCount).toBe(3);
    expect(result.payloadHash).toMatch(/^[0-9a-f]{64}$/);

    const writes = smoke().bq.writes.map((w) => w.sql.trim());
    // 1 pending clay_imports insert + 2 company inserts + 2 mandate_companies inserts +
    // 3 contact inserts + 1 final clay_imports UPDATE = 9
    expect(writes.length).toBe(9);

    expect(writes[0]).toMatch(/INSERT INTO .*\.clay_imports\b/);
    expect(writes[0]).toMatch(/'pending'/);

    const companyInserts = writes.filter((s) =>
      /INSERT INTO .*\.companies\b/.test(s),
    );
    expect(companyInserts.length).toBe(2);

    const mandateInserts = writes.filter((s) =>
      /INSERT INTO .*\.mandate_companies\b/.test(s),
    );
    expect(mandateInserts.length).toBe(2);

    const contactInserts = writes.filter((s) =>
      /INSERT INTO .*\.contacts\b/.test(s),
    );
    expect(contactInserts.length).toBe(3);

    const finalUpdate = writes[writes.length - 1];
    expect(finalUpdate).toMatch(/UPDATE .*\.clay_imports/);
    expect(finalUpdate).toMatch(/status = 'completed'/);
    expect(
      smoke().bq.writes[smoke().bq.writes.length - 1].params,
    ).toMatchObject({
      companyCount: 2,
      contactCount: 3,
    });
  });

  it("short-circuits as duplicate when the same payload was already completed", async () => {
    const prior = {
      id: "existing-import-id",
      status: "completed",
      payload_hash: (
        await import("../../../src/ingest/clay/parser")
      ).hashPayload(PAYLOAD),
      company_count: 2,
      contact_count: 3,
    };
    smoke().bq.queryResponses.push([prior]);

    const result = await persistClayPayload(PAYLOAD, {
      bq: makeBq(),
      uuid: fixedUuid(),
    });

    expect(result.status).toBe("duplicate");
    expect(result.importId).toBe("existing-import-id");
    expect(result.companyCount).toBe(2);
    expect(result.contactCount).toBe(3);
    // No writes happened — we exited before the pending INSERT.
    expect(smoke().bq.writes.length).toBe(0);
  });

  it("reuses an existing company when the dedupe key matches", async () => {
    // The smoke harness's createQueryJob shifts queryResponses for every
    // SQL call (reads AND writes), so we pad write slots with [].
    //   1 idempotency SELECT (clay_imports)
    //   2 INSERT pending clay_imports
    //   3 SELECT row 0 companies   ← inject existing
    //   4 UPDATE companies (existing path)
    //   5 SELECT row 0 mandate_companies
    //   ... rest defaults to []
    smoke().bq.queryResponses.push(
      [], // 1
      [], // 2
      [{ id: "company-existing" }], // 3
    );

    const result = await persistClayPayload(PAYLOAD, {
      bq: makeBq(),
      uuid: fixedUuid(),
    });
    expect(result.status).toBe("completed");
    expect(result.companyCount).toBe(2);

    const writes = smoke().bq.writes.map((w) => w.sql);
    // Exactly one row 0 company UPDATE (no INSERT) plus one row 1 company INSERT.
    expect(writes.filter((s) => /UPDATE .*\.companies/.test(s)).length).toBe(1);
    expect(
      writes.filter((s) => /INSERT INTO .*\.companies/.test(s)).length,
    ).toBe(1);
  });

  it("skips duplicate contacts within a company (email already on file)", async () => {
    // Sequence (S=SELECT, W=write; queueResponses pops on every call):
    //   1 S idempotency
    //   2 W INSERT pending clay_imports
    //   3 S row 0 companies → empty
    //   4 W INSERT row 0 companies
    //   5 S row 0 mandate_companies → empty
    //   6 W INSERT row 0 mandate_companies
    //   7 S row 0 contact[0] (Jane) email → HIT
    smoke().bq.queryResponses.push(
      [], // 1
      [], // 2
      [], // 3
      [], // 4
      [], // 5
      [], // 6
      [{ id: "contact-existing" }], // 7
    );

    const result = await persistClayPayload(PAYLOAD, {
      bq: makeBq(),
      uuid: fixedUuid(),
    });
    expect(result.status).toBe("completed");
    expect(result.contactCount).toBe(2); // Jane skipped, Bob + Cara inserted
  });

  it("marks the import row failed when downstream persistence throws", async () => {
    // Idempotency lookup → empty, so we proceed to the pending INSERT.
    // Then the row 0 company SELECT will pop nothing and the INSERT runs;
    // we make the second company SELECT throw by exhausting the queue.
    smoke().bq.queryResponses.push([], []);
    // After the queue is empty, the mock returns []. To force a failure we
    // override the BQ client to throw on its second write.
    const bq = makeBq();
    const original = bq.executeWrite.bind(bq);
    let writes = 0;
    bq.executeWrite = (sql: string, params: Record<string, unknown> = {}) => {
      writes += 1;
      // Allow: the pending INSERT clay_imports (writes=1).
      // Throw on: the first company INSERT (writes=2).
      if (writes === 2) {
        return Promise.reject(new Error("simulated BQ failure"));
      }
      return original(sql, params);
    };

    await expect(
      persistClayPayload(PAYLOAD, { bq, uuid: fixedUuid() }),
    ).rejects.toThrow(/simulated BQ failure/);

    const writeSqls = smoke().bq.writes.map((w) => w.sql);
    // Pending INSERT + the failure-marker UPDATE were issued.
    const failureUpdate = writeSqls.find(
      (s) => /UPDATE .*\.clay_imports/.test(s) && /'failed'/.test(s),
    );
    expect(failureUpdate).toBeDefined();
  });
});
