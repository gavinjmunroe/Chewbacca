import { describe, it, expect, beforeEach } from "vitest";
import {
  queueBqRows,
  getMockState,
  onFetch,
} from "../../../../tests/smoke/helpers";
import { BigQueryClient } from "../../../bigquery/client";
import {
  buildClayPushTool,
  buildClayEnrichTool,
  buildClayListPushableTool,
} from "../clay-outbound";

const CTX = { tenantId: "bma", userId: "test-user" };
const WEBHOOK = "https://api.clay.com/v3/sources/webhook/tbl_test";

function makeBq() {
  return new BigQueryClient("test-project", null, null);
}

describe("togari_clay_push", () => {
  const tool = buildClayPushTool({ bq: makeBq() });

  beforeEach(() => {
    delete process.env.CLAY_API_KEY;
  });

  it("selects rows for the client and pushes them to the webhook", async () => {
    queueBqRows([
      {
        row_id: "r1",
        company_name: "Acme",
        website: "acme.com",
        domain: "acme.com",
        industry: "Software",
      },
      {
        row_id: "r2",
        company_name: "Globex",
        website: "globex.com",
        domain: "globex.com",
        industry: "Software",
      },
    ]);
    onFetch(WEBHOOK, { ok: true });

    const result = await tool.handler(
      { table_webhook_url: WEBHOOK, entity: "companies", limit: 50 },
      CTX,
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Selected: 2");
    expect(result.content[0].text).toContain("Pushed: 2");

    const q = getMockState().bq.queries.at(-1);
    expect(q.sql).toContain("togari_data_lake.companies");
    expect(q.sql).toContain("tag = @clientId");
    expect(q.params.clientId).toBe("bma");
    expect(getMockState().fetch.calls.length).toBe(2);
  });

  it("applies a simple column=value filter", async () => {
    queueBqRows([]);
    await tool.handler(
      {
        table_webhook_url: WEBHOOK,
        entity: "companies",
        where: "industry=Software",
      },
      CTX,
    );
    const q = getMockState().bq.queries.at(-1);
    expect(q.sql).toContain("industry = @whereValue");
    expect(q.params.whereValue).toBe("Software");
  });

  it("rejects a non-selectable filter column", async () => {
    const result = await tool.handler(
      { table_webhook_url: WEBHOOK, entity: "companies", where: "secret=1" },
      CTX,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not selectable");
  });

  it("reports when nothing matched", async () => {
    queueBqRows([]);
    const result = await tool.handler(
      { table_webhook_url: WEBHOOK, entity: "contacts" },
      CTX,
    );
    expect(result.content[0].text).toContain("No contacts rows matched");
    expect(getMockState().fetch.calls.length).toBe(0);
  });

  it("rejects invalid arguments", async () => {
    const result = await tool.handler(
      { table_webhook_url: "not-a-url", entity: "companies" },
      CTX,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid arguments");
  });
});

describe("togari_clay_enrich", () => {
  const tool = buildClayEnrichTool({ bq: makeBq() });

  it("fetches rows by id and pushes them for enrichment", async () => {
    queueBqRows([
      {
        row_id: "r1",
        full_name: "Ada",
        email: "ada@x.com",
        company: "Acme",
        title: "CTO",
        linkedin_url: "",
      },
    ]);
    onFetch(WEBHOOK, { ok: true });

    const result = await tool.handler(
      { table_webhook_url: WEBHOOK, entity: "contacts", ids: ["r1"] },
      CTX,
    );
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Matched: 1");
    expect(result.content[0].text).toContain("asynchronously");

    const q = getMockState().bq.queries.at(-1);
    expect(q.sql).toContain("row_id IN UNNEST(@ids)");
    expect(q.params.ids).toEqual(["r1"]);
    expect(getMockState().fetch.calls.length).toBe(1);
  });
});

describe("togari_clay_list_pushable", () => {
  const tool = buildClayListPushableTool({ bq: makeBq() });

  it("previews rows without pushing", async () => {
    queueBqRows([
      {
        row_id: "r1",
        company_name: "Acme",
        website: "acme.com",
        domain: "acme.com",
        industry: "Software",
      },
    ]);
    const result = await tool.handler({ entity: "companies" }, CTX);
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("Pushable companies");
    expect(result.content[0].text).toContain("Acme");
    // No outbound HTTP on a read-only preview.
    expect(getMockState().fetch.calls.length).toBe(0);
  });
});
