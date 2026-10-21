/**
 * Unit tests for the togari-search PeopleRank adapter.
 * Run with:  node --test src/enrichment/togari-search-rank.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  rankViaTogariSearch,
  rankDidViaTogari,
  streamViaTogariSearch,
  __testing,
} from "./togari-search-rank.js";

const ENV_KEYS = [
  "PEOPLERANK_ENGINE",
  "TOGARI_SEARCH_URL",
  "TOGARI_SEARCH_KEY",
];

function withEnv(overrides, fn) {
  const saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  Object.assign(process.env, overrides);
  for (const k of ENV_KEYS)
    if (overrides[k] === undefined) delete process.env[k];
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });
}

const CONTACTS = [
  {
    id: "c1",
    name: "Jane Okafor",
    company: "Stripe",
    title: "PM",
    emails: ["jane@stripe.com"],
  },
  { id: "c2", name: "Marcus Reilly", company: "Plaid", title: "SE" },
  { id: "bad", company: "NoName Inc" }, // no id+name -> dropped
];

const ENABLED = {
  PEOPLERANK_ENGINE: "togari",
  TOGARI_SEARCH_URL: "https://togari-search.example.com/",
  TOGARI_SEARCH_KEY: "test-key",
};

test("returns null when the engine flag is off", async () => {
  await withEnv({ ...ENABLED, PEOPLERANK_ENGINE: "" }, async () => {
    const out = await rankViaTogariSearch(
      { query: "fintech", limit: 10, contacts: CONTACTS },
      { fetch: () => assert.fail("fetch must not run when disabled") },
    );
    assert.equal(out, null);
  });
});

test("returns null when URL or key is missing", async () => {
  await withEnv(
    {
      PEOPLERANK_ENGINE: "togari",
      TOGARI_SEARCH_URL: "",
      TOGARI_SEARCH_KEY: "",
    },
    async () => {
      const out = await rankViaTogariSearch({
        query: "x",
        limit: 5,
        contacts: CONTACTS,
      });
      assert.equal(out, null);
    },
  );
});

test("forwards mapped contacts with bearer auth and returns the body", async () => {
  await withEnv(ENABLED, async () => {
    let captured = null;
    const fakeFetch = async (url, opts) => {
      captured = { url, opts, body: JSON.parse(opts.body) };
      return {
        ok: true,
        json: async () => ({
          query: "fintech",
          count: 2,
          people: [{ contactId: "c1" }],
          answer: "hi",
          answer_status: "ok",
          citations: [],
        }),
      };
    };
    const out = await rankViaTogariSearch(
      { query: "fintech", limit: 10, contacts: CONTACTS },
      { fetch: fakeFetch },
    );
    assert.ok(out);
    assert.equal(out.count, 2);
    assert.equal(
      captured.url,
      "https://togari-search.example.com/v1/me/people-rank",
    );
    assert.equal(captured.opts.headers.authorization, "Bearer test-key");
    // The id+name-less contact is dropped; the two valid ones are forwarded.
    assert.equal(captured.body.contacts.length, 2);
    assert.equal(captured.body.contacts[0].contactId, "c1");
    assert.equal(captured.body.contacts[0].email, "jane@stripe.com");
  });
});

test("fails open to null on a non-2xx upstream", async () => {
  await withEnv(ENABLED, async () => {
    const out = await rankViaTogariSearch(
      { query: "x", limit: 5, contacts: CONTACTS },
      {
        fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }),
      },
    );
    assert.equal(out, null);
  });
});

test("fails open to null when fetch throws", async () => {
  await withEnv(ENABLED, async () => {
    const out = await rankViaTogariSearch(
      { query: "x", limit: 5, contacts: CONTACTS },
      {
        fetch: async () => {
          throw new Error("network down");
        },
      },
    );
    assert.equal(out, null);
  });
});

test("returns null when the response has no people array", async () => {
  await withEnv(ENABLED, async () => {
    const out = await rankViaTogariSearch(
      { query: "x", limit: 5, contacts: CONTACTS },
      { fetch: async () => ({ ok: true, json: async () => ({ oops: true }) }) },
    );
    assert.equal(out, null);
  });
});

test("rankDidViaTogari resolves a session subject before loading owner contacts", async () => {
  const amberId = "11111111-2222-4333-8444-555555555555";
  await withEnv(ENABLED, async () => {
    let loadedOwner;
    let loadedProfileSubject;
    const out = await rankDidViaTogari(
      "a".repeat(32),
      { query: "fintech", limit: 7 },
      {
        resolveAmberIdByPrivyDid: async (subject) => {
          assert.equal(subject, "a".repeat(32));
          return amberId;
        },
        listContactsForRanking: async (owner) => {
          loadedOwner = owner;
          return CONTACTS;
        },
        getProfile: async (subject) => {
          loadedProfileSubject = subject;
          return { currentCity: "Palo Alto" };
        },
        fetch: async (_url, init) => ({
          ok: true,
          json: async () => ({ query: "fintech", people: [], answer_status: "ok" }),
        }),
      },
    );
    assert.equal(loadedOwner, amberId);
    assert.equal(loadedProfileSubject, "a".repeat(32));
    assert.equal(out.ok, true);
  });
});

test("toContactIn drops rows missing id or name", () => {
  assert.equal(__testing.toContactIn({ id: "x" }), null);
  assert.equal(__testing.toContactIn({ name: "y" }), null);
  const ok = __testing.toContactIn({ id: "x", name: "y", company: "Z" });
  assert.equal(ok.contactId, "x");
  assert.equal(ok.company, "Z");
});

// ── answer toggle (Stage 3 skip) ─────────────────────────────────────────────

test("POST body carries answer:true by default — existing callers unchanged", async () => {
  await withEnv(ENABLED, async () => {
    let body = null;
    await rankViaTogariSearch(
      { query: "fintech", limit: 5, contacts: CONTACTS },
      {
        fetch: async (_url, init) => {
          body = JSON.parse(init.body);
          return { ok: true, json: async () => ({ people: [] }) };
        },
      },
    );
    assert.equal(body.answer, true);
  });
});

test("answer:false is forwarded so the engine skips Stage 3", async () => {
  await withEnv(ENABLED, async () => {
    let body = null;
    await rankViaTogariSearch(
      { query: "fintech", limit: 5, contacts: CONTACTS, answer: false },
      {
        fetch: async (_url, init) => {
          body = JSON.parse(init.body);
          return { ok: true, json: async () => ({ people: [] }) };
        },
      },
    );
    assert.equal(body.answer, false);
    // Nothing else about the payload changes.
    assert.equal(body.query, "fintech");
    assert.equal(body.limit, 5);
    assert.equal(body.contacts.length, 2);
  });
});

// ── streamViaTogariSearch ────────────────────────────────────────────────────

// Build a Response-like object whose body streams the given SSE text, split at
// arbitrary byte boundaries to prove the line buffering handles split frames.
function sseResponse(text, { chunkSize = 17, ok = true } = {}) {
  const bytes = new TextEncoder().encode(text);
  let i = 0;
  return {
    ok,
    status: ok ? 200 : 500,
    body: {
      getReader() {
        return {
          async read() {
            if (i >= bytes.length) return { done: true, value: undefined };
            const slice = bytes.slice(i, i + chunkSize);
            i += chunkSize;
            return { done: false, value: slice };
          },
          async cancel() {},
        };
      },
    },
  };
}

const SSE_OK = [
  'event: people',
  'data: {"query": "pe", "count": 1, "people": [{"contactId": "1", "name": "Neel"}]}',
  '',
  ': ping',
  '',
  'event: token',
  'data: {"text": "You should reach out to "}',
  '',
  'event: token',
  'data: {"text": "Neel [[p:1]]."}',
  '',
  'event: done',
  'data: {"answer": "You should reach out to Neel [[p:1]].", "answer_status": "ok", "citations": [{"marker": "[[p:1]]", "contactId": "1"}], "rank_order": ["1"], "count": 1, "people": [{"contactId": "1", "name": "Neel"}]}',
  '',
  '',
].join("\n");

async function collect(gen) {
  const out = [];
  for await (const evt of gen) out.push(evt);
  return out;
}

test("streamViaTogariSearch yields people → token → done from the SSE", async () => {
  await withEnv(ENABLED, async () => {
    let url = null;
    let init = null;
    const events = await collect(
      streamViaTogariSearch(
        { query: "pe", limit: 5, contacts: CONTACTS },
        {
          fetch: async (u, i) => {
            url = u;
            init = i;
            return sseResponse(SSE_OK);
          },
        },
      ),
    );

    assert.equal(url, "https://togari-search.example.com/v1/me/people-rank/stream");
    assert.equal(init.headers.accept, "text/event-stream");
    assert.equal(init.headers.authorization, "Bearer test-key");

    assert.deepEqual(events.map((e) => e.type), ["people", "token", "token", "done"]);
    assert.equal(events[0].data.people[0].name, "Neel");
    assert.equal(events[1].data.text, "You should reach out to ");
    assert.equal(events[2].data.text, "Neel [[p:1]].");
    assert.equal(events[3].data.answer, "You should reach out to Neel [[p:1]].");
    assert.equal(events[3].data.citations[0].contactId, "1");
    assert.deepEqual(events[3].data.rank_order, ["1"]);
  });
});

test("streamViaTogariSearch yields nothing when the engine is off or unconfigured", async () => {
  const noFetch = { fetch: () => assert.fail("fetch must not run") };
  await withEnv({ ...ENABLED, PEOPLERANK_ENGINE: "" }, async () => {
    assert.deepEqual(await collect(streamViaTogariSearch({ query: "x", contacts: CONTACTS }, noFetch)), []);
  });
  await withEnv({ ...ENABLED, TOGARI_SEARCH_KEY: "" }, async () => {
    assert.deepEqual(await collect(streamViaTogariSearch({ query: "x", contacts: CONTACTS }, noFetch)), []);
  });
  await withEnv(ENABLED, async () => {
    assert.deepEqual(await collect(streamViaTogariSearch({ query: "x", contacts: [] }, noFetch)), []);
  });
});

test("streamViaTogariSearch yields nothing on a non-ok response or a throwing fetch", async () => {
  await withEnv(ENABLED, async () => {
    const bad = await collect(
      streamViaTogariSearch({ query: "x", contacts: CONTACTS }, { fetch: async () => sseResponse("", { ok: false }) }),
    );
    assert.deepEqual(bad, []);

    const threw = await collect(
      streamViaTogariSearch({ query: "x", contacts: CONTACTS }, {
        fetch: async () => { throw new Error("network down"); },
      }),
    );
    assert.deepEqual(threw, []);
  });
});

test("streamViaTogariSearch keeps earlier events when the stream dies mid-answer", async () => {
  await withEnv(ENABLED, async () => {
    const events = await collect(
      streamViaTogariSearch({ query: "x", contacts: CONTACTS }, {
        fetch: async () => ({
          ok: true,
          body: {
            getReader() {
              let n = 0;
              return {
                async read() {
                  n += 1;
                  if (n === 1) {
                    return {
                      done: false,
                      value: new TextEncoder().encode(
                        'event: people\ndata: {"people": [{"contactId": "1", "name": "Neel"}]}\n\nevent: token\ndata: {"text": "partial"}\n\n',
                      ),
                    };
                  }
                  throw new Error("connection reset");
                },
                async cancel() {},
              };
            },
          },
        }),
      }),
    );
    assert.deepEqual(events.map((e) => e.type), ["people", "token"]);
    assert.equal(events[1].data.text, "partial");
  });
});

test("streamViaTogariSearch skips malformed frames instead of throwing", async () => {
  await withEnv(ENABLED, async () => {
    const sse = [
      "event: token",
      "data: {not json",
      "",
      "event: token",
      'data: {"text": "ok"}',
      "",
    ].join("\n");
    const events = await collect(
      streamViaTogariSearch({ query: "x", contacts: CONTACTS }, { fetch: async () => sseResponse(sse) }),
    );
    assert.deepEqual(events.map((e) => e.data.text), ["ok"]);
  });
});
