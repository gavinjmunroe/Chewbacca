import { describe, it, expect } from "vitest";
import { queueBqRows, getMockState } from "../../../../tests/smoke/helpers";
import { BigQueryClient } from "../../../bigquery/client";
import {
  buildAdminGetPricingConfigTool,
  buildAdminGetMaxStepsTool,
} from "../admin";

const CTX = { tenantId: "test_tenant", userId: "test-user" };
function makeBq() {
  return new BigQueryClient("test-project", null, null);
}

describe("togari_admin_get_pricing_config", () => {
  const tool = buildAdminGetPricingConfigTool({ bq: makeBq() });

  it("renders both AI and external pricing sections", async () => {
    queueBqRows([
      {
        value: {
          ai: {
            "gpt-5.4": { input_per_1m: 250, output_per_1m: 1500 },
            "gpt-5-mini": {
              input_per_1m: 25,
              output_per_1m: 200,
              web_search_per_call: 1,
            },
          },
          external: { exa_search: 0, perplexity_research: 5 },
        },
        updated_at: { value: "2026-05-11T10:00:00Z" },
      },
    ]);

    const result = await tool.handler({}, CTX);
    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain("gpt-5.4");
    expect(text).toContain("gpt-5-mini");
    expect(text).toContain("web_search=1¢/call");
    expect(text).toContain("perplexity_research");
    expect(text).toContain("```json");

    const last = getMockState().bq.queries.at(-1);
    expect(last.params.tenantId).toBe("test_tenant");
    expect(last.sql).toContain("key = 'pricing_config'");
  });

  it("parses a string JSON value", async () => {
    queueBqRows([
      {
        value: JSON.stringify({
          ai: { "gpt-4o-mini": { input_per_1m: 15, output_per_1m: 60 } },
          external: {},
        }),
        updated_at: { value: "2026-05-11T10:00:00Z" },
      },
    ]);
    const result = await tool.handler({}, CTX);
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("gpt-4o-mini");
  });

  it("errors when no row is present for this tenant", async () => {
    queueBqRows([]);
    const result = await tool.handler({}, CTX);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No pricing_config row found");
  });
});

describe("togari_admin_get_max_steps", () => {
  const tool = buildAdminGetMaxStepsTool({ bq: makeBq() });

  it("renders the agentic_max_steps value", async () => {
    queueBqRows([{ value: 15, updated_at: { value: "2026-05-11T10:00:00Z" } }]);
    const result = await tool.handler({}, CTX);
    expect(result.isError).toBeFalsy();
    const text = result.content[0].text;
    expect(text).toContain("agentic_max_steps");
    expect(text).toContain("15");

    const last = getMockState().bq.queries.at(-1);
    expect(last.params.tenantId).toBe("test_tenant");
    expect(last.sql).toContain("key = 'agentic_max_steps'");
  });

  it("handles a JSON-string-encoded number", async () => {
    queueBqRows([
      { value: "20", updated_at: { value: "2026-05-11T10:00:00Z" } },
    ]);
    const result = await tool.handler({}, CTX);
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain("20");
  });

  it("errors when no row is present", async () => {
    queueBqRows([]);
    const result = await tool.handler({}, CTX);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("No agentic_max_steps row found");
  });
});
