/**
 * Smoke tests for the AI enrichment feature.
 *
 * BigQuery is auto-mocked by tests/smoke/setup.ts (SELECT/WITH -> queries,
 * INSERT/UPDATE/MERGE -> writes; queryResponses is a FIFO queue that returns
 * [] when empty). The Anthropic call is stubbed via onFetch so no network
 * happens. We assert:
 *   - enrich() writes exactly one field (a MERGE into custom_field_values)
 *     and returns written:1.
 *   - structure() returns the field(s) but writes NOTHING (no MERGE into
 *     custom_field_values).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { BigQueryClient } from "../../bigquery/client";
import { EnrichService } from "../service";
import {
  queueBqRows,
  getMockState,
  onFetch,
  anthropicText,
} from "../../../tests/smoke/helpers";

function makeService(): EnrichService {
  const bq = new BigQueryClient("test-project", null, null);
  return new EnrichService({ bq });
}

function stubAnthropic(payload: unknown): void {
  onFetch("api.anthropic.com", anthropicText(JSON.stringify(payload)));
}

function mergesIntoCustomValues(): Array<{ sql: string }> {
  return getMockState().bq.writes.filter(
    (w: { sql: string }) =>
      /MERGE/i.test(w.sql) && /custom_field_values/i.test(w.sql),
  );
}

describe("EnrichService.enrich", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  it("writes one structured field back onto the record", async () => {
    stubAnthropic({
      fields: [
        {
          name: "industry",
          value: "Fintech",
          type: "string",
          confidence: 0.9,
          source: "web",
        },
      ],
      summary: "x",
    });

    // loadEntityContext SELECT (company row), then setValue's resolveField
    // lookups (treated as a new field -> INSERT def + MERGE value).
    queueBqRows([{ company_id: "acme", name: "Acme" }]);
    queueBqRows([]); // resolveField in setValue -> not found
    queueBqRows([]); // resolveField inside defineField -> not found

    const service = makeService();
    const result = await service.enrich({
      clientId: "bma",
      entity: "company",
      entityId: "acme",
      prompt: "find the industry",
      useWeb: false,
    });

    expect(result.written).toBe(1);
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0].name).toBe("industry");
    expect(result.entity).toBe("company");

    const merges = mergesIntoCustomValues();
    expect(merges.length).toBe(1);
  });
});

describe("EnrichService.structure", () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  it("returns fields but writes nothing", async () => {
    stubAnthropic({
      fields: [{ name: "title", value: "VP Sales", type: "string" }],
      summary: "parsed signature",
    });

    const service = makeService();
    const result = await service.structure({
      prompt: "pull the title",
      text: "Jane Doe, VP Sales, Acme",
    });

    expect(result.fields).toHaveLength(1);
    expect(result.fields[0].name).toBe("title");
    expect(result.written).toBe(0);

    const merges = mergesIntoCustomValues();
    expect(merges.length).toBe(0);
  });
});
