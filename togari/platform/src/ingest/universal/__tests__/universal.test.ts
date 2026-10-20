/**
 * Smoke tests for universal ingestion: parsers, extractor, service, and the
 * togari_ingest_text MCP tool.
 *
 * BigQuery is auto-mocked by tests/smoke/setup.ts. Anthropic is stubbed via the
 * fetch handler registry (onFetch). We assert the raw is ALWAYS written, that a
 * contact entity routes to an INSERT, and that the tool reports the count.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  queueBqRows,
  getMockState,
  onFetch,
  anthropicText,
} from "../../../../tests/smoke/helpers";
import { parseCsv } from "../parsers";
import { normalizePayload } from "../parsers";
import { extractEntities } from "../extractor";
import { UniversalIngestService } from "../service";
import { buildIngestTextTool } from "../../../mcp/tools/ingest";
import { BigQueryClient } from "../../../bigquery/client";

const CTX = { tenantId: "bma", userId: "test-user" };

function smoke() {
  return getMockState();
}

function bq(): BigQueryClient {
  return new BigQueryClient("test-project", null, null);
}

beforeEach(() => {
  smoke().bq.queries.length = 0;
  smoke().bq.writes.length = 0;
  smoke().bq.queryResponses.length = 0;
  smoke().fetch.handlers.length = 0;
  process.env.ANTHROPIC_API_KEY = "test-key";
});

describe("parsers", () => {
  it("parses CSV into records keyed by header", () => {
    const records = parseCsv("name,email\nJoe,joe@acme.com\nAmy,amy@acme.com");
    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({ name: "Joe", email: "joe@acme.com" });
    expect(records[1].email).toBe("amy@acme.com");
  });

  it("normalizes JSON into records", () => {
    const parsed = normalizePayload({
      contentType: "json",
      rawJson: [{ a: 1 }, { a: 2 }],
    });
    expect(parsed.kind).toBe("records");
    expect(parsed.records).toHaveLength(2);
  });

  it("normalizes a JSON object into a single record", () => {
    const parsed = normalizePayload({
      contentType: "json",
      rawText: '{"a":1}',
    });
    expect(parsed.kind).toBe("records");
    expect(parsed.records).toHaveLength(1);
  });
});

describe("extractor", () => {
  it("returns extracted entities from the Anthropic stub", async () => {
    onFetch(
      "api.anthropic.com",
      anthropicText(
        JSON.stringify({
          entities: [
            { kind: "contact", full_name: "Joe", email: "joe@acme.com" },
          ],
          summary: "x",
        }),
      ),
    );
    const result = await extractEntities({ text: "Joe is joe@acme.com" });
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].kind).toBe("contact");
    expect(result.summary).toBe("x");
  });

  it("returns empty result when API key is missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await extractEntities({ text: "anything" });
    expect(result.entities).toHaveLength(0);
  });
});

describe("service.ingest", () => {
  it("ALWAYS writes the raw ingestion even when extraction is empty", async () => {
    onFetch(
      "api.anthropic.com",
      anthropicText(JSON.stringify({ entities: [], summary: "nothing" })),
    );
    const service = new UniversalIngestService({ bq: bq() });
    const result = await service.ingest({
      clientId: "bma",
      source: "test",
      contentType: "text",
      rawText: "just noise",
    });

    const writes = smoke().bq.writes;
    const rawInsert = writes.find((w: { sql: string }) =>
      /INSERT INTO .*raw_ingestions/i.test(w.sql),
    );
    expect(rawInsert).toBeDefined();
    expect(result.extracted).toBe(0);
  });

  it("routes a deal entity into an INSERT on togari_structured_deals", async () => {
    onFetch(
      "api.anthropic.com",
      anthropicText(
        JSON.stringify({
          entities: [
            {
              kind: "deal",
              company: "Acme Robotics",
              value: 10000,
              stage: "qualified",
            },
          ],
          summary: "a deal",
        }),
      ),
    );
    const service = new UniversalIngestService({ bq: bq() });
    const result = await service.ingest({
      clientId: "bma",
      source: "test",
      contentType: "text",
      rawText: "log this deal: Acme Robotics, $10k, qualified",
    });

    expect(result.routed.deals).toBe(1);
    const writes = smoke().bq.writes;
    const dealInsert = writes.find((w: { sql: string }) =>
      /INSERT INTO .*togari_structured_deals/i.test(w.sql),
    );
    expect(dealInsert).toBeDefined();
  });

  it("routes a contact entity into an INSERT on togari_structured_contacts", async () => {
    onFetch(
      "api.anthropic.com",
      anthropicText(
        JSON.stringify({
          entities: [
            { kind: "contact", full_name: "Joe", email: "joe@acme.com" },
          ],
          summary: "a contact",
        }),
      ),
    );
    const service = new UniversalIngestService({ bq: bq() });
    const result = await service.ingest({
      clientId: "bma",
      source: "test",
      contentType: "text",
      rawText: "Joe joe@acme.com",
    });

    expect(result.routed.contacts).toBe(1);
    const writes = smoke().bq.writes;
    const contactInsert = writes.find((w: { sql: string }) =>
      /INSERT INTO .*togari_structured_contacts/i.test(w.sql),
    );
    expect(contactInsert).toBeDefined();
  });
});

describe("togari_ingest_text tool", () => {
  it("returns the extracted count in markdown", async () => {
    onFetch(
      "api.anthropic.com",
      anthropicText(
        JSON.stringify({
          entities: [
            { kind: "contact", full_name: "Joe", email: "joe@acme.com" },
          ],
          summary: "a contact",
        }),
      ),
    );
    const tool = buildIngestTextTool({ bq: bq() });
    const res = await tool.handler({ text: "Joe joe@acme.com" }, CTX);
    expect(res.isError).toBeFalsy();
    const text = res.content[0].text;
    expect(text).toContain("Entities extracted: 1");
    expect(text).toContain("contacts: 1");
  });
});
