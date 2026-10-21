/**
 * Unit tests for content-seed vector indexing. Pure-function coverage plus the
 * graceful-degradation path. No network: when PINECONE_API_KEY /
 * PERPLEXITY_API_KEY are absent, indexContentSeed must short-circuit before
 * touching Pinecone or Perplexity.
 *
 * Run with:  node --test src/knowledge/content-seed-index.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  textForContentSeed,
  dimensionForSeed,
  indexContentSeed,
  searchContentSeeds,
} from "./content-seed-index.js";

test("dimensionForSeed maps intent to a health dimension", () => {
  assert.equal(dimensionForSeed({ intent: "newsletter" }), "social");
  assert.equal(dimensionForSeed({ intent: "linkedin" }), "social");
  assert.equal(dimensionForSeed({ intent: "twitter" }), "social");
  assert.equal(dimensionForSeed({ intent: "opinion" }), "intellectual");
  assert.equal(dimensionForSeed({ intent: "hypothesis" }), "intellectual");
  assert.equal(
    dimensionForSeed({ intent: "stories_watching" }),
    "intellectual",
  );
  // Unknown / missing intent falls back to intellectual.
  assert.equal(dimensionForSeed({ intent: "mystery" }), "intellectual");
  assert.equal(dimensionForSeed({}), "intellectual");
});

test("textForContentSeed prefers polished draft and carries provenance", () => {
  const text = textForContentSeed({
    author_slug: "sagar-tiwari",
    org: "bma",
    intent: "newsletter",
    section_hint: "hypothesis",
    status: "polished",
    raw_text: "raw funnel note",
    polished_draft: "Ignoring the hype: the funnel observation.",
  });
  assert.match(text, /sagar-tiwari/);
  assert.match(text, /Intent: newsletter/);
  assert.match(text, /Section: hypothesis/);
  assert.match(text, /Polished: Ignoring the hype/);
  // Polished draft wins over raw text.
  assert.doesNotMatch(text, /raw funnel note/);
});

test("textForContentSeed falls back to raw_text then source_url", () => {
  const rawOnly = textForContentSeed({
    author_slug: "sagar-tiwari",
    org: "bma",
    intent: "hypothesis",
    raw_text: "first draft idea",
  });
  assert.match(rawOnly, /Draft: first draft idea/);

  const urlOnly = textForContentSeed({
    author_slug: "sagar-tiwari",
    org: "bma",
    intent: "hypothesis",
    source_url: "https://substack.com/p/foo",
  });
  assert.match(urlOnly, /Draft: https:\/\/substack\.com\/p\/foo/);
});

test("textForContentSeed returns empty string with no body", () => {
  assert.equal(
    textForContentSeed({ author_slug: "x", intent: "newsletter" }),
    "",
  );
  assert.equal(textForContentSeed(null), "");
});

test("indexContentSeed degrades gracefully when vectorization unavailable", async () => {
  const prevPinecone = process.env.PINECONE_API_KEY;
  const prevPplx = process.env.PERPLEXITY_API_KEY;
  delete process.env.PINECONE_API_KEY;
  delete process.env.PERPLEXITY_API_KEY;
  try {
    const res = await indexContentSeed("did:privy:test", {
      id: "seed_abc",
      author_slug: "sagar-tiwari",
      org: "bma",
      intent: "newsletter",
      raw_text: "hello",
    });
    assert.equal(res.indexed, false);
    assert.equal(res.reason, "pinecone_unavailable");

    // Search degrades to an empty array, never throws.
    const matches = await searchContentSeeds("did:privy:test", {
      query: "funnel",
    });
    assert.deepEqual(matches, []);
  } finally {
    if (prevPinecone !== undefined) process.env.PINECONE_API_KEY = prevPinecone;
    if (prevPplx !== undefined) process.env.PERPLEXITY_API_KEY = prevPplx;
  }
});

test("indexContentSeed rejects missing args", async () => {
  const res = await indexContentSeed("", { id: "x" });
  assert.equal(res.indexed, false);
  assert.equal(res.reason, "missing_args");
});
