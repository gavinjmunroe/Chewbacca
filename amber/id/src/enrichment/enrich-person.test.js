/**
 * Unit tests for the ENRICH function (src/enrichment/enrich-person.js).
 *
 * Covers: flag-off / no-key no-op, the deeper web pull + deterministic
 * extraction, the Agent "what's new" brief path (mocked fetch), the Pinecone
 * embedding upsert (injected embed/upsert), caching + force-refresh, and the
 * Agent-response shape tolerance.
 *
 * No network. Run with:  node --test src/enrichment/enrich-person.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  enrichmentEnabled,
  enrichQueryVariants,
  buildAgentInput,
  agentBrief,
  enrichPerson,
  fallbackBrief,
  recordEnrichmentFeedback,
  _clearEnrichCache,
} from "./enrich-person.js";

const DID = "did:privy:sagar";
const NOW = Date.parse("2026-06-02T00:00:00Z");
const CONTACT = {
  id: "c1",
  name: "Priya Nair",
  company: "Acme",
  title: "VP Eng",
};

function withEnrichFlag(value, fn) {
  const prevFlag = process.env.PEOPLERANK_ENRICHMENT;
  const prevKey = process.env.EXA_API_KEY;
  if (value.flag === undefined) delete process.env.PEOPLERANK_ENRICHMENT;
  else process.env.PEOPLERANK_ENRICHMENT = value.flag;
  if (value.key === undefined) delete process.env.EXA_API_KEY;
  else process.env.EXA_API_KEY = value.key;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (prevFlag === undefined) delete process.env.PEOPLERANK_ENRICHMENT;
      else process.env.PEOPLERANK_ENRICHMENT = prevFlag;
      if (prevKey === undefined) delete process.env.EXA_API_KEY;
      else process.env.EXA_API_KEY = prevKey;
    });
}

// A search impl that returns a fixed result set, recording the call.
function fakeSearch(results, calls = []) {
  return async (args) => {
    calls.push(args);
    return { results, id: "search-1" };
  };
}

const SOURCES = [
  {
    title: "Priya Nair joins Acme as VP Eng",
    url: "https://techcrunch.com/priya",
    date: "2026-05-20",
  },
  {
    title: "Priya on LinkedIn",
    url: "https://linkedin.com/in/priya",
    date: "2026-04-01",
  },
  {
    title: "Old profile",
    url: "https://example.com/old",
    date: "2024-01-01",
  },
];

test("enrichmentEnabled reflects the flag", () =>
  withEnrichFlag({ flag: "on", key: "k" }, () => {
    assert.equal(enrichmentEnabled(), true);
  }).then(() =>
    withEnrichFlag({ flag: undefined, key: "k" }, () => {
      assert.equal(enrichmentEnabled(), false);
    }),
  ));

test("enrichQueryVariants builds the bounded fan-out", () => {
  const v = enrichQueryVariants(CONTACT, { year: 2026 });
  assert.ok(v.length > 0 && v.length <= 5);
  assert.ok(v.includes("Priya Nair Acme"));
  assert.ok(v.some((q) => q.includes("news 2026")));
});

test("buildAgentInput grounds on identity + dated sources", () => {
  const input = buildAgentInput(CONTACT, SOURCES);
  assert.match(input, /Priya Nair \(VP Eng at Acme\)/);
  assert.match(input, /2026-05-20/);
  assert.match(input, /What's new in Priya Nair's professional life\?/);
});

test("flag OFF -> disabled no-op, no search, no agent", () =>
  withEnrichFlag({ flag: undefined, key: "k" }, async () => {
    _clearEnrichCache();
    const calls = [];
    const r = await enrichPerson(DID, CONTACT, {
      searchImpl: fakeSearch(SOURCES, calls),
      agentBriefImpl: async () => "should not run",
      nowMs: NOW,
    });
    assert.equal(r.status, "disabled");
    assert.equal(r.whats_new, null);
    assert.deepEqual(r.sources, []);
    assert.equal(r.embedded, false);
    assert.equal(calls.length, 0); // never searched
  }));

test("no key -> no_key no-op even when flag on", () =>
  withEnrichFlag({ flag: "on", key: undefined }, async () => {
    _clearEnrichCache();
    const r = await enrichPerson(DID, CONTACT, {
      searchImpl: fakeSearch(SOURCES),
      agentBriefImpl: async () => "x",
      apiKey: undefined,
      nowMs: NOW,
    });
    assert.equal(r.status, "no_key");
  }));

test("nameless contact -> no_contact", () =>
  withEnrichFlag({ flag: "on", key: "k" }, async () => {
    _clearEnrichCache();
    const r = await enrichPerson(
      DID,
      { id: "c9", name: "" },
      {
        searchImpl: fakeSearch(SOURCES),
        agentBriefImpl: async () => "x",
        nowMs: NOW,
      },
    );
    assert.equal(r.status, "no_contact");
  }));

test("flag ON -> deeper pull + extracted signals + agent brief", () =>
  withEnrichFlag({ flag: "on", key: "k" }, async () => {
    _clearEnrichCache();
    const calls = [];
    const r = await enrichPerson(DID, CONTACT, {
      searchImpl: fakeSearch(SOURCES, calls),
      agentBriefImpl: async ({ contact, sources }) => {
        assert.equal(contact.id, "c1");
        assert.ok(sources.length > 0);
        return "Priya recently joined Acme as VP of Engineering.";
      },
      nowMs: NOW,
    });
    assert.equal(r.status, "ok");
    assert.equal(calls.length, 1); // one multi-query call
    assert.equal(calls[0].maxResults, 10); // deeper than the in-path 5
    assert.match(r.whats_new, /VP of Engineering/);
    assert.equal(
      r.signals.social_links.linkedin,
      "https://linkedin.com/in/priya",
    );
    assert.ok(r.sources.length > 0);
    // freshest source first
    assert.equal(r.sources[0].date, "2026-05-20");
    assert.equal(r.embedded, false); // no embed/upsert injected
  }));

test("embedding upsert: injected embed+upsert -> embedded:true, idempotent id", () =>
  withEnrichFlag({ flag: "on", key: "k" }, async () => {
    _clearEnrichCache();
    process.env.PINECONE_API_KEY = "pc";
    const upserts = [];
    try {
      const r = await enrichPerson(DID, CONTACT, {
        searchImpl: fakeSearch(SOURCES),
        agentBriefImpl: async () => "Brief.",
        embed: async () => new Array(2560).fill(0.01),
        upsert: async (did, items) => {
          upserts.push({ did, items });
          return { upserted: items.length };
        },
        nowMs: NOW,
      });
      assert.equal(r.embedded, true);
      assert.equal(upserts.length, 1);
      assert.equal(upserts[0].did, DID);
      assert.equal(upserts[0].items[0].id, "enrich:c1");
      assert.equal(upserts[0].items[0].vector.length, 2560);
      assert.equal(upserts[0].items[0].healthDimension, "social");
    } finally {
      delete process.env.PINECONE_API_KEY;
    }
  }));

// WAS: "embedding skipped silently when PINECONE_API_KEY absent". The gate is no
// longer an environment variable, because there is no external index to hold a
// key for. Enrichment embeds only into an indexer the CALLER hands it, and with
// none supplied it does nothing rather than reaching out to anything.
test("no indexer injected means nothing is embedded — there is no external index", () =>
  withEnrichFlag({ flag: "on", key: "k" }, async () => {
    _clearEnrichCache();
    const r = await enrichPerson(DID, CONTACT, {
      searchImpl: fakeSearch(SOURCES),
      agentBriefImpl: async () => "Brief.",
      nowMs: NOW,
    });
    assert.equal(r.status, "ok");
    assert.equal(r.embedded, false);
  }));

test("caching: second call is served from cache; force bypasses", () =>
  withEnrichFlag({ flag: "on", key: "k" }, async () => {
    _clearEnrichCache();
    const calls = [];
    const opts = {
      searchImpl: fakeSearch(SOURCES, calls),
      agentBriefImpl: async () => "Brief.",
      nowMs: NOW,
    };
    const r1 = await enrichPerson(DID, CONTACT, opts);
    const r2 = await enrichPerson(DID, CONTACT, opts);
    assert.equal(r1.status, "ok");
    assert.equal(r2.status, "ok");
    assert.equal(calls.length, 1); // second served from cache
    await enrichPerson(DID, CONTACT, { ...opts, force: true });
    assert.equal(calls.length, 2); // force re-pulls
  }));

test("agent brief degrades to ok-with-null when the Agent call fails", () =>
  withEnrichFlag({ flag: "on", key: "k" }, async () => {
    _clearEnrichCache();
    const r = await enrichPerson(DID, CONTACT, {
      searchImpl: fakeSearch(SOURCES),
      agentBriefImpl: async () => null, // agent unavailable
      nowMs: NOW,
    });
    assert.equal(r.status, "ok"); // search still produced signals/sources
    assert.equal(r.whats_new, null);
    assert.ok(r.sources.length > 0);
  }));

// ── agentBrief (mocked fetch) ──────────────────────────────────────────────────

test("agentBrief: no key -> null, no fetch", async () => {
  let fetched = false;
  const out = await agentBrief({
    contact: CONTACT,
    sources: SOURCES,
    fetchImpl: async () => {
      fetched = true;
      return { ok: true, json: async () => ({}) };
    },
    apiKey: undefined,
  });
  assert.equal(out, null);
  assert.equal(fetched, false);
});

test("agentBrief: posts to Anthropic messages with the right body", async () => {
  let captured = null;
  const out = await agentBrief({
    contact: CONTACT,
    sources: SOURCES,
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return {
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "  Priya just launched a product.  " }],
        }),
      };
    },
    apiKey: "k",
  });
  assert.equal(out, "Priya just launched a product."); // trimmed
  assert.equal(captured.url, "https://api.anthropic.com/v1/messages");
  const body = JSON.parse(captured.init.body);
  assert.equal(body.model, "claude-haiku-4-5");
  // No web_search tool: the brief is grounded ONLY in the sources leg 1 pulled.
  // If a tools array ever reappears here, this endpoint started paying for its
  // own search again.
  assert.equal(body.tools, undefined);
  // System prompt travels as a block array so cache_control can ride along.
  assert.ok(Array.isArray(body.system) && body.system.length === 1);
  assert.ok(body.system[0].text.length > 0);
  assert.deepEqual(body.system[0].cache_control, { type: "ephemeral" });
  // The person and their sources reach the model as the user turn.
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].role, "user");
  assert.ok(body.messages[0].content.includes("Priya Nair"));
  // Anthropic auth is x-api-key + a version header, not a bearer token.
  assert.equal(captured.init.headers["x-api-key"], "k");
  assert.equal(captured.init.headers["anthropic-version"], "2023-06-01");
});

test("agentBrief: concatenates text blocks and ignores non-text blocks", async () => {
  // A response can lead with a non-text block, so reading content[0] blindly
  // would return nothing for a perfectly good answer.
  const multi = await agentBrief({
    contact: CONTACT,
    sources: SOURCES,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        content: [
          { type: "thinking", thinking: "ignore me" },
          { type: "text", text: "First half. " },
          { type: "text", text: "Second half." },
        ],
      }),
    }),
    apiKey: "k",
  });
  assert.equal(multi, "First half. Second half.");

  // No text blocks at all -> null, not an empty string, so the caller falls
  // through to fallbackBrief().
  const empty = await agentBrief({
    contact: CONTACT,
    sources: SOURCES,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ content: [{ type: "tool_use", id: "x" }] }),
    }),
    apiKey: "k",
  });
  assert.equal(empty, null);
});

test("agentBrief: non-ok / throw -> null", async () => {
  const nonOk = await agentBrief({
    contact: CONTACT,
    sources: SOURCES,
    fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }),
    apiKey: "k",
  });
  assert.equal(nonOk, null);

  const threw = await agentBrief({
    contact: CONTACT,
    sources: SOURCES,
    fetchImpl: async () => {
      throw new Error("network");
    },
    apiKey: "k",
  });
  assert.equal(threw, null);
});

// ── brief-parser degradation + shape logging (item 167) ────────────────────────

test("agentBrief: unrecognized response envelope -> null", async () => {
  // WAS "…and logs the shape only", asserting the Perplexity Agent API's
  // multi-shape tolerance and its key-name-only logging. Anthropic returns one
  // documented envelope, so the tolerance layer that test covered is gone; what
  // still matters is that an envelope we cannot read degrades to null rather
  // than throwing or returning "undefined" into somebody's contact card.
  const out = await agentBrief({
    contact: CONTACT,
    sources: SOURCES,
    fetchImpl: async () => ({ ok: true, json: async () => ({ unexpected: true }) }),
    apiKey: "k",
  });
  assert.equal(out, null);
});

test("fallbackBrief derives a line from the freshest source, or null when empty", () => {
  const line = fallbackBrief(CONTACT, SOURCES);
  assert.match(line, /Priya Nair/);
  assert.match(line, /Priya Nair joins Acme as VP Eng/);
  assert.equal(fallbackBrief(CONTACT, []), null);
  assert.equal(fallbackBrief(CONTACT, null), null);
});

test("enrichPerson: brief unavailable -> whats_new null but fallback populated", () =>
  withEnrichFlag({ flag: "on", key: "k" }, async () => {
    _clearEnrichCache();
    const r = await enrichPerson(DID, CONTACT, {
      searchImpl: fakeSearch(SOURCES),
      agentBriefImpl: async () => null, // Agent down/rate-limited
      nowMs: NOW,
    });
    assert.equal(r.status, "ok");
    assert.equal(r.whats_new, null); // strictly the grounded brief
    assert.ok(
      r.whats_new_fallback && r.whats_new_fallback.includes("Priya Nair"),
    );
  }));

// ── canonical social links on the result (item 170) ────────────────────────────

test("enrichPerson attaches canonical social_links to the result", () =>
  withEnrichFlag({ flag: "on", key: "k" }, async () => {
    _clearEnrichCache();
    const r = await enrichPerson(DID, CONTACT, {
      searchImpl: fakeSearch(SOURCES),
      agentBriefImpl: async () => "Brief.",
      nowMs: NOW,
    });
    assert.equal(r.social_links.linkedin, "https://linkedin.com/in/priya");
  }));

// ── idempotent / incremental re-embed (item 171) ───────────────────────────────

test("re-embed is skipped when the composed text is unchanged", () =>
  withEnrichFlag({ flag: "on", key: "k" }, async () => {
    _clearEnrichCache();
    process.env.PINECONE_API_KEY = "pc";
    let embedCalls = 0;
    const opts = {
      searchImpl: fakeSearch(SOURCES),
      agentBriefImpl: async () => "Stable brief.",
      embed: async () => {
        embedCalls++;
        return new Array(8).fill(0.1);
      },
      upsert: async () => ({ upserted: 1 }),
      nowMs: NOW,
    };
    try {
      const r1 = await enrichPerson(DID, CONTACT, opts);
      assert.equal(r1.embedded, true);
      assert.equal(r1.embed_status, "embedded");
      // Force a re-pull (bypass the result cache) with identical content.
      const r2 = await enrichPerson(DID, CONTACT, { ...opts, force: true });
      assert.equal(r2.embedded, false);
      assert.equal(r2.embed_status, "unchanged");
      assert.equal(embedCalls, 1); // never embedded the identical text twice
    } finally {
      delete process.env.PINECONE_API_KEY;
    }
  }));

// ── from_cache flag (item 166) ─────────────────────────────────────────────────

test("a cache hit is flagged from_cache: true; a fresh result is false", () =>
  withEnrichFlag({ flag: "on", key: "k" }, async () => {
    _clearEnrichCache();
    const opts = {
      searchImpl: fakeSearch(SOURCES),
      agentBriefImpl: async () => "Brief.",
      nowMs: NOW,
    };
    const r1 = await enrichPerson(DID, CONTACT, opts);
    const r2 = await enrichPerson(DID, CONTACT, opts);
    assert.equal(r1.from_cache, false);
    assert.equal(r2.from_cache, true);
  }));

// ── enrichment feedback down-weights confidence + busts cache (item 176) ───────

test("negative feedback lowers confidence and forces a re-pull", () =>
  withEnrichFlag({ flag: "on", key: "k" }, async () => {
    _clearEnrichCache();
    const calls = [];
    const opts = {
      searchImpl: fakeSearch(SOURCES, calls),
      agentBriefImpl: async () => "Brief.",
      nowMs: NOW,
    };
    const r1 = await enrichPerson(DID, CONTACT, opts);
    assert.equal(r1.confidence, 1);
    assert.equal(calls.length, 1);

    // User marks it wrong twice -> confidence drops and the cache is busted.
    recordEnrichmentFeedback(DID, CONTACT.id, "down");
    recordEnrichmentFeedback(DID, CONTACT.id, "down");
    const r2 = await enrichPerson(DID, CONTACT, opts);
    assert.ok(r2.confidence < 1, `confidence ${r2.confidence} should be < 1`);
    assert.equal(calls.length, 2); // re-pulled instead of serving the bad cache
  }));
