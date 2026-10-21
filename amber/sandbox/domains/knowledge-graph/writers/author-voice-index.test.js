/**
 * Unit tests for author-voice vector indexing. Pure-function coverage plus the
 * graceful-degradation path. No network.
 *
 * Run with:  node --test src/knowledge/author-voice-index.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  textForAuthorVoice,
  indexAuthorVoice,
  searchAuthorVoices,
} from "./author-voice-index.js";

test("textForAuthorVoice renders tells, guardrails, and samples", () => {
  const text = textForAuthorVoice({
    id: "sagar-tiwari",
    author_slug: "sagar-tiwari",
    display_name: "Sagar Tiwari",
    org: "bma",
    role_at_org: "Founder",
    voice_tells: {
      sentence_rhythm: "short punchy bursts",
      vocabulary_tells: ["funnel", "hypothesis"],
      signature_phrases: ["ignoring the hype"],
      jargon_blacklist: ["synergy"],
    },
    what_they_dont_say: ["leverage", "circle back"],
    sample_pieces: [
      {
        title: "Ignoring the Hype",
        body: "The funnel observation lands here.",
      },
    ],
  });
  assert.match(text, /Sagar Tiwari/);
  assert.match(text, /Org: bma/);
  assert.match(text, /Role: Founder/);
  assert.match(text, /Sentence rhythm: short punchy bursts/);
  assert.match(text, /Vocabulary: funnel, hypothesis/);
  assert.match(text, /Signature phrases: ignoring the hype/);
  assert.match(text, /Avoids: synergy/);
  assert.match(text, /Never says: leverage, circle back/);
  assert.match(text, /Sample "Ignoring the Hype": The funnel observation/);
});

test("textForAuthorVoice handles a minimal profile", () => {
  const text = textForAuthorVoice({
    id: "jane-doe",
    display_name: "Jane Doe",
  });
  assert.match(text, /Author voice: Jane Doe/);
  assert.doesNotMatch(text, /undefined/);
});

test("textForAuthorVoice returns empty for non-object", () => {
  assert.equal(textForAuthorVoice(null), "");
  assert.equal(textForAuthorVoice("nope"), "");
});

test("indexAuthorVoice degrades gracefully when vectorization unavailable", async () => {
  const prevPinecone = process.env.PINECONE_API_KEY;
  const prevPplx = process.env.PERPLEXITY_API_KEY;
  delete process.env.PINECONE_API_KEY;
  delete process.env.PERPLEXITY_API_KEY;
  try {
    const res = await indexAuthorVoice("did:privy:test", {
      id: "sagar-tiwari",
      display_name: "Sagar Tiwari",
    });
    assert.equal(res.indexed, false);
    assert.equal(res.reason, "pinecone_unavailable");

    const matches = await searchAuthorVoices("did:privy:test", {
      query: "punchy short sentences",
    });
    assert.deepEqual(matches, []);
  } finally {
    if (prevPinecone !== undefined) process.env.PINECONE_API_KEY = prevPinecone;
    if (prevPplx !== undefined) process.env.PERPLEXITY_API_KEY = prevPplx;
  }
});

test("indexAuthorVoice rejects missing args", async () => {
  const res = await indexAuthorVoice("did:privy:test", null);
  assert.equal(res.indexed, false);
  assert.equal(res.reason, "missing_args");
});
