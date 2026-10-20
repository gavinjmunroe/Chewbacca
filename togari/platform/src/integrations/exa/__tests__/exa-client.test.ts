import { describe, it, expect, beforeEach, vi } from "vitest";
import { onFetch, getMockState } from "../../../../tests/smoke/helpers";

// Short-circuit the platform secrets manager so tests don't hit GCP and don't
// get bitten by the in-process 5-minute TTL cache between cases. Tests drive
// the lookup via env vars directly.
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
  exaSearch,
  exaFindSimilar,
  exaGetContents,
  exaAnswer,
  _resetExaApiKeyCacheForTests,
} from "../client";

describe("exa client", () => {
  beforeEach(() => {
    _resetExaApiKeyCacheForTests();
    process.env.EXA_API_KEY = "test-exa-key";
  });

  it("exaSearch posts to /search with the api key header and returns parsed results", async () => {
    onFetch("api.exa.ai/search", () => ({
      results: [
        {
          id: "r1",
          url: "https://acme.com",
          title: "Acme",
          publishedDate: "2024-01-01",
          score: 0.97,
          text: "Acme makes widgets.",
        },
      ],
      autopromptString: "Acme widget company",
      costDollars: { total: 0.005 },
    }));

    const out = await exaSearch({
      query: "widget manufacturers in midwest",
      numResults: 5,
      type: "neural",
      includeDomains: ["acme.com"],
    });

    expect(out.results).toHaveLength(1);
    expect(out.results[0]?.url).toBe("https://acme.com");
    expect(out.costDollars?.total).toBe(0.005);

    const call = getMockState().fetch.calls.find((c: any) =>
      c.url.endsWith("/search"),
    );
    expect(call).toBeTruthy();
    expect(call.init.method).toBe("POST");
    expect(call.init.headers["x-api-key"]).toBe("test-exa-key");
    const body = JSON.parse(call.init.body);
    expect(body.query).toBe("widget manufacturers in midwest");
    expect(body.numResults).toBe(5);
    expect(body.type).toBe("neural");
    expect(body.includeDomains).toEqual(["acme.com"]);
  });

  it("exaFindSimilar posts to /findSimilar with excludeSourceDomain", async () => {
    onFetch("api.exa.ai/findSimilar", () => ({
      results: [{ id: "r2", url: "https://similar.com", title: "Similar Co" }],
    }));

    const out = await exaFindSimilar({
      url: "https://acme.com",
      numResults: 3,
      excludeSourceDomain: true,
    });

    expect(out.results).toHaveLength(1);
    const call = getMockState().fetch.calls.find((c: any) =>
      c.url.endsWith("/findSimilar"),
    );
    const body = JSON.parse(call.init.body);
    expect(body.url).toBe("https://acme.com");
    expect(body.excludeSourceDomain).toBe(true);
  });

  it("exaGetContents requires ids and forwards text/highlights options", async () => {
    onFetch("api.exa.ai/contents", () => ({
      results: [
        { id: "r1", url: "https://acme.com", title: "Acme", text: "Body text" },
      ],
    }));

    const out = await exaGetContents({
      ids: ["r1"],
      text: { maxCharacters: 500 },
      highlights: true,
    });
    expect(out.results[0]?.text).toBe("Body text");

    await expect(exaGetContents({ ids: [] })).rejects.toThrow(
      /at least one id/,
    );
  });

  it("exaAnswer returns the synthesized answer + citations", async () => {
    onFetch("api.exa.ai/answer", () => ({
      answer: "Acme is a widget company.",
      citations: [
        { id: "r1", url: "https://acme.com/about", title: "About Acme" },
      ],
    }));

    const out = await exaAnswer({
      query: "What does Acme do?",
      text: false,
    });
    expect(out.answer).toContain("widget");
    expect(out.citations).toHaveLength(1);
  });

  it("throws a useful error when EXA_API_KEY is not configured", async () => {
    _resetExaApiKeyCacheForTests();
    delete process.env.EXA_API_KEY;
    await expect(exaSearch({ query: "anything" })).rejects.toThrow(
      /Exa is not configured/,
    );
  });

  it("surfaces upstream non-2xx as a thrown Error after retry", async () => {
    process.env.EXA_API_KEY = "test-exa-key";
    _resetExaApiKeyCacheForTests();
    onFetch("api.exa.ai/search", () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      headers: { get: () => null },
      json: async () => ({}),
      text: async () => "bad key",
    }));

    await expect(exaSearch({ query: "x" })).rejects.toThrow(
      /Exa search failed: 401/,
    );
  });
});
