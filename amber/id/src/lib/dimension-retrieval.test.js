/**
 * dimension-retrieval: the six dimensions on the read path.
 *
 * Two things are pinned here because getting either wrong is silent and
 * expensive:
 *
 *   THE null CONTRACT. null means "retrieval could not help, use what you had".
 *   An empty result would mean "nobody is relevant", which on the chat path
 *   would show a user nothing. Every failure mode must produce null.
 *
 *   applyRetrievalToContacts MUST NOT LOSE CONTACTS by default. Only 53 of 5,249
 *   production contacts hold any fact, so a default that narrowed to retrieval
 *   hits would make 5,196 people unreachable and break asking about someone by
 *   name — a regression no test of the retrieval itself would catch.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  retrieveByDimension,
  applyRetrievalToContacts,
} from "./dimension-retrieval.js";

const obs = (contactId, body, score, extra = {}) => ({
  observationId: `o-${body.replace(/\W/g, "")}`,
  contactId,
  body,
  kind: "fact",
  modality: "stated",
  source: "soundboard",
  sourceConversationId: null,
  observedAt: "2026-08-01T00:00:00Z",
  score,
  dimensions: [{ code: "social", confidence: 0.9, weight: 0.8 }],
  ...extra,
});

const deps = (observations, over = {}) => ({
  classify: async () => ({ social: 0.5, emotional: 0.5 }),
  embed: async () => new Array(1536).fill(0.01),
  retrieve: async () => observations,
  ...over,
});

// ── the null contract ─────────────────────────────────────────────────────────

test("no ownerId or no question -> null, nothing is called", async () => {
  let touched = false;
  const spy = deps([], { retrieve: async () => { touched = true; return []; } });
  assert.equal(await retrieveByDimension({ question: "who?", ...spy }), null);
  assert.equal(await retrieveByDimension({ ownerId: "o1", ...spy }), null);
  assert.equal(await retrieveByDimension({ ownerId: "o1", question: "  ", ...spy }), null);
  assert.equal(touched, false);
});

test("no observations -> null, not an empty result", async () => {
  const out = await retrieveByDimension({ ownerId: "o1", question: "who?", ...deps([]) });
  assert.equal(out, null);
});

test("a throwing retrieve -> null", async () => {
  const out = await retrieveByDimension({
    ownerId: "o1", question: "who?",
    ...deps([], { retrieve: async () => { throw new Error("db down"); } }),
  });
  assert.equal(out, null);
});

test("observations with no contactId -> null (a fact with no subject ranks nobody)", async () => {
  const out = await retrieveByDimension({
    ownerId: "o1", question: "who?",
    ...deps([obs(null, "orphan fact", 0.9)]),
  });
  assert.equal(out, null);
});

test("a throwing classify still retrieves, with flat weights", async () => {
  const out = await retrieveByDimension({
    ownerId: "o1", question: "who?",
    ...deps([obs("c1", "went climbing", 0.9)], {
      classify: async () => { throw new Error("nope"); },
    }),
  });
  assert.ok(out);
  assert.equal(out.dimensionWeights, null);
  assert.deepEqual(out.contactIds, ["c1"]);
});

test("a throwing embed still retrieves, and says it had no vector", async () => {
  // retrieveHybrid falls back to dimension + recency ranking on a null vector,
  // so a draining embedding queue degrades the ORDER, never the answer.
  let sawVector = "unset";
  const out = await retrieveByDimension({
    ownerId: "o1", question: "who?",
    ...deps([obs("c1", "went climbing", 0.9)], {
      embed: async () => { throw new Error("no key"); },
      retrieve: async (args) => { sawVector = args.queryVector; return [obs("c1", "went climbing", 0.9)]; },
    }),
  });
  assert.ok(out);
  assert.equal(out.usedVector, false);
  assert.equal(sawVector, null);
});

// ── grouping and ordering ─────────────────────────────────────────────────────

test("contacts come back in relevance order, deduped, by their BEST fact", async () => {
  // c2's single strong fact must outrank c1's several weaker ones. Ordering by
  // volume would let one chatty contact bury a precisely relevant one.
  const out = await retrieveByDimension({
    ownerId: "o1", question: "who?",
    ...deps([
      obs("c2", "exactly what was asked", 0.95),
      obs("c1", "loosely related", 0.60),
      obs("c1", "also loosely related", 0.55),
      obs("c1", "third weak one", 0.50),
    ]),
  });
  assert.deepEqual(out.contactIds, ["c2", "c1"]);
  assert.equal(out.factsByContact.c1.length, 3);
  assert.equal(out.factsByContact.c2.length, 1);
});

test("facts per contact are capped", async () => {
  const many = Array.from({ length: 20 }, (_, i) => obs("c1", `fact ${i}`, 0.9 - i * 0.01));
  const out = await retrieveByDimension({
    ownerId: "o1", question: "who?", factsPerContact: 3, ...deps(many),
  });
  assert.equal(out.factsByContact.c1.length, 3);
  // The cap keeps the BEST three, because observations arrive score-ordered.
  assert.equal(out.factsByContact.c1[0].text, "fact 0");
});

test("the contact count is capped by limit", async () => {
  const spread = Array.from({ length: 10 }, (_, i) => obs(`c${i}`, `fact ${i}`, 0.9 - i * 0.01));
  const out = await retrieveByDimension({
    ownerId: "o1", question: "who?", limit: 4, ...deps(spread),
  });
  assert.equal(out.contactIds.length, 4);
  assert.deepEqual(out.contactIds, ["c0", "c1", "c2", "c3"]);
});

test("the observation pool asked for is a multiple of the contact limit", async () => {
  // One contact can hold many relevant facts, so a pool equal to the contact
  // count would cut the tail off arbitrarily.
  let askedLimit = 0;
  await retrieveByDimension({
    ownerId: "o1", question: "who?", limit: 40,
    ...deps([obs("c1", "x", 0.9)], {
      retrieve: async (a) => { askedLimit = a.limit; return [obs("c1", "x", 0.9)]; },
    }),
  });
  assert.ok(askedLimit > 40, `pool ${askedLimit} should exceed the contact limit`);
  assert.ok(askedLimit <= 200, "and must respect retrieveHybrid's own ceiling");
});

test("the fact shape matches asFactRow, and invents nothing", async () => {
  const out = await retrieveByDimension({
    ownerId: "o1", question: "who?", ...deps([obs("c1", "went climbing", 0.87)]),
  });
  const f = out.factsByContact.c1[0];
  // Both spellings, because the ranker and older callers read different ones.
  assert.equal(f.text, "went climbing");
  assert.equal(f.fact_text, "went climbing");
  assert.equal(f.observed_at, "2026-08-01T00:00:00.000Z");
  assert.equal(f.source, "soundboard");
  // The two fields this path can supply and the old one could not.
  assert.deepEqual(f.dimensions, [{ code: "social", confidence: 0.9, weight: 0.8 }]);
  assert.equal(f.retrieval_score, 0.87);
  // Unknown is null, never fabricated: a made-up certainty is indistinguishable
  // from a measured one downstream.
  for (const k of ["category", "sentiment", "certainty", "weight", "temporal_shape"]) {
    assert.equal(f[k], null, `${k} must be null, not invented`);
  }
});

// ── applyRetrievalToContacts ──────────────────────────────────────────────────

const CONTACTS = [
  { id: "c1", name: "Ann", facts: [{ text: "old ann fact" }] },
  { id: "c2", name: "Bo", facts: [{ text: "old bo fact" }] },
  { id: "c3", name: "Cy", facts: [] },
];
const REL = {
  contactIds: ["c3", "c1"],
  factsByContact: { c3: [{ text: "ranked cy fact" }], c1: [{ text: "ranked ann fact" }] },
};

test("DEFAULT KEEPS EVERY CONTACT — hits move to the front, nobody is dropped", async () => {
  const out = applyRetrievalToContacts(CONTACTS, REL);
  assert.equal(out.length, 3, "no contact may be lost by default");
  assert.deepEqual(out.map((c) => c.id), ["c3", "c1", "c2"]);
  assert.equal(out[0].facts[0].text, "ranked cy fact");
  assert.equal(out[1].facts[0].text, "ranked ann fact");
  // A contact retrieval said nothing about keeps its own facts untouched.
  assert.equal(out[2].facts[0].text, "old bo fact");
});

test("narrow:true returns only the hits, in relevance order", () => {
  const out = applyRetrievalToContacts(CONTACTS, REL, { narrow: true });
  assert.deepEqual(out.map((c) => c.id), ["c3", "c1"]);
});

test("no relevance, or an empty list, changes nothing", () => {
  assert.deepEqual(applyRetrievalToContacts(CONTACTS, null), CONTACTS);
  assert.deepEqual(applyRetrievalToContacts(CONTACTS, {}), CONTACTS);
  assert.deepEqual(applyRetrievalToContacts([], REL), []);
});

test("retrieval that matched nobody we hold leaves the list untouched", () => {
  const out = applyRetrievalToContacts(CONTACTS, {
    contactIds: ["someone-else"],
    factsByContact: { "someone-else": [{ text: "x" }] },
  });
  assert.deepEqual(out, CONTACTS);
});

test("narrow:true on a result matching nobody also leaves the list untouched", () => {
  // Narrowing to zero would hand the ranker nothing and produce "I found
  // nobody" for a question about a contact that simply has no facts yet.
  const out = applyRetrievalToContacts(CONTACTS, {
    contactIds: ["ghost"], factsByContact: {},
  }, { narrow: true });
  assert.deepEqual(out, CONTACTS);
});

test("the original contact objects are not mutated", () => {
  const before = JSON.parse(JSON.stringify(CONTACTS));
  applyRetrievalToContacts(CONTACTS, REL);
  assert.deepEqual(CONTACTS, before);
});
