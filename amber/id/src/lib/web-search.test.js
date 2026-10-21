/**
 * web-search: the Exa-backed replacement for perplexity-search.
 *
 * The contract under test is the one people-rank-signals and enrich-person
 * silently depend on: `{results, id}` with `url`, `title` and `date` on every
 * row. The `publishedDate -> date` rename is the whole reason this module is not
 * just a re-export -- get it wrong and every source looks undated, the recency
 * signal is permanently zero, and nothing anywhere throws.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { search, searchAvailable, SEARCH_MAX_QUERIES } from "./web-search.js";

/** An Exa-shaped result row. */
const row = (url, extra = {}) => ({
  title: `Title for ${url}`,
  url,
  text: "body text",
  highlights: [],
  publishedDate: "2026-08-01T00:00:00Z",
  author: null,
  ...extra,
});

/** A fetch that returns the given rows for every query, recording each call. */
function fakeExa(rowsByQuery, calls = []) {
  return async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body.query);
    const rows = rowsByQuery[body.query] ?? [];
    return { ok: true, json: async () => ({ results: rows }) };
  };
}

test("no key -> null, and nothing is requested", async () => {
  let called = false;
  const out = await search({
    query: "anything",
    apiKey: "",
    fetchImpl: async () => {
      called = true;
      return { ok: true, json: async () => ({ results: [] }) };
    },
  });
  assert.equal(out, null);
  assert.equal(called, false);
});

test("empty / unusable query -> null", async () => {
  for (const q of ["", "   ", [], [""], null, 42]) {
    const out = await search({ query: q, apiKey: "k", fetchImpl: async () => ({ ok: true, json: async () => ({ results: [] }) }) });
    assert.equal(out, null, `expected null for ${JSON.stringify(q)}`);
  }
});

test("single query: normalizes publishedDate -> date", async () => {
  const out = await search({
    query: "priya nair acme",
    apiKey: "k",
    fetchImpl: fakeExa({ "priya nair acme": [row("https://a.com/1")] }),
  });
  assert.equal(out.results.length, 1);
  const r = out.results[0];
  // THE RENAME. people-rank-signals reads r.date; Exa ships publishedDate.
  assert.equal(r.date, "2026-08-01T00:00:00Z");
  assert.equal(r.url, "https://a.com/1");
  assert.equal(r.title, "Title for https://a.com/1");
});

test("a missing publishedDate becomes null, not undefined", async () => {
  const out = await search({
    query: "q",
    apiKey: "k",
    fetchImpl: fakeExa({ q: [row("https://a.com/1", { publishedDate: undefined })] }),
  });
  assert.equal(out.results[0].date, null);
});

test("rows with no url are dropped", async () => {
  const out = await search({
    query: "q",
    apiKey: "k",
    fetchImpl: fakeExa({ q: [row("https://a.com/1"), { title: "no url" }, null] }),
  });
  assert.equal(out.results.length, 1);
});

test("multi-query fans out one request per query and dedupes by url", async () => {
  const calls = [];
  const out = await search({
    query: ["q1", "q2"],
    apiKey: "k",
    fetchImpl: fakeExa(
      {
        q1: [row("https://dup.com"), row("https://only1.com")],
        q2: [row("https://dup.com"), row("https://only2.com")],
      },
      calls,
    ),
  });
  // Exa takes one query per request, unlike Perplexity's single multi-query call.
  assert.deepEqual(calls, ["q1", "q2"]);
  const urls = out.results.map((r) => r.url);
  assert.deepEqual(urls, ["https://dup.com", "https://only1.com", "https://only2.com"]);
});

test("the first query's hit for a duplicate url wins", async () => {
  // buildQueryVariants orders variants most- to least-specific, so first wins
  // means the most specific query's version of a page is the one kept.
  const out = await search({
    query: ["specific", "broad"],
    apiKey: "k",
    fetchImpl: fakeExa({
      specific: [row("https://x.com", { title: "SPECIFIC" })],
      broad: [row("https://x.com", { title: "BROAD" })],
    }),
  });
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].title, "SPECIFIC");
});

test("query fan-out is capped", async () => {
  const calls = [];
  await search({
    query: Array.from({ length: 25 }, (_, i) => `q${i}`),
    apiKey: "k",
    fetchImpl: fakeExa({}, calls),
  });
  assert.equal(calls.length, SEARCH_MAX_QUERIES);
  assert.ok(SEARCH_MAX_QUERIES <= 10);
});

test("a partial failure still returns the queries that worked", async () => {
  const out = await search({
    query: ["good", "bad"],
    apiKey: "k",
    fetchImpl: async (_u, init) => {
      const body = JSON.parse(init.body);
      if (body.query === "bad") return { ok: false, status: 500, text: async () => "boom" };
      return { ok: true, json: async () => ({ results: [row("https://good.com")] }) };
    },
  });
  assert.equal(out.results.length, 1);
  assert.equal(out.results[0].url, "https://good.com");
});

test("a well-formed empty result set is an empty array, not null", async () => {
  // Callers distinguish "the web had nothing" from "the call failed".
  const out = await search({
    query: "q",
    apiKey: "k",
    fetchImpl: fakeExa({ q: [] }),
  });
  assert.ok(out);
  assert.deepEqual(out.results, []);
});

test("highlights are preferred over body text for the snippet", async () => {
  const out = await search({
    query: "q",
    apiKey: "k",
    fetchImpl: fakeExa({
      q: [row("https://a.com", { highlights: ["the relevant sentence"] })],
    }),
  });
  assert.equal(out.results[0].snippet, "the relevant sentence");
});

test("searchAvailable reflects only the key", () => {
  assert.equal(searchAvailable("k"), true);
  assert.equal(searchAvailable(""), false);
  assert.equal(searchAvailable(undefined), false);
});
