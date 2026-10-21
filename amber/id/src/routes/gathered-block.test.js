/**
 * THE BRIDGE BETWEEN THE RETRIEVAL AND THE ANSWER, WHICH HAD NO TEST.
 *
 * Run with the rest: npm test
 *
 * renderGathered turns everything gatherEverything found into the block of text
 * the model reads before it writes a word. Every retrieval fix in the app is
 * worth exactly what this function does with it, and it was never once
 * rendered by a test. Two bugs were sitting in it, both found by printing the
 * block against a real database and reading it:
 *
 *   1. The thin instruction -- the one that fires on precisely the turns that
 *      came back empty, where the wording matters most -- contained LEAKED
 *      JAVASCRIPT SOURCE. It was written inside a template literal as
 *      `a short "I " +` / `"don't have that"`, so what reached the model was
 *      the concatenation verbatim, quotes and plus sign and all.
 *
 *   2. `r.matched ?? r.tags` looked like a fallback and could never fire, because
 *      an empty array is not nullish. Combined with a case-folding bug in the
 *      query (see labeledLayer in db/gather.js) every labeled person rendered as
 *      "[tagged ]" while the instruction above told the model to "say how many
 *      and name them".
 *
 * So the assertions here are mostly about the TEXT: that it says what it means,
 * that it never contains source code, and that a person is never described by a
 * blank reason.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { renderGathered } from "./chat.js";

const SHAPE = {
  total: 1198,
  withPhone: 1147,
  withEmail: 244,
  withCompany: 84,
  withSyncedNote: 379,
  withBirthday: 62,
  withTags: 132,
  withAmberNote: 3,
  tags: [
    { tag: "usc", count: 30, examples: ["Arjun"] },
    { tag: "btg", count: 4, examples: ["Shirley Park"] },
  ],
  metros: [{ metro: "New York", count: 101 }],
  titles: [{ title: "Attorney", count: 14 }],
  companies: [{ company: "Stripe", count: 6 }],
};

const gathered = (over = {}) => ({
  terms: ["usc"],
  layers: { stated: [], labeled: [], implied: [] },
  totals: { stated: 0, labeled: 0, implied: 0 },
  aboutTheBook: false,
  shape: SHAPE,
  birthdays: null,
  inventory: {
    searched: ["notes and facts you have saved", "labels written into contact names", "area codes"],
    found: { stated: 0, labeled: 0, implied: 0, birthdays: null, totalContacts: 1198, contactsWithAnyNote: 382 },
    thin: true,
  },
  ...over,
});

// ── the block must never contain code ──────────────────────────────────────

test("no rendered block ever contains leaked JavaScript source", () => {
  // The exact failure: `a short "I " + "don't have that"` shipped to the model
  // on every thin turn. Generalised, because the next one will be a different
  // line: a prompt is prose, so a quote-plus-quote sequence in it is source that
  // escaped a template literal.
  const blocks = [
    renderGathered(gathered(), { message: "who do I know in Boise?" }),
    renderGathered(
      gathered({
        layers: {
          stated: [{ contactId: "1", name: "Maya", where: "note", excerpts: ["Maya moved to New York"] }],
          labeled: [{ contactId: "2", name: "Arjun USC", tags: ["USC"], matched: ["USC"] }],
          implied: [{ contactId: "3", name: "Ted", areaCode: "646", metro: "New York" }],
        },
        totals: { stated: 1, labeled: 1, implied: 1 },
        inventory: { ...gathered().inventory, thin: false },
      }),
      { message: "who do I know in New York?" },
    ),
    renderGathered(gathered({ birthdays: [{ contactId: "1", name: "Nina", month: 9, day: 9 }] }), {
      message: "whose birthday is it today?",
    }),
  ];
  for (const b of blocks) {
    assert.doesNotMatch(b, /"\s*\+/, `a quote followed by '+' is source, not prose:\n${b}`);
    assert.doesNotMatch(b, /\+\s*\n\s*"/, `a '+' at a line end is source, not prose:\n${b}`);
    assert.doesNotMatch(b, /\$\{/, `an uninterpolated \${...} reached the prompt:\n${b}`);
  }
});

test("the thin instruction reads as one sentence a person could have written", () => {
  const b = renderGathered(gathered(), { message: "who do I know in Boise?" });
  assert.match(b, /NOTHING MATCHED/);
  assert.match(b, /Do NOT reply with a short "I don't have that"\./);
  // And it still says what was actually searched, with the zeros.
  assert.match(b, /You searched: notes and facts you have saved/);
  assert.match(b, /Found 0 in what they have said/);
  // And it still asks for something concrete rather than trailing off.
  assert.match(b, /voice note/);
  assert.match(b, /concrete next step/);
});

// ── a person is never listed with a blank reason ────────────────────────────

test("a labeled person is named with the label that matched, as they typed it", () => {
  const b = renderGathered(
    gathered({
      layers: {
        stated: [],
        labeled: [{ contactId: "2", name: "Shirley Park", tags: ["USC", "BTG"], matched: ["USC"] }],
        implied: [],
      },
      totals: { stated: 0, labeled: 1, implied: 0 },
      inventory: { ...gathered().inventory, thin: false },
    }),
    { message: "who goes to USC?" },
  );
  assert.match(b, /Shirley Park.*\[tagged USC\]/);
  assert.doesNotMatch(b, /\[tagged \]/, "a blank reason is worse than no reason");
});

test("an empty matched array falls back to the tags instead of rendering blank", () => {
  // `matched ?? tags` could not do this: [] is not nullish. The query is fixed
  // too, but a renderer that prints "[tagged ]" when handed an empty array is
  // one query change away from doing it again.
  const b = renderGathered(
    gathered({
      layers: { stated: [], labeled: [{ contactId: "2", name: "Nina", tags: ["USC"], matched: [] }], implied: [] },
      totals: { stated: 0, labeled: 1, implied: 0 },
      inventory: { ...gathered().inventory, thin: false },
    }),
    { message: "usc?" },
  );
  assert.match(b, /Nina.*\[tagged USC\]/);
  assert.doesNotMatch(b, /\[tagged \]/);
});

test("a person with no tags at all is listed without an empty bracket", () => {
  const b = renderGathered(
    gathered({
      layers: { stated: [], labeled: [{ contactId: "2", name: "Nina", tags: [], matched: [] }], implied: [] },
      totals: { stated: 0, labeled: 1, implied: 0 },
      inventory: { ...gathered().inventory, thin: false },
    }),
    { message: "usc?" },
  );
  assert.match(b, /- Nina/);
  assert.doesNotMatch(b, /\[tagged/);
});

// ── the block never claims to know nothing ─────────────────────────────────

test("the header forbids the answer that started all of this", () => {
  const b = renderGathered(gathered(), { message: "anything" });
  assert.match(b, /NEVER say you have no information/);
});

test("even a thin turn carries the real numbers, so the reply has something true in it", () => {
  const b = renderGathered(gathered(), { message: "who do I know in Boise?" });
  assert.match(b, /1198 contacts/);
  assert.match(b, /30 tagged "usc"/);
  assert.match(b, /101 in New York/);
});

test("no shape means no block, rather than a block asserting an empty book", () => {
  assert.equal(renderGathered({ ...gathered(), shape: null }, { message: "x" }), "");
  assert.equal(renderGathered(null, { message: "x" }), "");
});
