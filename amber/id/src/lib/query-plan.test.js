/**
 * THE THREE-PART QUESTION, AND EVERYTHING IT MUST NOT BREAK.
 *
 * The first test is the sentence this planner was written for, and it asserts
 * the order out loud -- network, then strangers, then places -- because the
 * order was got wrong once by reasoning about it instead of measuring it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  planQuery,
  splitAsks,
  laneForAsk,
  shortAsk,
  asksAboutTheirDay,
  orientationAsk,
} from "./query-plan.js";
import { _resetLaneSpeeds, recordLaneMs, orderLanesBySpeed } from "./lane-speed.js";
import { wantsPlaces } from "./place-search.js";

const THREE_PART =
  "Recommend coffee shops in the East Village, tell me who I know nearby, and find me VPs of engineering to talk to about hardware";

test("the three-part question splits into three asks with three lanes", () => {
  _resetLaneSpeeds();
  const p = planQuery(THREE_PART);
  assert.equal(p.multi, true);
  assert.deepEqual(
    p.lanes.map((l) => l.key),
    ["people", "web_people", "places"],
    "fastest first: his own people, then LinkedIn, then places (Exa + a model pass)",
  );
  assert.equal(p.intent, "both");
  assert.equal(p.routerNeeded, false, "one intent cannot describe three asks");
  assert.equal(p.needsPeople, true);
  assert.equal(p.needsWeb, true);
  assert.equal(p.needsPlaces, true);
  assert.equal(p.needsWebPeople, true);
});

test("each lane is asked only about its own part of the question", () => {
  const p = planQuery(THREE_PART);
  const places = p.laneQuery("places");
  const strangers = p.laneQuery("web_people");
  const people = p.laneQuery("people");
  assert.match(places, /coffee shops/i);
  assert.doesNotMatch(places, /VPs of engineering/i, "the place search must not be asked about VPs");
  assert.match(strangers, /VPs of engineering/i);
  assert.doesNotMatch(strangers, /coffee/i, "the LinkedIn pass must not be asked about coffee");
  assert.match(people, /who I know/i);
  // The web grounding query carries the world-facing asks and NOT the network one.
  assert.doesNotMatch(p.webGroundingQuery, /who I know/i);
  assert.match(p.webGroundingQuery, /coffee/i);
});

test("a trailing qualifier stays with the ask it qualifies", () => {
  // "to talk to about hardware" is not a fourth ask.
  const p = planQuery(THREE_PART);
  assert.equal(p.lanes.length, 3);
  assert.match(p.laneQuery("web_people"), /hardware/i);
});

test("a question entirely about his own people spends no web call", () => {
  const p = planQuery("who do I know in fintech");
  assert.equal(p.networkOnly, true);
  assert.equal(p.needsWeb, false);
  assert.equal(p.needsPlaces, false);
  assert.equal(p.needsWebPeople, false);
  // The classifier still runs: it returns the structured filters this cannot.
  assert.equal(p.routerNeeded, true);
});

test("a question entirely about the world never claims a people lane", () => {
  const p = planQuery("list me ten VPs of finance in New York");
  assert.equal(p.needsPeople, false, "the address book cannot contain the answer");
  assert.equal(p.needsWebPeople, true);
  assert.equal(p.routerNeeded, false);
  assert.equal(p.intent, "chat");
});

test("a place question is decided in code", () => {
  const p = planQuery("best cafe with wifi in the West Village");
  assert.equal(p.needsPlaces, true);
  assert.equal(p.needsWeb, true);
  assert.equal(p.needsPeople, false);
  assert.equal(p.routerNeeded, false);
});

test("a possessive in a place question does not make it a people question", () => {
  // "my" is in half the sentences anybody types.
  assert.equal(laneForAsk("recommend a coffee shop near my apartment"), "places");
  const p = planQuery("recommend a coffee shop near my apartment");
  assert.equal(p.needsPeople, false);
});

test("ordinary conversation is left to the classifier", () => {
  for (const m of ["hi", "what can you do", "thanks", "I'm building a deck in my backyard, any tips?"]) {
    const p = planQuery(m);
    assert.equal(p.routerNeeded, true, m);
    assert.equal(p.lanes.length === 0 || p.needsPeople === false || p.multi === false, true, m);
  }
});

test("a weak web hint alone does not pre-empt the classifier", () => {
  // The router's rules for what needs the web are richer than this regex.
  const p = planQuery("what is the best way to learn Rust");
  assert.equal(p.routerNeeded, true);
});

test("a spoken note keeps its place cards", () => {
  // "Dinner at Mala with Meet and AJ" is the typical spoken note, and the cards
  // under it are the venue it named -- not a search of anything.
  const p = planQuery("dinner at Mala Chinese Cuisine with Meet and AJ on Friday", { isVoice: true });
  assert.equal(p.needsPlaces, true);
  assert.match(p.laneQuery("places"), /Mala/);
  assert.equal(p.needsPeople, false, "still not a ranker pass over the address book");
  assert.equal(p.needsWeb, false);
  assert.equal(p.needsWebPeople, false);
});

test("a spoken note is never a search", () => {
  const p = planQuery("had coffee with Sagar in the East Village and he is raising a seed round", {
    isVoice: true,
  });
  assert.equal(p.needsPeople, false);
  assert.equal(p.needsWeb, false);
  assert.equal(p.needsPlaces, false);
  assert.equal(p.intent, "chat");
  assert.equal(p.routerNeeded, false);
});

test("a pasted link is decisive and keeps a network ask in the same breath", () => {
  const p = planQuery("read https://example.com/post and tell me who I know who would care", {
    pastedUrls: ["https://example.com/post"],
  });
  assert.equal(p.routerNeeded, false);
  assert.equal(p.needsWeb, true);
  assert.equal(p.intent, "both", "the old shortcut threw the network ask away");
  assert.equal(p.needsPeople, true);
});

test("two asks in the same lane become one call, not two", () => {
  const p = planQuery("find me VPs of engineering, and also find me heads of product");
  assert.equal(p.lanes.length, 1);
  assert.equal(p.lanes[0].key, "web_people");
  assert.match(p.laneQuery("web_people"), /engineering/i);
  assert.match(p.laneQuery("web_people"), /product/i);
});

test("'and' inside one ask does not split it", () => {
  const asks = splitAsks("find me VPs of engineering and product in New York");
  assert.equal(asks.length, 1, asks.join(" | "));
});

test("two asks, network and places, order network first", () => {
  _resetLaneSpeeds();
  const p = planQuery("where should I get dinner in Williamsburg, and who do I know there");
  assert.deepEqual(p.lanes.map((l) => l.key), ["people", "places"]);
  assert.equal(p.intent, "both");
  assert.equal(p.routerNeeded, false);
});

test("the order follows measured speed, not the order in the file", () => {
  _resetLaneSpeeds();
  const before = orderLanesBySpeed([{ key: "places" }, { key: "people" }]).map((l) => l.key);
  assert.deepEqual(before, ["people", "places"]);
  // A run where the address book is enormous and the place cards come back fast.
  for (let i = 0; i < 12; i++) {
    recordLaneMs("people", 14000);
    recordLaneMs("places", 900);
  }
  const after = orderLanesBySpeed([{ key: "places" }, { key: "people" }]).map((l) => l.key);
  assert.deepEqual(after, ["places", "people"], "it reorders when reality changes");
  _resetLaneSpeeds();
});

test("nonsense durations are ignored rather than smoothed in", () => {
  _resetLaneSpeeds();
  const seed = orderLanesBySpeed([{ key: "people" }])[0];
  assert.ok(seed);
  recordLaneMs("people", 0);
  recordLaneMs("people", -5);
  recordLaneMs("people", 900000); // a turn that hit its deadline says nothing
  const after = orderLanesBySpeed([{ key: "places" }, { key: "people" }]).map((l) => l.key);
  assert.deepEqual(after, ["people", "places"]);
});

test("empty and whitespace messages do not produce lanes", () => {
  for (const m of ["", "   ", null, undefined]) {
    const p = planQuery(m);
    assert.equal(p.lanes.length, 0);
    assert.equal(p.needsPeople, false);
    assert.equal(p.needsWeb, false);
  }
});

test("a place signal only the whole sentence carries is not lost to a comma", () => {
  // Neither half of this is a place question on its own.
  const p = planQuery("I want to find somewhere to work from, maybe in SoHo");
  const whole = p.needsPlaces;
  // Whatever wantsPlaces() says about the whole sentence, the plan must agree:
  // the planner is never allowed to be narrower than the gate it replaced.
  assert.equal(whole, wantsPlaces("I want to find somewhere to work from, maybe in SoHo"));
  if (whole) assert.match(p.laneQuery("places"), /SoHo/);
});

test("a lane inferred from the whole sentence does not skip the classifier", () => {
  // "which of my contacts likes Chinese food" is a filter search whose filters
  // only the classifier can produce. A food word must not turn it into a
  // decisive two-lane plan and throw those away.
  const p = planQuery("which of my contacts likes Chinese food");
  assert.equal(p.routerNeeded, true);
  assert.equal(p.needsPeople, true);
});

test("each section carries the clause it answers, in his own words", () => {
  _resetLaneSpeeds();
  const p = planQuery(THREE_PART);
  const byKey = Object.fromEntries(p.lanes.map((l) => [l.key, l.ask]));
  assert.match(byKey.places, /coffee shops/i);
  assert.match(byKey.web_people, /VPs of engineering/i);
  assert.match(byKey.people, /who I know/i);
  // Short enough to be a heading, and not a paraphrase.
  for (const ask of Object.values(byKey)) {
    assert.ok(ask.length <= 73, ask);
    assert.ok(THREE_PART.toLowerCase().includes(ask.replace(/…$/, "").slice(0, 20).toLowerCase()), ask);
  }
});

test("the leading filler of a stacked ask is trimmed out of its heading", () => {
  assert.equal(shortAsk("and tell me who I know nearby"), "who I know nearby");
  assert.equal(shortAsk("also find me VPs of engineering"), "find me VPs of engineering");
  assert.equal(shortAsk("   "), null);
  assert.equal(shortAsk(null), null);
});

test("a long clause is cut at a word boundary, not mid-word", () => {
  const long =
    "recommend a couple of good yoga studios or bathhouses in Manhattan that I can go to to unwind";
  const out = shortAsk(long);
  assert.ok(out.endsWith("…"), out);
  assert.ok(out.length <= 73, out);
  assert.ok(!/\s…$/.test(out), "no dangling space before the ellipsis");
  assert.ok(long.startsWith(out.replace(/…$/, "")), out);
});

// ── THE SECOND REAL QUERY, WHICH BROKE BOTH READINGS AT ONCE ────────────────
//
// One clause asks for STRANGERS ("pull up a few names of people that I should
// try and reach out to on LinkedIn... and allow me to add their contact cards")
// and another asks about HIS OWN PEOPLE ("tell me if I have anyone in New York
// that I should just grab a quick bite with... that I haven't seen in a
// minute"). Both contain "I should", and the clause about his own people also
// contains an outing ("grab a quick bite"). Every earlier rule got one of the
// two wrong, and each mistake cost a whole section of the answer.

const REAL_SECOND =
  "After the barbershop, I want to meet a few hardware engineers in Manhattan. If you can " +
  "pull up a few names of people that I should try and reach out to on LinkedIn or email and " +
  "find those modes of contact for me and allow me to add their contact cards here on Amber. " +
  "Just give me three names for that. And then tell me if I have anyone in New York that I " +
  "should just grab a quick bite with tomorrow that I haven't seen in a minute or that's free. " +
  "And then beyond that, recommend a couple good yoga studios or bathhouses in Manhattan that " +
  "I can go to to unwind at the end of the day.";

test("his second real query produces all three lanes, in speed order", () => {
  _resetLaneSpeeds();
  const p = planQuery(REAL_SECOND);
  assert.deepEqual(p.lanes.map((l) => l.key), ["people", "web_people", "places"]);
  assert.equal(p.intent, "both");
  assert.equal(p.needsPeople, true, "the address book must be searched for the catch-up ask");
  assert.equal(p.needsWebPeople, true, "and the web for the strangers ask");
  assert.equal(p.needsPlaces, true);
});

test("and each lane is asked about its own clause", () => {
  const p = planQuery(REAL_SECOND);
  assert.match(p.laneQuery("people"), /anyone in New York/i);
  assert.doesNotMatch(p.laneQuery("people"), /LinkedIn/i);
  assert.match(p.laneQuery("web_people"), /hardware engineers/i);
  assert.doesNotMatch(p.laneQuery("web_people"), /yoga/i);
  assert.match(p.laneQuery("places"), /yoga studios or bathhouses/i);
  assert.doesNotMatch(p.laneQuery("places"), /hardware/i);
});

test("an outing does not turn a question about his own people into a place question", () => {
  // "grab a quick bite" is an outing; "anyone I haven't seen" is the ask.
  assert.equal(
    laneForAsk("tell me if I have anyone in New York I should grab a quick bite with"),
    "network",
  );
  // And with no people word it is not a question about his contacts. (It lands
  // on the weak web hint here rather than on `places`, because wantsPlaces()
  // wants a place noun and "a quick bite" is not one -- either way the address
  // book is not searched, which is the property that matters.)
  assert.notEqual(laneForAsk("where should I grab a quick bite tonight"), "network");
});

test("an explicit stranger marker beats a weak first person", () => {
  assert.equal(
    laneForAsk("pull up a few names of people that I should reach out to on LinkedIn"),
    "web_people",
  );
  assert.equal(laneForAsk("find me a few hardware engineers in Manhattan"), "web_people");
});

test("but a possessive beats a stranger marker", () => {
  // "find me someone in my network" is a question about his network.
  assert.equal(laneForAsk("find me someone in my network who does design"), "network");
  assert.equal(laneForAsk("pull up my contacts in New York"), "network");
});

test("a number is a count, not a claim about whose people they are", () => {
  // This was briefly read as a stranger marker, which sent a question the
  // address book answers better to the open web.
  assert.equal(laneForAsk("give me 3 people who know private equity"), null);
});

test("'I have a meeting tomorrow' is not a question about his contacts", () => {
  // A first-person marker means nothing without a people word in the clause.
  // ("tomorrow" trips the weak web hint, which only means the classifier still
  // runs -- it does not claim a people lane, which is the point.)
  assert.notEqual(laneForAsk("I have a meeting tomorrow"), "network");
  assert.equal(laneForAsk("I should book a flight"), null);
  const p = planQuery("I have a meeting tomorrow");
  assert.equal(p.needsPeople, false);
  assert.equal(p.routerNeeded, true, "a weak hint never decides on its own");
});

// ── BEING TOLD TO SEARCH ─────────────────────────────────────────────────────
//
// "The web search used to work pretty well with Exa. For some reason, that's not
//  working now. It used to return contacts for me and have a nice little add
//  button where I could add them as an Amber contact."
//
// It was not Exa. Every fragment of the ask below classified to `network` or to
// nothing -- including the words "do a web search" -- so networkOnly was true,
// the planner vetoed the web before a call was ever made, and Amber answered out
// of his address book and told him finding new people was not something it does.

test("THE ASK THAT CAME BACK WITH NO WEB RESULTS AT ALL", () => {
  const msg =
    "I want to find sales executives i can pitch a product to, do a web search " +
    "and find five contacts in the nyc area i can meet and pitch to and give me " +
    "their contacts like LinkedIns and stuff to add";
  const plan = planQuery(msg);
  assert.equal(plan.networkOnly, false, "the planner vetoed the web on an explicit request for it");
  assert.equal(plan.needsWebPeople, true, "no lane would have gone looking for strangers");
  assert.ok(
    plan.lanes.some((l) => l.key === "web_people"),
    `no web_people lane: ${plan.lanes.map((l) => l.key).join(", ")}`,
  );
});

test("'do a web search' is a lane on its own, not a fragment that means nothing", () => {
  // It asks for no people and names no place, so every test in laneForAsk used
  // to fall through and return null -- the most explicit instruction in the
  // sentence, contributing nothing to the plan.
  assert.equal(laneForAsk("do a web search"), "web");
  assert.equal(laneForAsk("search the web"), "web");
  assert.equal(laneForAsk("look it up online"), "web");
  assert.equal(laneForAsk("run an internet search"), "web");
});

test("being told to search outranks a first-person phrasing", () => {
  // "find me people I can pitch to" is first person all the way through and is
  // obviously not a question about his own address book once he has said the
  // word search.
  assert.equal(laneForAsk("find people i can pitch to, do a web search"), "web_people");
  assert.equal(laneForAsk("who can i talk to about hardware"), "network");
});

test("LinkedInS, PLURAL, IS THE SAME SIGNAL AS LinkedIn", () => {
  /**
   * The marker was \blinkedin\b and the trailing s defeats the word boundary, so
   * the single most explicit stranger signal in his sentence matched nothing.
   *
   * THE PLURAL IS THE ONLY MARKER IN THIS STRING, on purpose. The first version
   * of this test used his actual words -- "like LinkedIns and stuff to add" --
   * which also contain "to add", so reverting the plural fix left it green. A
   * test that passes with the bug back in it is not a test.
   */
  assert.equal(laneForAsk("some names and their LinkedIns"), "web_people");
  assert.equal(laneForAsk("some names and their LinkedIn"), "web_people");
});

test("'stuff to add' means saving them, the way people actually say it", () => {
  // The pattern knew "add them/their/these" only.
  assert.equal(laneForAsk("five contacts to add"), "web_people");
  assert.equal(laneForAsk("some new prospects in nyc"), "web_people");
});

test("the veto still holds for a question that really is about his own people", () => {
  // The point of networkOnly is that it saves an Exa call and several seconds on
  // the fastest path there is. Widening the web signal must not cost that.
  for (const msg of [
    "who do I know in finance",
    "who have I not talked to in a while",
    "who should I follow up with from my contacts",
    // NOT "remind me who Sagar works for" -- naming a person already sets
    // networkOnly false, and has since before any of this. A test asserting
    // otherwise would have been asserting a bug that does not exist.
  ]) {
    assert.equal(planQuery(msg).networkOnly, true, `lost the veto on: ${msg}`);
  }
});

test("the word search inside an ordinary sentence is not a command", () => {
  // "search" is a common word and a false positive here spends an Exa call on
  // every turn that mentions one. The command is the phrase, not the verb.
  for (const msg of ["I have a job search going", "she works in search at Google"]) {
    assert.equal(
      planQuery(msg).networkOnly || planQuery(msg).lanes.length === 0,
      true,
      `treated as a web command: ${msg}`,
    );
  }
});

/**
 * ── THEIR OWN DAY ────────────────────────────────────────────────────────────
 *
 *   "What's on my calendar?"
 *   "Calendar is something you'd manage through your phone or calendar app
 *    directly. What I hold is your people..."
 *
 * Two things had to be true for that answer, and this file owns the second:
 * nothing recognized the question. Worse than unrecognized, "what's on my
 * calendar today" matched WEB_CURRENT on the word "today", so the plan's best
 * idea was to search the internet for the user's own schedule.
 */
test("a question about their own day is recognized", () => {
  for (const msg of [
    "What's on my calendar?",
    "what's on my calendar today",
    "whats on my calendar tomorrow",
    "what do I have tomorrow",
    "what does my week look like",
    "how is my day looking",
    "am I free Thursday afternoon",
    "am I busy this weekend",
    "do I have anything on Saturday",
    "what's on my schedule for tonight",
    "anything on my calendar this week",
    "when am I meeting them",
    "what meetings do I have tomorrow",
    "my agenda for today",
  ]) {
    assert.equal(asksAboutTheirDay(msg), true, `missed: ${msg}`);
  }
});

test("somebody else's calendar, or the world's, is not their day", () => {
  for (const msg of [
    "what year is the Mayan calendar",
    "put it on the shared calendar",
    "who is free to grab coffee", // a people question, answered by the ranker
    "what's the weather tomorrow",
    "latest news today",
    "",
    "   ",
  ]) {
    assert.equal(asksAboutTheirDay(msg), false, `false positive: ${msg}`);
  }
});

test("a day question never becomes a web search", () => {
  /**
   * THE REGRESSION THIS PINS. "today", "tonight", "tomorrow" and "this week"
   * are all in WEB_CURRENT, so every natural phrasing of "what am I doing
   * later" was one keyword away from Exa. The day is fetched by the chat route
   * from the same predicate, so the right lane here is none at all.
   */
  for (const msg of [
    "what's on my calendar today",
    "what do I have going on tomorrow",
    "am I free tonight",
    "what does my week look like",
  ]) {
    assert.equal(laneForAsk(msg), null, `routed to a lane: ${msg} -> ${laneForAsk(msg)}`);
    const plan = planQuery(msg);
    assert.equal(plan.needsWeb, false, `would have searched the web: ${msg}`);
    assert.equal(plan.needsWebPeople, false, `would have searched for people: ${msg}`);
  }
});

test("a place question wearing a day word is still a place question", () => {
  // The day check runs AFTER the place check for exactly this: "my" plus
  // "tomorrow" plus a neighborhood is somewhere to go, not their calendar.
  // Both halves are true of this one: it names a neighborhood AND it says "my
  // meeting tomorrow". Somewhere to eat is the ask; the day is the context.
  assert.equal(
    laneForAsk("where should I get dinner tomorrow in Dumbo for my meeting"),
    "places",
  );
  assert.equal(laneForAsk("recommend a coffee shop in Dumbo for my meeting tomorrow"), "places");
});

test("asking who is on their calendar is still a people question", () => {
  // People words win: the ranker answers "who am I seeing", and the day block
  // rides along on the same turn anyway.
  assert.equal(laneForAsk("who am I seeing this week from my contacts"), "network");
});

/**
 * ── THE FIRST QUESTIONS ANYBODY ASKS ─────────────────────────────────────────
 *
 * Open-ended, unfiltered and asked in the first minute. "Tell me about my
 * network" is wall-to-wall people words, so every rule in laneForAsk read it as
 * a request to rank the address book against the word "network" -- which
 * matches nobody and ends at "Nothing in your contacts answers that yet" for a
 * user holding a thousand people.
 */
test("an orientation question is recognized, and which kind it is", () => {
  for (const msg of [
    "Tell me about my contacts",
    "tell me about my network",
    "Tell me about my network.",
    "what's my network",
    "what do you know about my contacts",
    "give me an overview of my network",
    "my contacts?",
    "my network",
    "describe my address book",
    "what have you got on my people",
    "tell me about my circles",
  ]) {
    assert.equal(orientationAsk(msg), "about_theirs", `missed: ${msg}`);
  }

  for (const msg of [
    "What is Amber?",
    "what are you",
    "who are you",
    "what can you do",
    "What can Amber do for me?",
    "what do you do",
    "how does this work",
    "how can you help",
    "are you ChatGPT",
    "what should I ask you",
    "what can you help me with",
    "what are you for",
  ]) {
    assert.equal(orientationAsk(msg), "about_amber", `missed: ${msg}`);
  }
});

test("a question with a filter in it is a search, not an orientation", () => {
  /**
   * THE LINE THAT MATTERS. "Tell me about my contacts" is somebody getting
   * their bearings; "tell me about my contacts at Stripe" has an answer in the
   * address book and belongs to the ranker. Anything after the noun means it is
   * the second kind, which is why the pattern is anchored to the end.
   */
  for (const msg of [
    "tell me about my contacts at Stripe",
    "tell me about my network in New York",
    "what do you know about my contacts who went to USC",
    "tell me about my contact Neel",
    "what can you do about the fact that Neel moved to Austin and I never followed up with him",
    "who in my network works in health care",
  ]) {
    assert.equal(orientationAsk(msg), null, `stole a real question: ${msg}`);
  }
});

test("an orientation question never becomes a people search or a web search", () => {
  for (const msg of ["tell me about my network", "what can Amber do for me", "my contacts"]) {
    assert.equal(laneForAsk(msg), null, `routed to a lane: ${msg} -> ${laneForAsk(msg)}`);
    const plan = planQuery(msg);
    assert.equal(plan.needsPeople, false, `would have run the ranker: ${msg}`);
    assert.equal(plan.needsWeb, false, `would have searched the web: ${msg}`);
  }
});
