import test from "node:test";
import assert from "node:assert/strict";
import { fallbackSuggestions, withSuggestionFloor } from "./suggestion-floor.js";

const PEOPLE = [
  { contactId: "11111111-1111-1111-1111-111111111111", name: "Drew Dunson" },
  { contactId: "22222222-2222-2222-2222-222222222222", name: "Muriel Goldfarb" },
];

test("nothing is invented: every chip names someone or somewhere the turn had", () => {
  const chips = fallbackSuggestions({ people: PEOPLE, places: [{ name: "Mala Chinese Cuisine" }] });
  const text = JSON.stringify(chips);
  assert.match(text, /Drew/);
  assert.match(text, /Mala Chinese Cuisine/);
  for (const c of chips) {
    if (c.type === "draft_message") assert.ok(c.contactId, "a draft chip must carry a real contact");
    if (c.type === "create_circle") assert.ok(c.contactIds.length >= 2);
  }
});

test("a turn with nobody and nowhere still offers a next step", () => {
  const chips = fallbackSuggestions({ message: "I should really get my taxes done" });
  assert.equal(chips.length, 1);
  assert.equal(chips[0].type, "follow_up");
});

test("a turn with nothing at all offers nothing rather than a hollow chip", () => {
  assert.deepEqual(fallbackSuggestions({}), []);
});

test("the floor tops up to three without displacing the model's own", () => {
  const mine = [{ type: "share_note", label: "Send this to someone" }];
  const out = withSuggestionFloor(mine, { people: PEOPLE });
  assert.ok(out.length >= 3, `expected at least 3, got ${out.length}`);
  assert.equal(out[0].label, "Send this to someone", "the existing chips stay first");
  assert.ok(out.length <= 5);
});

test("a model that did its job is left alone", () => {
  const mine = [
    { type: "share_note", label: "a" },
    { type: "follow_up", label: "b", prompt: "b" },
    { type: "follow_up", label: "c", prompt: "c" },
  ];
  assert.deepEqual(withSuggestionFloor(mine, { people: PEOPLE }), mine);
});

test("two people get the coordinating chip, one person gets the message chip", () => {
  const two = fallbackSuggestions({ people: PEOPLE }).map((c) => c.type);
  assert.ok(two.includes("create_circle"));
  const one = fallbackSuggestions({ people: [PEOPLE[0]] }).map((c) => c.type);
  assert.ok(!one.includes("create_circle"));
  assert.ok(one.includes("draft_message"));
});
