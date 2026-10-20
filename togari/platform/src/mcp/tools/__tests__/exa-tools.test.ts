import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../secrets/manager", () => ({
  getOptionalSecret: async (name: string) =>
    process.env[name.replace(/-/g, "_").toUpperCase()] || undefined,
  getSecret: async (name: string) => {
    const v = process.env[name.replace(/-/g, "_").toUpperCase()];
    if (!v) throw new Error(`Secret "${name}" not found`);
    return v;
  },
}));
import {
  exaSearchTool,
  exaFindSimilarTool,
  exaGetContentsTool,
  exaAnswerTool,
  TOGARI_EXA_TOOLS,
  register,
} from "../exa";
import { _resetExaApiKeyCacheForTests } from "../../../integrations/exa/client";
import { onFetch } from "../../../../tests/smoke/helpers";

const CTX = { tenantId: "test_tenant", userId: "test-user" };

beforeEach(() => {
  _resetExaApiKeyCacheForTests();
  process.env.EXA_API_KEY = "test-exa-key";
});

describe("exa MCP tools", () => {
  it("registers all four tools under the togari.exa.* namespace", () => {
    expect(TOGARI_EXA_TOOLS.map((t) => t.name)).toEqual([
      "togari_exa_search",
      "togari_exa_find_similar",
      "togari_exa_get_contents",
      "togari_exa_answer",
    ]);
    expect(typeof register).toBe("function");
  });

  it("togari_exa_search renders a markdown summary of the results", async () => {
    onFetch("api.exa.ai/search", () => ({
      results: [
        {
          id: "r1",
          url: "https://acme.com",
          title: "Acme",
          publishedDate: "2024-01-01",
          score: 0.91,
          text: "Acme makes widgets.",
        },
        {
          id: "r2",
          url: "https://acme.com/about",
          title: "About Acme",
          score: 0.85,
        },
      ],
      costDollars: { total: 0.004 },
    }));

    const out = await exaSearchTool.handler({ query: "acme" }, CTX);
    const text = out.content[0]!.text;
    expect(text).toContain("Exa search · 2 results");
    expect(text).toContain("Acme");
    expect(text).toContain("URL: https://acme.com");
    expect(text).toContain("(Exa cost: $0.0040)");
  });

  it("togari_exa_find_similar returns a friendly message when no results", async () => {
    onFetch("api.exa.ai/findSimilar", () => ({ results: [] }));
    const out = await exaFindSimilarTool.handler(
      { url: "https://acme.com" },
      CTX,
    );
    expect(out.content[0]!.text).toContain("No similar results");
  });

  it("togari_exa_get_contents includes text + summary blocks per id", async () => {
    onFetch("api.exa.ai/contents", () => ({
      results: [
        {
          id: "r1",
          url: "https://acme.com",
          title: "Acme",
          text: "Acme is a widget company.",
          summary: "Widget maker in Chicago.",
        },
      ],
    }));
    const out = await exaGetContentsTool.handler(
      { ids: ["r1"], text: true, summary: true },
      CTX,
    );
    const text = out.content[0]!.text;
    expect(text).toContain("Exa contents · 1 of 1 ids");
    expect(text).toContain("Summary: Widget maker in Chicago.");
    expect(text).toContain("Text:");
  });

  it("togari_exa_answer renders answer + citations", async () => {
    onFetch("api.exa.ai/answer", () => ({
      answer: "Acme is based in Chicago.",
      citations: [
        { id: "r1", url: "https://acme.com/about", title: "About Acme" },
      ],
    }));
    const out = await exaAnswerTool.handler({ query: "Where is Acme?" }, CTX);
    const text = out.content[0]!.text;
    expect(text).toContain("Exa answer for: Where is Acme?");
    expect(text).toContain("Acme is based in Chicago.");
    expect(text).toContain("Citations (1)");
    expect(text).toContain("About Acme");
  });
});
