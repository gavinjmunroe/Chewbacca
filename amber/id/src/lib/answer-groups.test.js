/**
 * The gate and the sanitiser are the whole risk surface here: the model call is
 * fail-closed, so what matters is that a bad or hostile response can never put a
 * person under a heading the answer did not put them under.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { groupAnswerPeople, looksSectioned, MIN_PEOPLE_TO_GROUP } from "./answer-groups.js";

const PEOPLE = [
  { contactId: "11", name: "Ravi Menon" },
  { contactId: "22", name: "Priya Shah" },
  { contactId: "33", name: "Dev Kapoor" },
  { contactId: "44", name: "Mia Chen" },
];

const SECTIONED = `## Worth calling about the raise

Ravi and Priya have both raised at this stage.

## Just a catch-up

Dev and Mia you simply owe a note.`;

const okResponse = (body) => async () => ({
  ok: true,
  json: async () => ({ content: [{ text: JSON.stringify(body) }] }),
});

test("the cheap gate rejects answers that are not sectioned", () => {
  assert.equal(looksSectioned("Ravi and Priya both work in climate."), false);
  assert.equal(looksSectioned(""), false);
  assert.equal(looksSectioned(null), false);
  // Long but a single flowing paragraph.
  assert.equal(looksSectioned("Ravi is the one to call. ".repeat(12)), false);
});

test("the cheap gate accepts every real sectioning signal", () => {
  const pad = " Some more prose to clear the length floor, which exists so a two line answer never spends a model call.";
  assert.equal(looksSectioned(SECTIONED), true);
  assert.equal(looksSectioned(`- Ravi\n- Priya\n- Dev${pad}`), true);
  assert.equal(looksSectioned(`1. Ravi\n2. Priya${pad}`), true);
  assert.equal(looksSectioned(`**For the raise**: Ravi and Priya.${pad}`), true);
  assert.equal(looksSectioned(`People to call:\nRavi and Priya.${pad}`), true);
  assert.equal(looksSectioned(`One.${pad}\n\nTwo.${pad}\n\nThree.${pad}`), true);
});

test("fewer than the minimum people never spends a call", async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    throw new Error("should not be reached");
  };
  const out = await groupAnswerPeople({
    answer: SECTIONED,
    people: PEOPLE.slice(0, MIN_PEOPLE_TO_GROUP - 1),
    fetchImpl,
  });
  assert.equal(out, null);
  assert.equal(called, false);
});

test("an unsectioned answer never spends a call", async () => {
  let called = false;
  const out = await groupAnswerPeople({
    answer: "Ravi, Priya, Dev and Mia all work in climate.",
    people: PEOPLE,
    fetchImpl: async () => {
      called = true;
      return { ok: true, json: async () => ({}) };
    },
  });
  assert.equal(out, null);
  assert.equal(called, false);
});

test("a clean response becomes groups of real contact ids", async (t) => {
  t.after(() => delete process.env.ANTHROPIC_API_KEY);
  process.env.ANTHROPIC_API_KEY = "test-key";
  const out = await groupAnswerPeople({
    answer: SECTIONED,
    people: PEOPLE,
    fetchImpl: okResponse([
      { label: "Worth calling about the raise:", note: "Both have raised at this stage.", ids: ["1", "2"] },
      { label: "Just a catch-up", ids: ["3", "4"] },
    ]),
  });
  assert.equal(out.length, 2);
  // Trailing punctuation is stripped from the label.
  assert.equal(out[0].label, "Worth calling about the raise");
  assert.equal(out[0].note, "Both have raised at this stage.");
  assert.deepEqual(out[0].people, [
    { id: "11", name: "Ravi Menon" },
    { id: "22", name: "Priya Shah" },
  ]);
  assert.equal(out[1].note, undefined);
  assert.deepEqual(out[1].people.map((p) => p.id), ["33", "44"]);
});

test("an invented index is dropped, never rendered", async (t) => {
  t.after(() => delete process.env.ANTHROPIC_API_KEY);
  process.env.ANTHROPIC_API_KEY = "test-key";
  const out = await groupAnswerPeople({
    answer: SECTIONED,
    people: PEOPLE,
    fetchImpl: okResponse([
      { label: "Group one", ids: ["1", "2"] },
      { label: "Group two", ids: ["3", "99", "not-a-number", "4"] },
    ]),
  });
  assert.deepEqual(out[1].people.map((p) => p.id), ["33", "44"]);
});

test("a person claimed twice appears once, in the first group", async (t) => {
  t.after(() => delete process.env.ANTHROPIC_API_KEY);
  process.env.ANTHROPIC_API_KEY = "test-key";
  const out = await groupAnswerPeople({
    answer: SECTIONED,
    people: PEOPLE,
    fetchImpl: okResponse([
      { label: "Group one", ids: ["1", "2"] },
      { label: "Group two", ids: ["1", "3", "4"] },
    ]),
  });
  assert.deepEqual(out[0].people.map((p) => p.id), ["11", "22"]);
  assert.deepEqual(out[1].people.map((p) => p.id), ["33", "44"]);
});

test("one group covering everyone is the flat list, so it returns null", async (t) => {
  t.after(() => delete process.env.ANTHROPIC_API_KEY);
  process.env.ANTHROPIC_API_KEY = "test-key";
  const out = await groupAnswerPeople({
    answer: SECTIONED,
    people: PEOPLE,
    fetchImpl: okResponse([{ label: "Everyone", ids: ["1", "2", "3", "4"] }]),
  });
  assert.equal(out, null);
});

test("a grouping that places barely anyone returns null", async (t) => {
  t.after(() => delete process.env.ANTHROPIC_API_KEY);
  process.env.ANTHROPIC_API_KEY = "test-key";
  // Two groups, but only 1 of 4 people placed — rendering this would silently
  // drop three cards the answer talked about.
  const out = await groupAnswerPeople({
    answer: SECTIONED,
    people: PEOPLE,
    fetchImpl: okResponse([
      { label: "Group one", ids: ["1"] },
      { label: "Group two", ids: ["bogus"] },
    ]),
  });
  assert.equal(out, null);
});

test("every failure mode falls back to the flat list", async (t) => {
  t.after(() => delete process.env.ANTHROPIC_API_KEY);
  process.env.ANTHROPIC_API_KEY = "test-key";
  const cases = [
    async () => ({ ok: false, json: async () => ({}) }),
    async () => ({ ok: true, json: async () => ({ content: [{ text: "not json at all" }] }) }),
    async () => ({ ok: true, json: async () => ({ content: [{ text: "[{oops" }] }) }),
    async () => ({ ok: true, json: async () => ({ content: [{ text: "[]" }] }) }),
    async () => ({ ok: true, json: async () => ({}) }),
    async () => {
      throw new Error("network down");
    },
  ];
  for (const fetchImpl of cases) {
    assert.equal(
      await groupAnswerPeople({ answer: SECTIONED, people: PEOPLE, fetchImpl }),
      null,
    );
  }
});

test("no api key means no call and no groups", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  let called = false;
  const out = await groupAnswerPeople({
    answer: SECTIONED,
    people: PEOPLE,
    fetchImpl: async () => {
      called = true;
      return { ok: true, json: async () => ({}) };
    },
  });
  assert.equal(out, null);
  assert.equal(called, false);
});

test("people with no contactId are not groupable", async () => {
  const out = await groupAnswerPeople({
    answer: SECTIONED,
    people: [{ name: "Ravi" }, { name: "Priya" }, { name: "Dev" }],
    fetchImpl: async () => {
      throw new Error("should not be reached");
    },
  });
  assert.equal(out, null);
});
