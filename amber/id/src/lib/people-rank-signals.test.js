/**
 * Unit tests for web-derived ranking signals (SEARCH §1b).
 *
 * Pure extraction + query-variant building + cached fetch, all with an
 * injected fake searchImpl — no network.
 *
 * Run with:  node --test src/lib/people-rank-signals.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  emptySignals,
  buildQueryVariants,
  extractSignals,
  signalScoreInputs,
  getContactSignals,
  getSignalsForContacts,
  _clearSignalCache,
} from "./people-rank-signals.js";

const DAY = 86400000;
const NOW = Date.parse("2026-06-02T00:00:00Z");

test("emptySignals is a neutral fully-shaped object", () => {
  assert.deepEqual(emptySignals(), {
    recency: null,
    momentum: 0,
    social_links: {},
    top_sources: [],
    queried: false,
  });
});

test("buildQueryVariants: full identity -> 5 capped diverse queries", () => {
  const v = buildQueryVariants(
    { name: "Priya Nair", company: "Acme", title: "CTO" },
    { year: 2026 },
  );
  assert.equal(v.length, 5);
  assert.deepEqual(v, [
    "Priya Nair Acme",
    "Priya Nair CTO",
    "Priya Nair linkedin",
    "Priya Nair news 2026",
    "Priya Nair x.com OR twitter",
  ]);
});

test("buildQueryVariants: blank name -> []", () => {
  assert.deepEqual(buildQueryVariants({ name: "  " }), []);
  assert.deepEqual(buildQueryVariants({}), []);
});

test("buildQueryVariants: missing company/title still yields <=5 unique", () => {
  const v = buildQueryVariants({ name: "Solo Sam" }, { year: 2026 });
  assert.ok(v.length <= 5);
  assert.ok(v.includes("Solo Sam linkedin"));
  // no blank-prefixed company/title variant
  assert.ok(!v.some((q) => q.startsWith("Solo Sam ") && q.endsWith(" ")));
});

test("extractSignals: empty -> emptySignals", () => {
  assert.deepEqual(extractSignals([]), emptySignals());
  assert.deepEqual(extractSignals(null), emptySignals());
});

test("extractSignals: recency = newest date; dedupes by URL", () => {
  const results = [
    { title: "old", url: "https://a.com/1", date: "2026-01-01" },
    { title: "new", url: "https://b.com/2", date: "2026-05-30" },
    { title: "dupe", url: "https://a.com/1", date: "2026-06-01" }, // same URL, dropped
  ];
  const s = extractSignals(results, { nowMs: NOW });
  assert.equal(s.recency, Date.parse("2026-05-30"));
  assert.equal(s.queried, true);
});

test("extractSignals: momentum counts distinct fresh (<90d) domains only", () => {
  const results = [
    { url: "https://fresh1.com/a", date: "2026-05-20" }, // fresh
    { url: "https://fresh1.com/b", date: "2026-05-25" }, // same domain, not double counted
    { url: "https://fresh2.com/a", date: "2026-04-10" }, // fresh, distinct domain
    { url: "https://stale.com/a", date: "2025-01-01" }, // >90d, excluded
    { url: "https://nodate.com/a" }, // no date, excluded
  ];
  const s = extractSignals(results, { nowMs: NOW });
  assert.equal(s.momentum, 2);
});

test("extractSignals: social_links classified by host, first-match-wins", () => {
  const results = [
    { url: "https://www.linkedin.com/in/priya" },
    { url: "https://x.com/priya" },
    { url: "https://github.com/priya" },
    { url: "https://linkedin.com/in/other" }, // second linkedin, ignored
  ];
  const s = extractSignals(results, { nowMs: NOW });
  assert.equal(s.social_links.linkedin, "https://www.linkedin.com/in/priya");
  assert.equal(s.social_links.twitter, "https://x.com/priya");
  assert.equal(s.social_links.github, "https://github.com/priya");
});

test("extractSignals: top_sources freshest-first, capped at topN", () => {
  const results = [
    { title: "mid", url: "https://m.com", date: "2026-03-01" },
    { title: "new", url: "https://n.com", date: "2026-06-01" },
    { title: "undated", url: "https://u.com" },
    { title: "old", url: "https://o.com", date: "2026-01-01" },
  ];
  const s = extractSignals(results, { nowMs: NOW, topN: 2 });
  assert.equal(s.top_sources.length, 2);
  assert.equal(s.top_sources[0].url, "https://n.com"); // freshest first
  assert.equal(s.top_sources[1].url, "https://m.com");
});

test("signalScoreInputs: maps recency + momentum to 0..1", () => {
  const today = signalScoreInputs(
    { recency: NOW, momentum: 3 },
    { nowMs: NOW },
  );
  assert.ok(today.recency > 0.99); // result from "today"
  assert.equal(today.momentum, 1); // 3+ distinct fresh domains saturates

  const month = signalScoreInputs(
    { recency: NOW - 30 * DAY, momentum: 0 },
    { nowMs: NOW },
  );
  assert.ok(month.recency > 0.45 && month.recency < 0.55); // ~half-life 30d
  assert.equal(month.momentum, 0);

  const none = signalScoreInputs(emptySignals(), { nowMs: NOW });
  assert.equal(none.recency, 0);
  assert.equal(none.momentum, 0);
});

// ── cached fetch ──────────────────────────────────────────────────────────────

function fakeSearch(results) {
  const calls = [];
  const fn = async (args) => {
    calls.push(args);
    return { results, id: "fake" };
  };
  fn.calls = calls;
  return fn;
}

test("getContactSignals: no apiKey -> emptySignals, no search", async () => {
  _clearSignalCache();
  const searchImpl = fakeSearch([{ url: "https://x.com", date: "2026-06-01" }]);
  const s = await getContactSignals(
    "did:privy:a",
    { id: "c1", name: "Priya" },
    { searchImpl, apiKey: "", nowMs: NOW },
  );
  assert.deepEqual(s, emptySignals());
  assert.equal(searchImpl.calls.length, 0);
});

test("getContactSignals: extracts then caches (second call no search)", async () => {
  _clearSignalCache();
  const searchImpl = fakeSearch([
    { title: "t", url: "https://linkedin.com/in/p", date: "2026-05-30" },
  ]);
  const opts = { searchImpl, apiKey: "k", nowMs: NOW };
  const first = await getContactSignals("did:privy:a", { id: "c1", name: "Priya" }, opts);
  assert.equal(first.queried, true);
  assert.equal(first.social_links.linkedin, "https://linkedin.com/in/p");
  assert.equal(searchImpl.calls.length, 1);

  const second = await getContactSignals("did:privy:a", { id: "c1", name: "Priya" }, opts);
  assert.deepEqual(second, first);
  assert.equal(searchImpl.calls.length, 1); // served from cache
});

test("getContactSignals: search throwing -> emptySignals", async () => {
  _clearSignalCache();
  const searchImpl = async () => {
    throw new Error("boom");
  };
  const s = await getContactSignals(
    "did:privy:a",
    { id: "c1", name: "Priya" },
    { searchImpl, apiKey: "k", nowMs: NOW },
  );
  assert.deepEqual(s, emptySignals());
});

test("getContactSignals: contact with no name -> emptySignals, no search", async () => {
  _clearSignalCache();
  const searchImpl = fakeSearch([]);
  const s = await getContactSignals(
    "did:privy:a",
    { id: "c1", name: "" },
    { searchImpl, apiKey: "k", nowMs: NOW },
  );
  assert.deepEqual(s, emptySignals());
  assert.equal(searchImpl.calls.length, 0);
});

test("getSignalsForContacts: caps at maxContacts; overflow gets emptySignals", async () => {
  _clearSignalCache();
  const searchImpl = fakeSearch([{ url: "https://x.com", date: "2026-06-01" }]);
  const contacts = [
    { id: "c1", name: "A" },
    { id: "c2", name: "B" },
    { id: "c3", name: "C" },
  ];
  const map = await getSignalsForContacts("did:privy:a", contacts, {
    searchImpl,
    apiKey: "k",
    nowMs: NOW,
    maxContacts: 2,
  });
  assert.equal(map.c1.queried, true);
  assert.equal(map.c2.queried, true);
  assert.equal(map.c3.queried, false); // overflow
  assert.equal(searchImpl.calls.length, 2);
});

test("getSignalsForContacts: no apiKey -> all emptySignals, uniform shape", async () => {
  _clearSignalCache();
  const searchImpl = fakeSearch([{ url: "https://x.com" }]);
  const map = await getSignalsForContacts(
    "did:privy:a",
    [{ id: "c1", name: "A" }, { id: "c2", name: "B" }],
    { searchImpl, apiKey: "", nowMs: NOW },
  );
  assert.deepEqual(map.c1, emptySignals());
  assert.deepEqual(map.c2, emptySignals());
  assert.equal(searchImpl.calls.length, 0);
});
