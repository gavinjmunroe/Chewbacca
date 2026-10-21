/**
 * Exa retrieval: the breadth pass, the depth pass, and the fail-safe contract.
 * fetch is injected throughout, so nothing here touches the network.
 *
 * Run with:  node --test src/lib/exa-search.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  exaSearch,
  exaContents,
  urlsInMessage,
  exaConfigured,
  exaFindPeople,
  looksLikePeopleSearch,
  parseLinkedInProfile,
} from "./exa-search.js";

const KEY = "test-key";
const ok = (payload) => ({ ok: true, status: 200, json: async () => payload });

test("exaSearch sends the query, the count, and a text cap", async () => {
  let seen = null;
  const out = await exaSearch({
    query: "  best coffee west village  ",
    numResults: 12,
    apiKey: KEY,
    fetchImpl: async (url, init) => {
      seen = { url, body: JSON.parse(init.body) };
      return ok({
        results: [
          { title: "T", url: "https://a.com/x", text: "  a   b  ", publishedDate: "2026-07-01" },
        ],
      });
    },
  });
  assert.equal(seen.url, "https://api.exa.ai/search");
  assert.equal(seen.body.query, "best coffee west village");
  assert.equal(seen.body.numResults, 12);
  assert.ok(seen.body.contents.text.maxCharacters > 0);
  assert.equal(out[0].text, "a b"); // whitespace collapsed
  assert.equal(out[0].publishedDate, "2026-07-01");
});

test("exaSearch asks for highlights only when given a highlight query", async () => {
  const bodies = [];
  const fetchImpl = async (_u, init) => {
    bodies.push(JSON.parse(init.body));
    return ok({ results: [] });
  };
  await exaSearch({ query: "q", apiKey: KEY, fetchImpl });
  await exaSearch({ query: "q", highlightQuery: "who are the VPs", apiKey: KEY, fetchImpl });
  assert.equal(bodies[0].contents.highlights, undefined);
  assert.equal(bodies[1].contents.highlights.query, "who are the VPs");
});

test("exaSearch caps numResults at 25 and floors it at 1", async () => {
  const counts = [];
  const fetchImpl = async (_u, init) => {
    counts.push(JSON.parse(init.body).numResults);
    return ok({ results: [] });
  };
  await exaSearch({ query: "q", numResults: 500, apiKey: KEY, fetchImpl });
  await exaSearch({ query: "q", numResults: 0, apiKey: KEY, fetchImpl });
  await exaSearch({ query: "q", numResults: -3, apiKey: KEY, fetchImpl });
  assert.deepEqual(counts, [25, 5, 1]);
});

test("exaSearch returns [] on every failure path and never throws", async () => {
  const boom = async () => {
    throw new Error("network");
  };
  assert.deepEqual(await exaSearch({ query: "q", apiKey: null, fetchImpl: boom }), []);
  assert.deepEqual(await exaSearch({ query: "", apiKey: KEY, fetchImpl: boom }), []);
  assert.deepEqual(await exaSearch({ query: "q", apiKey: KEY, fetchImpl: boom }), []);
  assert.deepEqual(
    await exaSearch({ query: "q", apiKey: KEY, fetchImpl: async () => ({ ok: false, status: 500 }) }),
    [],
  );
  assert.deepEqual(
    await exaSearch({
      query: "q",
      apiKey: KEY,
      fetchImpl: async () => ({ ok: true, json: async () => { throw new Error("bad json"); } }),
    }),
    [],
  );
  // A 200 whose body is not the expected shape is not a crash either.
  assert.deepEqual(
    await exaSearch({ query: "q", apiKey: KEY, fetchImpl: async () => ok({ nope: 1 }) }),
    [],
  );
});

test("exaSearch drops rows with no url — they are unusable as a source", async () => {
  const out = await exaSearch({
    query: "q",
    apiKey: KEY,
    fetchImpl: async () => ok({ results: [{ title: "no url" }, { title: "ok", url: "https://a.com" }] }),
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].url, "https://a.com");
});

// ── depth ───────────────────────────────────────────────────────────────────────

test("exaContents reads full pages and asks for a live fallback crawl", async () => {
  let body = null;
  const out = await exaContents({
    urls: ["https://a.com/doc"],
    maxCharacters: 9000,
    highlightQuery: "revenue",
    apiKey: KEY,
    fetchImpl: async (url, init) => {
      assert.equal(url, "https://api.exa.ai/contents");
      body = JSON.parse(init.body);
      return ok({ results: [{ url: "https://a.com/doc", title: "Doc", text: "long text" }] });
    },
  });
  assert.deepEqual(body.urls, ["https://a.com/doc"]);
  assert.equal(body.text.maxCharacters, 9000);
  assert.equal(body.livecrawl, "fallback");
  assert.equal(body.highlights.query, "revenue");
  assert.equal(out[0].text, "long text");
});

test("exaContents retries as `ids` when the `urls` shape is rejected", async () => {
  const keys = [];
  const out = await exaContents({
    urls: ["https://a.com/doc"],
    apiKey: KEY,
    fetchImpl: async (_u, init) => {
      const parsed = JSON.parse(init.body);
      keys.push(parsed.urls ? "urls" : "ids");
      if (parsed.urls) return { ok: false, status: 400 };
      return ok({ results: [{ url: "https://a.com/doc", text: "read via ids" }] });
    },
  });
  assert.deepEqual(keys, ["urls", "ids"]);
  assert.equal(out[0].text, "read via ids");
});

test("exaContents does NOT retry a 401 or a 500 — those are not shape problems", async () => {
  for (const status of [401, 500]) {
    let calls = 0;
    const out = await exaContents({
      urls: ["https://a.com/doc"],
      apiKey: KEY,
      fetchImpl: async () => {
        calls += 1;
        return { ok: false, status };
      },
    });
    assert.equal(calls, 1, `status ${status} should not be retried`);
    assert.deepEqual(out, []);
  }
});

test("exaContents does not retry an empty 200 — no text is an answer", async () => {
  let calls = 0;
  const out = await exaContents({
    urls: ["https://a.com/doc"],
    apiKey: KEY,
    fetchImpl: async () => {
      calls += 1;
      return ok({ results: [] });
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(out, []);
});

test("exaContents accepts only http(s) urls and caps how many it reads", async () => {
  let body = null;
  const many = Array.from({ length: 30 }, (_, i) => `https://a.com/${i}`);
  await exaContents({
    urls: ["amber://connect?u=sagar", "file:///etc/passwd", "not a url", ...many],
    apiKey: KEY,
    fetchImpl: async (_u, init) => {
      body = JSON.parse(init.body);
      return ok({ results: [] });
    },
  });
  assert.ok(body.urls.every((u) => u.startsWith("https://")));
  assert.equal(body.urls.length, 8);
});

test("exaContents with nothing to read makes no request at all", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return ok({ results: [] });
  };
  assert.deepEqual(await exaContents({ urls: [], apiKey: KEY, fetchImpl }), []);
  assert.deepEqual(await exaContents({ urls: ["ftp://x"], apiKey: KEY, fetchImpl }), []);
  assert.deepEqual(await exaContents({ apiKey: KEY, fetchImpl }), []);
  assert.equal(calls, 0);
});

// ── pasted links ────────────────────────────────────────────────────────────────

test("urlsInMessage finds pasted links and strips trailing punctuation", async () => {
  assert.deepEqual(
    urlsInMessage("read https://a.com/doc.pdf and tell me the revenue."),
    ["https://a.com/doc.pdf"],
  );
  // The full stop belongs to the sentence, not the address.
  assert.deepEqual(urlsInMessage("see https://a.com/x."), ["https://a.com/x"]);
  assert.deepEqual(urlsInMessage("(https://a.com/y)"), ["https://a.com/y"]);
  assert.deepEqual(urlsInMessage("nothing here"), []);
  assert.deepEqual(urlsInMessage(undefined), []);
  // Deduped, ordered, and capped.
  assert.deepEqual(
    urlsInMessage("https://a.com/1 https://a.com/1 https://a.com/2 https://a.com/3 https://a.com/4"),
    ["https://a.com/1", "https://a.com/2", "https://a.com/3"],
  );
});

// ── People cards ────────────────────────────────────────────────────────────────
// These are the rows the user is asked to VERIFY, so every field has to come from the
// page. Nothing here may invent a name.

test("exaConfigured reports whether web search can work at all", async () => {
  assert.equal(exaConfigured("k"), true);
  assert.equal(exaConfigured(""), false);
  assert.equal(exaConfigured("   "), false);
  assert.equal(exaConfigured(undefined), false);
});

test("parseLinkedInProfile reads name, title and company out of LinkedIn's own title", async () => {
  assert.deepEqual(
    parseLinkedInProfile({
      url: "https://www.linkedin.com/in/janedoe",
      title: "Jane Doe - VP Finance - Acme Corp | LinkedIn",
      text: "  Acme   Corp · New York ",
    }),
    {
      name: "Jane Doe",
      title: "VP Finance",
      company: "Acme Corp",
      url: "https://www.linkedin.com/in/janedoe",
      snippet: "Acme Corp · New York",
    },
  );
});

test("parseLinkedInProfile leaves missing fields null rather than guessing", async () => {
  const p = parseLinkedInProfile({ url: "https://linkedin.com/in/bo", title: "Bo Ortiz | LinkedIn" });
  assert.equal(p.name, "Bo Ortiz");
  assert.equal(p.title, null);
  assert.equal(p.company, null);
  assert.equal(p.snippet, null);
});

test("parseLinkedInProfile rejects anything that is not an individual profile", async () => {
  const reject = [
    { url: "https://www.linkedin.com/company/acme", title: "Acme | LinkedIn" },
    { url: "https://www.linkedin.com/jobs/view/123", title: "VP Finance | LinkedIn" },
    { url: "https://www.linkedin.com/pulse/some-article", title: "Top 10 VPs | LinkedIn" },
    { url: "https://example.com/in/janedoe", title: "Jane Doe | LinkedIn" },
    { url: "https://www.linkedin.com/in/x", title: "| LinkedIn" },
    // A directory page whose "name" is really a sentence.
    {
      url: "https://www.linkedin.com/in/x",
      title:
        "The 250 best vice presidents of finance working in New York City right now and how to reach them | LinkedIn",
    },
  ];
  for (const r of reject) assert.equal(parseLinkedInProfile(r), null, r.url + " " + r.title);
});

test("parseLinkedInProfile accepts regional LinkedIn subdomains", async () => {
  const p = parseLinkedInProfile({ url: "https://uk.linkedin.com/in/sam", title: "Sam Lee - CFO | LinkedIn" });
  assert.equal(p.name, "Sam Lee");
});

test("looksLikePeopleSearch needs BOTH a role and a finding intent", async () => {
  assert.equal(looksLikePeopleSearch("list out 5 VPs of finance in nyc"), true);
  assert.equal(looksLikePeopleSearch("who are the heads of product at fintechs"), true);
  assert.equal(looksLikePeopleSearch("find me a CTO in london"), true);
  // Not people questions — these must not trigger a LinkedIn pass.
  assert.equal(looksLikePeopleSearch("best coffee shop in dumbo to do work"), false);
  assert.equal(looksLikePeopleSearch("top restaurants in soho"), false);
  assert.equal(looksLikePeopleSearch("what is a vice president"), false); // role, no finding intent
  assert.equal(looksLikePeopleSearch(""), false);
});

test("exaFindPeople restricts to linkedin.com, dedupes, and caps", async () => {
  let body = null;
  const people = await exaFindPeople({
    query: "VPs of finance in nyc",
    limit: 3,
    apiKey: KEY,
    fetchImpl: async (_u, init) => {
      body = JSON.parse(init.body);
      return ok({
        results: [
          { url: "https://www.linkedin.com/in/a", title: "Ann A - VP Finance - Acme | LinkedIn" },
          // Same person, trailing slash: one card.
          { url: "https://www.linkedin.com/in/a/", title: "Ann A - VP Finance - Acme | LinkedIn" },
          { url: "https://www.linkedin.com/company/acme", title: "Acme | LinkedIn" }, // dropped
          { url: "https://www.linkedin.com/in/b", title: "Bo B - VP Finance - Bolt | LinkedIn" },
          { url: "https://www.linkedin.com/in/c", title: "Cy C | LinkedIn" },
          { url: "https://www.linkedin.com/in/d", title: "Di D - CFO | LinkedIn" }, // over the cap
        ],
      });
    },
  });
  assert.deepEqual(body.includeDomains, ["linkedin.com"]);
  assert.match(body.query, /LinkedIn profile$/);
  assert.deepEqual(people.map((p) => p.name), ["Ann A", "Bo B", "Cy C"]);
  assert.ok(people.every((p) => p.url.includes("linkedin.com/in/")));
});

test("exaFindPeople returns [] rather than throwing when the search fails", async () => {
  assert.deepEqual(
    await exaFindPeople({ query: "q", apiKey: KEY, fetchImpl: async () => ({ ok: false, status: 500 }) }),
    [],
  );
  assert.deepEqual(await exaFindPeople({ query: "q", apiKey: null, fetchImpl: async () => ok({}) }), []);
});

// ── A ROLE QUESTION MUST NOT COME BACK AS ONE FAMILY ─────────────────────────

test("no more than two profiles share a surname the question did not ask for", async () => {
  const page = (name, slug) => ({
    url: `https://www.linkedin.com/in/${slug}`,
    title: `${name} - Hardware Engineer - Acme | LinkedIn`,
    text: "Hardware engineer in New York.",
  });
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      results: [
        page("Meet Patel", "meet10"),
        page("Saavan Patel", "saavan-patel"),
        page("Piyush Patel", "piyush-patel"),
        page("Pruthvi Patel", "pruthvi-patel"),
        page("Manush Patel", "manush-patel"),
        page("Dana Okonkwo", "dana-o"),
        page("Lior Ben-Ami", "lior-ba"),
      ],
    }),
  });
  const people = await exaFindPeople({
    query: "hardware engineers in Manhattan",
    limit: 5,
    fetchImpl,
    apiKey: "test-key",
  });
  const surnames = people.map((p) => p.name.split(" ").pop());
  assert.equal(surnames.filter((s) => s === "Patel").length, 2, surnames.join(", "));
  // The slots freed up go to other people rather than being dropped.
  assert.ok(people.length > 2, `only ${people.length} came back`);
  assert.ok(surnames.includes("Okonkwo"), surnames.join(", "));
});

test("the cap is off when the question names that surname", async () => {
  const page = (name, slug) => ({
    url: `https://www.linkedin.com/in/${slug}`,
    title: `${name} - Engineer | LinkedIn`,
    text: "",
  });
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      results: [
        page("Meet Patel", "meet10"),
        page("Saavan Patel", "saavan-patel"),
        page("Piyush Patel", "piyush-patel"),
        page("Pruthvi Patel", "pruthvi-patel"),
      ],
    }),
  });
  const people = await exaFindPeople({
    query: "other engineers named Patel",
    limit: 5,
    fetchImpl,
    apiKey: "test-key",
  });
  assert.equal(people.length, 4, "asked for Patels, got Patels");
});
