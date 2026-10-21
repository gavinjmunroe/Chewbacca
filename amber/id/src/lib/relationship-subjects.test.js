/**
 * "MY DAD" IS A PERSON, ONE PERSON GETS ONE CARD, AND A SELF-FACT HAS A FLOOR.
 *
 * Run with the rest: npm test
 *
 * Three failures from one user's first ten minutes with the app, each pinned
 * here by the sentence that caused it.
 *
 * 1. HIS DAD'S CARD NEVER APPEARED. He said "My dad, Karthik, Sagar, and Joel
 *    from A2F are all cool people" and the log read:
 *
 *      FACT_CAP_SIGNALS count=2 routes=self_fact,fact subjects=self;Sagar
 *      FACT_SELF owner=... category=personality
 *
 *    "my dad" was filed as a fact about HIM. The extractor's schema said
 *    `Use "self" for the speaker (I/me/my)`, the phrase contains "my", and that
 *    was the whole bug. It cost the person the sentence was about AND wrote a
 *    stranger's trait into the one record every future prompt reads back.
 *
 * 2. SHIRLEY APPEARED TWICE. "Shirley Park BTG USC are all good people" wrote
 *    two correct facts about one contact (category=personality, category=who)
 *    and the turn rendered one card per fact.
 *
 * 3. "I AM A TERRORIST." was captured as a durable self identity fact, while
 *    "I kill orphans." and "I'm gonna bomb Weeview Library." captured nothing.
 *    The inconsistency is the tell: nothing was deciding anything.
 *
 * These test the DETERMINISTIC layer only — the routing, the collapse, the
 * refusal. The model prompt was fixed too and cannot be asserted here without a
 * network call, which is exactly why the code guard exists: a prompt is a
 * request, and this is a rule.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  relationshipSubject,
  routeSignal,
  refusesAsSelfFact,
} from "./fact-capture.js";
import { collapseCapturedByPerson } from "../routes/chat.js";

/** A complete signal, so each test can vary one field and nothing else. */
function signal(over = {}) {
  return {
    subjects: ["Sagar"],
    content: "Sagar is a cool person",
    proposed_type: "fact",
    is_shared_event: false,
    is_single_trait: true,
    is_field_update: false,
    category: "personality",
    sentiment: "positive",
    sentiment_strength: 0.7,
    certainty: 1.0,
    is_past: false,
    weight: 0.5,
    is_conditional: false,
    condition: "",
    ...over,
  };
}

// ── relationshipSubject ──────────────────────────────────────────────────────

test("a possessive relationship phrase names the person, capitalized", () => {
  assert.equal(relationshipSubject("my dad"), "Dad");
  assert.equal(relationshipSubject("My Dad"), "Dad");
  assert.equal(relationshipSubject("our mom"), "Mom");
  assert.equal(relationshipSubject("my girlfriend"), "Girlfriend");
  assert.equal(relationshipSubject("my mother-in-law"), "Mother-In-Law");
  // Bare, with no possessive: still the speaker's dad in every sentence a
  // person actually says, and it resolves to the same contact.
  assert.equal(relationshipSubject("dad"), "Dad");
  assert.equal(relationshipSubject("mom."), "Mom");
});

test("a real name is left completely alone", () => {
  for (const name of ["Sagar", "Karthik", "Shirley Park", "Duncan Inganji", "self"]) {
    assert.equal(relationshipSubject(name), null, name);
  }
});

test("a possessive chain is NOT guessed at", () => {
  // Who "my dad's boss" is, is a question this cannot answer, and a wrong guess
  // files a fact against the wrong human. Left alone on purpose.
  assert.equal(relationshipSubject("my dad's boss"), null);
  assert.equal(relationshipSubject("Sagar's brother"), null);
  assert.equal(relationshipSubject("my old roommate from college"), null);
});

// ── routing ──────────────────────────────────────────────────────────────────

test("a fact about my dad routes to that person, never to self", () => {
  const r = routeSignal(signal({ subjects: ["my dad"], content: "Dad is a very cool person" }));
  assert.equal(r.route, "fact", "must be a fact about a contact, not a self_fact");
  assert.deepEqual(r.subjects, ["Dad"]);
});

test("the model saying \"self\" does not survive a sentence about a relative", () => {
  // THE EXACT SHAPE THAT SHIPPED: subjects:["self"] with content the model
  // itself wrote as being about someone else.
  const r = routeSignal(signal({ subjects: ["self"], content: "my dad is a cool person" }));
  assert.equal(r.route, "fact");
  assert.deepEqual(r.subjects, ["Dad"]);

  const r2 = routeSignal(signal({ subjects: ["self"], content: "the user's mom moved to Austin" }));
  assert.equal(r2.route, "fact");
  assert.deepEqual(r2.subjects, ["Mom"]);
});

test("a statement genuinely about the speaker is still a self fact", () => {
  for (const content of [
    "moved to Austin",
    "is exhausted this week",
    "works at Stripe",
    "is focusing on Amber",
  ]) {
    const r = routeSignal(signal({ subjects: ["self"], content }));
    assert.equal(r.route, "self_fact", content);
    assert.deepEqual(r.subjects, ["self"], content);
  }
});

test("a shared experience with a relative keeps the speaker in it", () => {
  // "I had dinner with my dad" is two participants, one of whom IS the speaker.
  // The backstop must not strip self out of a shared event.
  const r = routeSignal(
    signal({
      subjects: ["my dad", "self"],
      content: "Dad and the user had dinner together",
      is_shared_event: true,
      is_single_trait: false,
    }),
  );
  assert.equal(r.route, "experience");
  assert.deepEqual(r.subjects, ["Dad", "self"]);
});

test("a signal with no subjects or no content is rejected", () => {
  assert.equal(routeSignal(signal({ subjects: [] })), null);
  assert.equal(routeSignal(signal({ content: "   " })), null);
});

// ── one person, one card ─────────────────────────────────────────────────────

test("two facts about one contact collapse into one card carrying both", () => {
  // The real payload from "Shirley Park BTG USC are all good people".
  const collapsed = collapseCapturedByPerson([
    { route: "fact", contactId: "b474121a", name: "Shirley Park", factId: "f1", text: "Shirley Park is a good person", isSelf: false, participantIds: [] },
    { route: "fact", contactId: "b474121a", name: "Shirley Park", factId: "f2", text: "Shirley Park is at BTG USC", isSelf: false, participantIds: [] },
  ]);
  assert.equal(collapsed.length, 1, "Shirley must appear once");
  assert.equal(collapsed[0].name, "Shirley Park");
  assert.deepEqual(collapsed[0].texts, [
    "Shirley Park is a good person",
    "Shirley Park is at BTG USC",
  ]);
  assert.equal(collapsed[0].text, "Shirley Park is a good person", "the primary line is preserved");
});

test("different people keep their own cards, in the order they first appeared", () => {
  const collapsed = collapseCapturedByPerson([
    { route: "fact", contactId: "k", name: "Karthik", text: "Karthik is good", isSelf: false },
    { route: "fact", contactId: "s", name: "Sagar", text: "Sagar is good", isSelf: false },
    { route: "fact", contactId: "k", name: "Karthik", text: "Karthik is at BMA", isSelf: false },
    { route: "fact", contactId: "d", name: "Dad", text: "Dad is cool", isSelf: false },
  ]);
  assert.deepEqual(collapsed.map((c) => c.name), ["Karthik", "Sagar", "Dad"]);
  assert.equal(collapsed[0].texts.length, 2);
});

test("every self fact in a turn is one card", () => {
  const collapsed = collapseCapturedByPerson([
    { route: "self_fact", contactId: null, isSelf: true, name: "You", text: "is focusing on Amber" },
    { route: "self_fact", contactId: null, isSelf: true, name: "You", text: "is a cool person" },
  ]);
  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0].name, "You");
  assert.equal(collapsed[0].texts.length, 2);
});

test("a note or experience is an event, not a person, and never merges", () => {
  // Two gatherings with overlapping participants are two things that happened.
  const rows = [
    { route: "experience", contactId: null, isSelf: false, participantIds: ["a", "b"], text: "dinner" },
    { route: "experience", contactId: null, isSelf: false, participantIds: ["a", "b"], text: "concert" },
  ];
  assert.equal(collapseCapturedByPerson(rows).length, 2);
});

test("participants merge additively when one contact's signals name others", () => {
  const collapsed = collapseCapturedByPerson([
    { route: "fact", contactId: "x", isSelf: false, participantIds: ["a"], text: "one" },
    { route: "fact", contactId: "x", isSelf: false, participantIds: ["b"], text: "two" },
  ]);
  assert.equal(collapsed.length, 1);
  assert.deepEqual([...collapsed[0].participantIds].sort(), ["a", "b"]);
});

test("collapsing is safe on junk", () => {
  assert.deepEqual(collapseCapturedByPerson(null), []);
  assert.deepEqual(collapseCapturedByPerson([]), []);
});

// ── the self-fact floor ──────────────────────────────────────────────────────

test("a durable self-claim of violence is refused", () => {
  for (const t of [
    "is a terrorist",
    "I am a terrorist",
    "I'm a serial killer",
    "I kill orphans",
    "kills children",
    "is going to bomb the library",
    "wants to shoot up a school",
  ]) {
    assert.equal(refusesAsSelfFact(t), true, `should refuse: ${t}`);
  }
});

test("ordinary self-facts are untouched", () => {
  for (const t of [
    "moved to Austin",
    "is exhausted this week",
    "works at Stripe",
    "is focusing on Amber",
    "loves Mexican food",
    "is training for a marathon",
    "went to a concert with Bo",
    // Adjacent language that is not a self-claim of violence. A checker that
    // fires on these is a checker that eats real notes.
    "is reading a book about terrorism",
    "watched a documentary about a serial killer",
    "is a killer at chess",
    "works in criminal defense",
  ]) {
    assert.equal(refusesAsSelfFact(t), false, `should allow: ${t}`);
  }
});
