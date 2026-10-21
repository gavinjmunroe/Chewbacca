/**
 * Unit tests for social-link extraction + source ranking
 * (src/enrichment/social-links.js, items 170, 174, 177).
 *
 * No network. Run with:  node --test src/enrichment/social-links.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalizeUrl,
  classifyLink,
  extractSocialLinks,
  sourceCredibility,
  rankSources,
} from "./social-links.js";

test("canonicalizeUrl forces https, drops www., strips tracking, trims slash", () => {
  const out = canonicalizeUrl(
    "http://www.Example.com/path/?utm_source=news&q=1&fbclid=zzz#frag",
  );
  assert.equal(out, "https://example.com/path?q=1");
});

test("canonicalizeUrl rejects non-http(s) and hostless urls", () => {
  assert.equal(canonicalizeUrl("ftp://example.com"), null);
  assert.equal(canonicalizeUrl("mailto:a@b.com"), null);
  assert.equal(canonicalizeUrl("not a url"), null);
  assert.equal(canonicalizeUrl("http://localhost/x"), null);
});

test("classifyLink unifies twitter and x.com onto the x.com handle", () => {
  assert.deepEqual(classifyLink("https://twitter.com/priya"), [
    "twitter",
    "https://x.com/priya",
  ]);
  assert.deepEqual(classifyLink("https://www.x.com/priya/"), [
    "twitter",
    "https://x.com/priya",
  ]);
});

test("classifyLink only accepts real profile paths", () => {
  assert.deepEqual(classifyLink("https://linkedin.com/in/priya-nair"), [
    "linkedin",
    "https://linkedin.com/in/priya-nair",
  ]);
  assert.equal(classifyLink("https://linkedin.com/feed"), null);
  assert.equal(classifyLink("https://x.com/i/timeline"), null);
});

test("extractSocialLinks dedupes across prior + sources and picks a website", () => {
  const sources = [
    {
      title: "TC",
      url: "https://techcrunch.com/2026/priya",
      date: "2026-05-20",
    },
    {
      title: "X",
      url: "https://twitter.com/priya?utm_source=tc",
      date: "2026-05-01",
    },
    { title: "Site", url: "https://priyanair.com/about", date: "2026-04-01" },
    { title: "Home", url: "https://priyanair.com/", date: "2026-03-01" },
  ];
  const prior = { linkedin: "http://www.linkedin.com/in/priya/" };
  const links = extractSocialLinks(sources, prior);
  assert.equal(links.linkedin, "https://linkedin.com/in/priya"); // canonicalized
  assert.equal(links.twitter, "https://x.com/priya"); // tracking stripped + unified
  assert.equal(links.website, "https://priyanair.com/"); // shortest path wins
  assert.ok(!("github" in links)); // none present
});

test("extractSocialLinks excludes aggregators from the website slot", () => {
  const sources = [
    { title: "Wiki", url: "https://en.wikipedia.org/wiki/Someone" },
    { title: "CB", url: "https://www.crunchbase.com/person/someone" },
  ];
  const links = extractSocialLinks(sources, {});
  assert.ok(!("website" in links));
});

test("extractSocialLinks never throws on garbage input", () => {
  assert.deepEqual(extractSocialLinks(null, null), {});
  assert.deepEqual(extractSocialLinks([{ url: 42 }, {}, null], undefined), {});
});

test("sourceCredibility ranks authoritative press above unknown domains", () => {
  assert.ok(
    sourceCredibility("https://reuters.com/x") >
      sourceCredibility("https://randomblog.io/x"),
  );
  assert.equal(sourceCredibility("https://randomblog.io/x"), 0.5);
  assert.equal(sourceCredibility("not a url"), 0);
});

test("rankSources orders freshest first, undated last, credibility tie-break", () => {
  const sources = [
    { title: "old credible", url: "https://reuters.com/a", date: "2025-01-01" },
    { title: "fresh blog", url: "https://blog.io/b", date: "2026-05-20" },
    { title: "undated", url: "https://x.io/c" },
    { title: "same-day blog", url: "https://blog.io/d", date: "2026-05-20" },
    {
      title: "same-day credible",
      url: "https://bloomberg.com/e",
      date: "2026-05-20",
    },
  ];
  const ranked = rankSources(sources);
  // Freshest date wins; among the three 2026-05-20 items, bloomberg outranks blogs.
  assert.equal(ranked[0].url, "https://bloomberg.com/e");
  assert.equal(ranked[ranked.length - 1].title, "undated");
});

test("rankSources does not mutate the input array", () => {
  const sources = [
    { url: "https://a.com", date: "2024-01-01" },
    { url: "https://b.com", date: "2026-01-01" },
  ];
  const copy = [...sources];
  rankSources(sources);
  assert.deepEqual(sources, copy);
});
