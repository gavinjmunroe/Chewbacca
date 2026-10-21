/**
 * classifyViaBatchApi — the half-price transport for the backfill worker.
 *
 * The contract under test is the one runDimensionPass depends on and cannot
 * verify for itself: an array positionally matching the input, with null (never
 * an empty dimensions array) wherever the model did not answer. Getting that
 * backwards would not throw — it would quietly mark facts as belonging to none
 * of the six dimensions and settle them there permanently.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { classifyViaBatchApi } from "./observation-dimensions.js";

const QUIET = { log: () => {}, error: () => {} };
const FAST = { pollStartMs: 1, pollMaxMs: 2, log: QUIET.log, error: QUIET.error };

/** One answer object as the model would return it for fact N. */
const answer = (dim) => [{ dimension: dim, confidence: 0.9, weight: 0.8 }];

/**
 * A fetch that fakes create -> poll -> results.
 * `answersByChunk` maps custom_id -> the JSON map that request returns.
 */
function fakeBatch({ answersByChunk, failChunks = [], createStatus = 200, pollsBeforeEnd = 1 }) {
  let polls = 0;
  const submitted = [];
  const impl = async (url, init = {}) => {
    if (init.method === "POST" && url.endsWith("/batches")) {
      if (createStatus !== 200) {
        return { ok: false, status: createStatus, text: async () => "nope" };
      }
      submitted.push(JSON.parse(init.body).requests);
      return { ok: true, json: async () => ({ id: "batch_1" }) };
    }
    // NOTE: this branch must come AFTER the results check below would have
    // matched, so the results URL is tested first — an earlier version of this
    // fake matched "/batch_1" on both and answered the results fetch as a poll.
    if (url.startsWith("https://results.example")) {
      const lines = Object.entries(answersByChunk).map(([id, map]) =>
        JSON.stringify(
          failChunks.includes(id)
            ? { custom_id: id, result: { type: "errored", error: { type: "overloaded" } } }
            : {
                custom_id: id,
                result: {
                  type: "succeeded",
                  message: { content: [{ type: "text", text: JSON.stringify(map) }] },
                },
              },
        ),
      );
      return { ok: true, text: async () => lines.join("\n") + "\n" };
    }
    if (url.endsWith("/batch_1")) {
      polls += 1;
      return {
        ok: true,
        json: async () => ({
          processing_status: polls >= pollsBeforeEnd ? "ended" : "in_progress",
          results_url: "https://results.example/batch_1",
        }),
      };
    }
    // results JSONL
    const lines = Object.entries(answersByChunk).map(([id, map]) =>
      JSON.stringify(
        failChunks.includes(id)
          ? { custom_id: id, result: { type: "errored", error: { type: "overloaded" } } }
          : {
              custom_id: id,
              result: {
                type: "succeeded",
                message: { content: [{ type: "text", text: JSON.stringify(map) }] },
              },
            },
      ),
    );
    return { ok: true, text: async () => lines.join("\n") + "\n" };
  };
  impl.submitted = submitted;
  return impl;
}

test("empty input -> empty array, no request", async () => {
  let called = false;
  const out = await classifyViaBatchApi([], {
    ...FAST,
    fetchImpl: async () => {
      called = true;
    },
  });
  assert.deepEqual(out, []);
  assert.equal(called, false);
});

test("no ANTHROPIC_API_KEY -> all nulls, never empty dimensions", async () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const out = await classifyViaBatchApi(["a", "b"], { ...FAST, fetchImpl: async () => {} });
    assert.deepEqual(out, [null, null]);
  } finally {
    if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prev;
  }
});

test("happy path: answers come back positionally", async () => {
  process.env.ANTHROPIC_API_KEY = "k";
  const out = await classifyViaBatchApi(["ran a marathon", "got promoted"], {
    ...FAST,
    fetchImpl: fakeBatch({
      answersByChunk: { c0: { 1: answer("physical"), 2: answer("financial") } },
    }),
  });
  assert.equal(out.length, 2);
  assert.equal(out[0].dimensions[0].code, "physical");
  assert.equal(out[1].dimensions[0].code, "financial");
  assert.equal(out[0].method, "llm");
});

test("an empty answer array is a REAL answer, distinct from null", async () => {
  process.env.ANTHROPIC_API_KEY = "k";
  const out = await classifyViaBatchApi(["works at Acme"], {
    ...FAST,
    fetchImpl: fakeBatch({ answersByChunk: { c0: { 1: [] } } }),
  });
  // "this fact is about none of the six" — the row should settle, not retry.
  assert.deepEqual(out[0].dimensions, []);
  assert.notEqual(out[0], null);
});

test("a key the model omitted comes back null so the row retries", async () => {
  process.env.ANTHROPIC_API_KEY = "k";
  const out = await classifyViaBatchApi(["one", "two"], {
    ...FAST,
    fetchImpl: fakeBatch({ answersByChunk: { c0: { 1: answer("social") } } }),
  });
  assert.equal(out[0].dimensions[0].code, "social");
  assert.equal(out[1], null);
});

test("more than 25 facts split into several requests, reassembled in order", async () => {
  process.env.ANTHROPIC_API_KEY = "k";
  const texts = Array.from({ length: 30 }, (_, i) => `fact ${i}`);
  const c0 = {};
  for (let i = 1; i <= 25; i++) c0[i] = answer("emotional");
  const c1 = {};
  for (let i = 1; i <= 5; i++) c1[i] = answer("spiritual");
  const impl = fakeBatch({ answersByChunk: { c1, c0 } }); // results out of order
  const out = await classifyViaBatchApi(texts, { ...FAST, fetchImpl: impl });

  assert.equal(impl.submitted[0].length, 2, "should be two requests in one batch");
  assert.equal(out.length, 30);
  // Offsets must follow the INPUT order, not the order results arrived.
  assert.equal(out[0].dimensions[0].code, "emotional");
  assert.equal(out[24].dimensions[0].code, "emotional");
  assert.equal(out[25].dimensions[0].code, "spiritual");
  assert.equal(out[29].dimensions[0].code, "spiritual");
});

test("each request carries the numbered prompt and the shared system text", async () => {
  process.env.ANTHROPIC_API_KEY = "k";
  const impl = fakeBatch({ answersByChunk: { c0: { 1: answer("physical") } } });
  await classifyViaBatchApi(["ran a marathon"], { ...FAST, fetchImpl: impl });
  const req = impl.submitted[0][0];
  assert.equal(req.custom_id, "c0");
  assert.equal(req.params.temperature, 0);
  assert.ok(req.params.system.includes("six dimensions of health"));
  assert.equal(req.params.messages[0].content, "1. ran a marathon");
});

test("one failed chunk leaves only its own slots null", async () => {
  process.env.ANTHROPIC_API_KEY = "k";
  const texts = Array.from({ length: 30 }, (_, i) => `fact ${i}`);
  const c0 = {};
  for (let i = 1; i <= 25; i++) c0[i] = answer("social");
  const c1 = {};
  for (let i = 1; i <= 5; i++) c1[i] = answer("physical");
  const out = await classifyViaBatchApi(texts, {
    ...FAST,
    fetchImpl: fakeBatch({ answersByChunk: { c0, c1 }, failChunks: ["c1"] }),
  });
  assert.equal(out[0].dimensions[0].code, "social", "good chunk is kept");
  assert.equal(out[24].dimensions[0].code, "social");
  assert.equal(out[25], null, "failed chunk retries");
  assert.equal(out[29], null);
});

test("it waits through in_progress polls", async () => {
  process.env.ANTHROPIC_API_KEY = "k";
  const out = await classifyViaBatchApi(["x"], {
    ...FAST,
    fetchImpl: fakeBatch({
      answersByChunk: { c0: { 1: answer("physical") } },
      pollsBeforeEnd: 3,
    }),
  });
  assert.equal(out[0].dimensions[0].code, "physical");
});

test("a create failure -> all nulls", async () => {
  process.env.ANTHROPIC_API_KEY = "k";
  const out = await classifyViaBatchApi(["a", "b"], {
    ...FAST,
    fetchImpl: fakeBatch({ answersByChunk: {}, createStatus: 401 }),
  });
  assert.deepEqual(out, [null, null]);
});

test("a batch that never ends -> all nulls, rows stay pending", async () => {
  process.env.ANTHROPIC_API_KEY = "k";
  const out = await classifyViaBatchApi(["a"], {
    ...FAST,
    maxWaitMs: 15,
    fetchImpl: fakeBatch({
      answersByChunk: { c0: { 1: answer("physical") } },
      pollsBeforeEnd: 10_000,
    }),
  });
  assert.deepEqual(out, [null]);
});

test("a thrown fetch -> all nulls, never a partial lie", async () => {
  process.env.ANTHROPIC_API_KEY = "k";
  const out = await classifyViaBatchApi(["a", "b"], {
    ...FAST,
    fetchImpl: async () => {
      throw new Error("network");
    },
  });
  assert.deepEqual(out, [null, null]);
});

// ── the confidence floor ──────────────────────────────────────────────────────

test("a dimension below the confidence floor is dropped, not stored", async () => {
  // From real output: "hates Greek food" came back physical:0.94 AND
  // intellectual:0.18. The 0.18 is not a judgment, and it still multiplies into
  // contact_dimension_state where it reads as signal.
  process.env.ANTHROPIC_API_KEY = "k";
  const out = await classifyViaBatchApi(["hates Greek food"], {
    ...FAST,
    fetchImpl: fakeBatch({
      answersByChunk: {
        c0: {
          1: [
            { dimension: "social", confidence: 0.9, weight: 0.8 },
            { dimension: "intellectual", confidence: 0.18, weight: 0.5 },
          ],
        },
      },
    }),
  });
  const codes = out[0].dimensions.map((d) => d.code);
  assert.deepEqual(codes, ["social"]);
});

test("the floor does not swallow a real dimension with a LOW WEIGHT", async () => {
  // The distinction the prompt now insists on: a minor-but-real connection is
  // high confidence and low weight. Dinner genuinely costs money; it says almost
  // nothing about financial health. That must survive.
  process.env.ANTHROPIC_API_KEY = "k";
  const out = await classifyViaBatchApi(["Got dinner with Maya"], {
    ...FAST,
    fetchImpl: fakeBatch({
      answersByChunk: {
        c0: {
          1: [
            { dimension: "social", confidence: 0.95, weight: 0.9 },
            { dimension: "financial", confidence: 0.8, weight: 0.1 },
          ],
        },
      },
    }),
  });
  const byCode = Object.fromEntries(out[0].dimensions.map((d) => [d.code, d]));
  assert.ok(byCode.social, "social must survive");
  assert.ok(byCode.financial, "a low-WEIGHT dimension must survive the floor");
  assert.equal(byCode.financial.weight, 0.1);
});

test("a dimension with no confidence at all still lands on the default", async () => {
  // A model that omits confidence should not be silently dropped by the floor —
  // _shapeAnswer defaults it to 0.6, which is above the floor deliberately.
  process.env.ANTHROPIC_API_KEY = "k";
  const out = await classifyViaBatchApi(["Ran a marathon"], {
    ...FAST,
    fetchImpl: fakeBatch({
      answersByChunk: { c0: { 1: [{ dimension: "physical", weight: 0.8 }] } },
    }),
  });
  assert.equal(out[0].dimensions.length, 1);
  assert.equal(out[0].dimensions[0].code, "physical");
});
