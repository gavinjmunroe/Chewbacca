/**
 * Place cards.
 *
 * The contract that matters is the REFUSAL: no rating, no review count, no hours,
 * ever, and no aggregator links. Those are the fields a model will happily invent and
 * the ones a user would never think to doubt.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { placeQueryFor, wantsPlaces, venueNameIn } from "./place-search.js";

test("wants places only when there is an outing AND an intent to plan it", () => {
  for (const m of [
    "I'm planning a dinner in Williamsburg with three friends, thinking Asian food",
    "Where should we get drinks in SoHo tonight?",
    "Looking for a good brunch spot near the office",
    "Can you find a restaurant for Thursday?",
    "Thinking of booking a table for six",
  ]) {
    assert.equal(wantsPlaces(m), true, `should want places: ${m}`);
  }
});

test("does NOT fire on a note that merely mentions food or people", () => {
  for (const m of [
    "Had dinner with Sagar last night, he is raising a seed round",
    "Sam loves Thai food",
    "I'm traveling to San Francisco to fundraise with Sagar",
    "Remind me to email Priya",
    "coffee",
    "",
    null,
  ]) {
    assert.equal(wantsPlaces(m), false, `should NOT want places: ${m}`);
  }
});

// A PLAN AND A MEMORY SHARE EVERY WORD BUT ONE.
//
// These are written as pairs on purpose: each line here differs from its partner
// above only in the tense marker. If the gate ever loosens, this is the test that
// catches it — the failure mode is a voice note about last night's dinner
// triggering a web search for restaurants.
test("a past-time marker vetoes an otherwise perfect planning sentence", () => {
  const pairs = [
    ["We should find a place to eat in Williamsburg", "We should find a place to eat in Williamsburg last night"],
    ["Let's do brunch somewhere in Fort Greene", "We did brunch somewhere in Fort Greene the other day"],
    ["Looking for a quiet bar near Union Square", "Priya told me about a quiet bar near Union Square last week"],
  ];
  for (const [plan, memory] of pairs) {
    assert.equal(wantsPlaces(plan), true, `plan: ${plan}`);
    assert.equal(wantsPlaces(memory), false, `memory: ${memory}`);
  }
});

// "want to" alone is not planning language, because the most common thing it
// introduces in this app is an instruction to store a fact.
test("an instruction to remember a fact about food is not a request for places", () => {
  for (const m of [
    "Remember that Priya loves Thai food",
    "Note that Dev is allergic to shellfish",
    "I want to remember that Sam's favorite restaurant is Lilia",
  ]) {
    assert.equal(wantsPlaces(m), false, `should NOT want places: ${m}`);
  }
});

// Casual phrasings a person actually uses out loud. The first gate caught
// "planning" and "where should"; a voice note rarely sounds that formal.
test("spoken phrasings of an open decision still count", () => {
  for (const m of [
    "Let's do brunch with Priya somewhere in Fort Greene",
    "In the mood for Korean food tonight",
    "We should find a place to eat before the show",
    "Any recommendations for a quiet bar near Union Square?",
    "Wanna grab dinner in Greenpoint",
  ]) {
    assert.equal(wantsPlaces(m), true, `should want places: ${m}`);
  }
});

// ── A PLACE IS ANY PLACE ─────────────────────────────────────────────────────
//
// This started as a restaurant search, so "where can I work from in Brooklyn" and
// "find me a library near Stanford" got prose and no cards for no reason other
// than the noun. The two halves have different gates on purpose: somewhere you GO
// OUT to still needs an intent to plan it, because "dinner" is a memory as often
// as a plan. Somewhere you LOOK UP does not — nobody says "library" reminiscing.
test("a place you look up needs no planning language", () => {
  for (const m of [
    'find me a library near Stanford',
    'looking for a coworking space in SoHo',
    'best museums in San Francisco',
    'is there a gym near Union Square',
    'where can I work from in Brooklyn',
    'show me event spaces for 40 people in NYC',
    'recommend a good bookstore in the Mission',
    'where is Stripe headquarters',
  ]) {
    assert.equal(wantsPlaces(m), true, `should want places: ${m}`);
  }
});

test("plurals count, which is how museums and event spaces were missed", () => {
  // The alternation was written in the singular with a word boundary welded to the
  // end, so "museum" matched and "museums" did not.
  assert.equal(wantsPlaces('best museums in San Francisco'), true);
  assert.equal(wantsPlaces('find galleries in Chelsea'), true);
  assert.equal(wantsPlaces('any good climbing gyms in Oakland'), true);
});

test("the past-tense veto still wins over a lookup noun", () => {
  // A place noun does not make a memory into a request.
  assert.equal(wantsPlaces('Alex went to the library last week'), false);
  assert.equal(wantsPlaces('remember that Sam works at an office'), false);
});

test("the search query names the kind of place being asked about", () => {
  // It used to have "restaurants" welded on, so a question about libraries asked
  // Exa for restaurants and got restaurants back.
  assert.match(placeQueryFor('planning a dinner in Williamsburg'), /restaurants/);
  assert.match(placeQueryFor('find me a library near Stanford'), /places/);
  assert.doesNotMatch(placeQueryFor('find me a library near Stanford'), /restaurants/);
});

// A PLAN THAT IS ALREADY MADE IS STILL A PLAN.
//
// Every planning verb in the gate assumes the user is still choosing. Someone who
// says "I'm supposed to be going to Mala Chinese Cuisine" has chosen, so none of
// them fire -- and that is the case where we know the most and can help the most.
test("a named venue is enough on its own, with no planning verb", () => {
  for (const m of [
    "I'm supposed to be going to Mala Chinese Cuisine for dinner this week",
    "Dinner at Lilia on Thursday with Priya",
    "We have a reservation at Gage and Tollner",
  ]) {
    assert.equal(wantsPlaces(m), true, `should want places: ${m}`);
  }
});

test("the named venue, not the whole sentence, is what gets searched for", () => {
  const q = placeQueryFor("I'm supposed to be going to Mala Chinese Cuisine for dinner with Meet and AJ");
  assert.match(q, /Mala Chinese Cuisine/);
  // The point of the change: not a search for Sichuan restaurants in general.
  assert.doesNotMatch(q, /Meet and AJ/);
});

test("a destination is not a venue", () => {
  // Same grammatical shape, no outing noun anywhere -- the message is about
  // travel, not about going somewhere in particular.
  assert.equal(venueNameIn("I'm traveling to San Francisco to fundraise with Sagar"), null);
  assert.equal(venueNameIn("Moving to Brooklyn next month"), null);
  // And a person after the preposition is never a venue.
  assert.equal(venueNameIn("Grabbing dinner, talked to Sagar about it"), null);
});
