/**
 * Integration tests for the /v1/chat network_query streaming path.
 *
 * Drives the real SSE route with Fastify inject() and fakes injected through
 * registerChatRoutes' `deps`: the ranker stream is a hand-rolled async
 * generator, so what's asserted is the exact event sequence iOS receives —
 * meta → intent → people → token… → complete — and that the answer arrives as
 * progressive deltas rather than one block.
 *
 * Run with:  node --test src/routes/chat-stream.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { _clearPreparedInputCache } from "../lib/people-rank-prep-cache.js";
/**
 * LANE ORDER IS MEASURED, IN PROCESS, AND EVERY TEST IN THIS FILE MOVES IT.
 *
 * src/lib/lane-speed.js keeps one EWMA per lane in a module-level Map, on
 * purpose: the order of a multi-part answer's sections follows how fast each
 * lane ACTUALLY is, which is not a constant anybody can type. The whole suite
 * runs in one process, so every test here that exercises a lane folds its own
 * mocked duration -- one or two milliseconds -- into that estimate. After
 * enough of them `places` drifts from its 9,000 ms seed down past `web`, and a
 * test asserting a fixed order starts failing on roughly one run in three.
 *
 * That is what produced `AssertionError: 3600 3718 3657` -- people at 3600,
 * web at 3718, places at 3657, so places had crossed under web. The order was
 * not wrong; the test was reading leaked state from its neighbors.
 *
 * The two tests below assert the order, so they reset first. src/lib/
 * query-plan.test.js already does exactly this before each of its own
 * order-dependent assertions; these two were the ones that did not.
 */
import { _resetLaneSpeeds } from "../lib/lane-speed.js";

import {
  registerChatRoutes,
  peopleResultCount,
  webResultCount,
  webPageChars,
  isThin,
  generateSuggestions,
} from "./chat.js";

const TEST_DID = "did:amber:sagar-test";
const TEST_PHONE = "+13105550100";
const TEST_AMBER_ID = "amber-uuid-1";

const CONTACTS = [
  { id: "1", name: "Neel Patel", company: "Springdale Private Equity", title: "Partner" },
  { id: "2", name: "Dana Lee", company: "Acme Health", title: "Nurse" },
];

const RANKED = [
  { contactId: "1", name: "Neel Patel", company: "Springdale Private Equity", score: 0.47 },
];

/** The ranker's SSE, as the adapter yields it. */
function fakeRankStream(events) {
  return async function* () {
    for (const e of events) yield e;
  };
}

const OK_STREAM = [
  { type: "people", data: { query: "pe", count: 1, people: RANKED } },
  { type: "token", data: { text: "You should reach out to " } },
  { type: "token", data: { text: "Neel Patel [[p:1]]." } },
  {
    type: "done",
    data: {
      answer: "You should reach out to Neel Patel [[p:1]].",
      answer_status: "ok",
      citations: [{ marker: "[[p:1]]", contactId: "1", name: "Neel Patel" }],
      rank_order: ["1"],
      count: 1,
      people: RANKED,
    },
  },
];

function buildApp(deps = {}) {
  const app = Fastify({ logger: false });
  registerChatRoutes(app, {
    requireAuth: async (request) => {
      request.privyUser = { userId: TEST_DID, phone: TEST_PHONE };
    },
    resolveAmberIdByPhone: async () => TEST_AMBER_ID,
    listContacts: async () => CONTACTS,
    getProfile: async () => ({ displayName: "Sagar", currentCity: "LA" }),
    classifyIntent: async () => ({ intent: "network_query", needsWeb: false }),
    streamViaTogariSearch: fakeRankStream(OK_STREAM),
    rankViaTogariSearch: async () => null,
    appendMessage: async () => {},
    listConversation: async () => [],
    listRecentConversations: async () => [],
    generateSuggestions: async () => [],
    generateUuid: () => "conv-test-1",
    streamChat: async ({ onToken }) => {
      onToken("sonnet ");
      onToken("answer");
      return "sonnet answer";
    },
    ...deps,
  });
  return app;
}

/** Parse an SSE body into [{ type, data }] in wire order. */
function parseSse(body) {
  const out = [];
  for (const frame of body.split("\n\n")) {
    const lines = frame.split("\n");
    const typeLine = lines.find((l) => l.startsWith("event: "));
    const dataLine = lines.find((l) => l.startsWith("data: "));
    if (!typeLine || !dataLine) continue;
    out.push({ type: typeLine.slice(7).trim(), data: JSON.parse(dataLine.slice(6)) });
  }
  return out;
}

const ask = (app, message, extra = {}) =>
  app.inject({ method: "POST", url: "/v1/chat", payload: { message, ...extra } });

test("network_query relays people → token deltas → complete", async () => {
  const app = buildApp();
  const res = await ask(app, "who do I know in private equity");
  assert.equal(res.statusCode, 200);

  const events = parseSse(res.body);
  const types = events.map((e) => e.type);

  // The contract iOS already speaks — same names, same order.
  assert.deepEqual(types.slice(0, 3), ["meta", "intent", "people"]);
  assert.equal(types.at(-1), "complete");
  assert.equal(events[1].data.intent, "network_query");

  // People arrive BEFORE any answer text.
  assert.ok(types.indexOf("people") < types.indexOf("token"));
  const firstPeople = events.find((e) => e.type === "people");
  assert.equal(firstPeople.data.people[0].name, "Neel Patel");

  // The answer streams as the ranker's own deltas, not one pre-baked block.
  const tokens = events.filter((e) => e.type === "token").map((e) => e.data.text);
  assert.deepEqual(tokens, ["You should reach out to ", "Neel Patel [[p:1]]."]);
  assert.equal(tokens.join(""), "You should reach out to Neel Patel [[p:1]].");

  // `done` finalizes the people order + citations through the same event name.
  const lastPeople = events.filter((e) => e.type === "people").at(-1);
  assert.equal(lastPeople.data.citations[0].contactId, "1");
  assert.equal(lastPeople.data.people[0].contactId, "1");

  assert.equal(events.at(-1).data.intent, "network_query");
  assert.equal(events.at(-1).data.conversationId, "conv-test-1");
});

test("the streamed answer is persisted as the assistant turn", async () => {
  const persisted = [];
  const app = buildApp({
    appendMessage: async (ownerId, msg) => {
      persisted.push({ ownerId, ...msg });
    },
  });
  await ask(app, "who do I know in private equity");

  const assistant = persisted.find((m) => m.role === "assistant");
  assert.equal(assistant.ownerId, TEST_AMBER_ID);
  assert.equal(assistant.content, "You should reach out to Neel Patel [[p:1]].");
  assert.equal(assistant.intent, "network_query");
  assert.equal(assistant.metadata.model, "togari-search");
  assert.deepEqual(assistant.metadata.peopleIds, ["1"]);
  assert.equal(assistant.metadata.citations[0].contactId, "1");
});

test("token text is never sent twice when the stream carried the answer", async () => {
  const app = buildApp();
  const res = await ask(app, "who do I know in private equity");
  const tokens = parseSse(res.body)
    .filter((e) => e.type === "token")
    .map((e) => e.data.text);
  assert.equal(tokens.join(""), "You should reach out to Neel Patel [[p:1]].");
});

test("a ranker stream that yields nothing falls back to the blocking path", async () => {
  let blockingCalled = false;
  const app = buildApp({
    streamViaTogariSearch: fakeRankStream([]),
    rankViaTogariSearch: async () => {
      blockingCalled = true;
      return {
        people: RANKED,
        answer: "Blocking answer about Neel [[p:1]].",
        citations: [{ marker: "[[p:1]]", contactId: "1" }],
      };
    },
  });

  const res = await ask(app, "who do I know in private equity");
  const events = parseSse(res.body);

  assert.equal(blockingCalled, true);
  const people = events.filter((e) => e.type === "people");
  assert.equal(people.length, 1, "fallback emits people exactly once");
  assert.equal(people[0].data.people[0].name, "Neel Patel");
  const text = events.filter((e) => e.type === "token").map((e) => e.data.text).join("");
  assert.equal(text, "Blocking answer about Neel [[p:1]].");
  assert.equal(events.at(-1).type, "complete");
});

test("a stream that dies after some tokens keeps the partial text, no re-send", async () => {
  let blockingCalled = false;
  const app = buildApp({
    streamViaTogariSearch: async function* () {
      yield { type: "people", data: { people: RANKED } };
      yield { type: "token", data: { text: "You should reach out to " } };
      throw new Error("connection reset");
    },
    rankViaTogariSearch: async () => {
      blockingCalled = true;
      return { people: RANKED, answer: "WHOLE ANSWER", citations: [] };
    },
  });

  const res = await ask(app, "who do I know in private equity");
  const events = parseSse(res.body);

  assert.equal(blockingCalled, false, "must not re-rank after partial output");
  const text = events.filter((e) => e.type === "token").map((e) => e.data.text).join("");
  assert.equal(text, "You should reach out to ");
  assert.equal(events.at(-1).type, "complete");
});

test("engine off + no fallback answer degrades to the graceful no-matches text", async () => {
  const app = buildApp({
    streamViaTogariSearch: fakeRankStream([]),
    rankViaTogariSearch: async () => null,
  });
  const res = await ask(app, "who do I know in private equity");
  const events = parseSse(res.body);

  // This assertion used to pin the literal string "couldn't find anyone in your
  // network", which the copy had already moved off twice — so it was failing long
  // before the web offer existed. Then it pinned "won't guess" and "search the
  // web", which were the words of the FIXED STRING this branch used to emit.
  //
  // That string is gone. Thirty live turns showed five of them getting it byte
  // for byte, including "whose birthday is coming up" answered with "someone
  // who's moved". The branch now streams a written answer grounded in what was
  // searched, so the reply is different every time by design and no phrase in it
  // can be asserted.
  //
  // What must never change is pinned instead: the turn is NOT empty, no person
  // was invented, and the stream finishes. The web offer is a CHIP, and the test
  // below is the one that owns it.
  const text = events.filter((e) => e.type === "token").map((e) => e.data.text).join("");
  assert.ok(text.trim().length > 0, "an empty search must never produce an empty bubble");
  assert.equal(events.find((e) => e.type === "people").data.people.length, 0);
  assert.equal(events.at(-1).type, "complete");
});

test("an empty people search still answers when the model is dead", async () => {
  // THE FLOOR UNDER THE STREAMED ANSWER. The branch above calls the model; if the
  // model returns nothing at all — no key, a 500, a timeout — the user must still
  // read something rather than watch an empty bubble, so the old fixed string
  // survives as the last resort and this is what holds it there.
  const app = buildApp({
    streamViaTogariSearch: fakeRankStream([]),
    rankViaTogariSearch: async () => null,
    streamChat: async () => null,
  });
  const res = await ask(app, "who do I know in private equity");
  const events = parseSse(res.body);
  const text = events.filter((e) => e.type === "token").map((e) => e.data.text).join("");
  assert.match(text, /won't guess/i);
  assert.match(text, /search the web/i);
  assert.equal(events.at(-1).type, "complete");
});

test("both: ranker tokens are NOT relayed — only the Sonnet synthesis streams", async () => {
  const app = buildApp({
    classifyIntent: async () => ({ intent: "both", needsWeb: false }),
  });
  const res = await ask(app, "who should I talk to about fundraising and how");
  const events = parseSse(res.body);

  const tokens = events.filter((e) => e.type === "token").map((e) => e.data.text);
  assert.deepEqual(tokens, ["sonnet ", "answer"]);
  // The ranker's people still reach the client.
  assert.equal(events.find((e) => e.type === "people").data.people[0].name, "Neel Patel");
  assert.equal(events.at(-1).data.intent, "both");
});

test("chat intent is untouched by the ranker wiring", async () => {
  const app = buildApp({
    classifyIntent: async () => ({ intent: "chat", needsWeb: false }),
    streamViaTogariSearch: fakeRankStream([
      { type: "token", data: { text: "ranker must not run" } },
    ]),
  });
  const res = await ask(app, "how are you");
  const events = parseSse(res.body);

  assert.deepEqual(
    events.filter((e) => e.type === "token").map((e) => e.data.text),
    ["sonnet ", "answer"],
  );
  assert.equal(events.some((e) => e.type === "people"), false);
});

test("a stream that answers only on `done` (no token frames) still sends the text", async () => {
  const app = buildApp({
    streamViaTogariSearch: fakeRankStream([
      { type: "people", data: { people: RANKED } },
      {
        type: "done",
        data: {
          answer: "Only-on-done answer about Neel [[p:1]].",
          answer_status: "ok",
          citations: [{ marker: "[[p:1]]", contactId: "1" }],
          people: RANKED,
        },
      },
    ]),
    rankViaTogariSearch: async () => assert.fail("must not fall back"),
  });

  const res = await ask(app, "who do I know in private equity");
  const events = parseSse(res.body);
  const text = events.filter((e) => e.type === "token").map((e) => e.data.text).join("");
  assert.equal(text, "Only-on-done answer about Neel [[p:1]].");
  assert.equal(events.at(-1).type, "complete");
});

// ── Web search: the way out of an empty people search ───────────────────────
//
// The rule being pinned here is that Amber never silently searches the open web
// for a question the user asked about their OWN people. An empty people search
// OFFERS the web as a chip; only a request that explicitly carries forceWeb
// actually calls Exa.

/** A ranker stream that finds nobody — the dead end this feature exists for. */
const EMPTY_STREAM = [
  { type: "people", data: { query: "q", count: 0, people: [] } },
  { type: "done", data: { answer: null, answer_status: "no_matches", citations: [], rank_order: [], count: 0, people: [] } },
];

test("an empty people search offers a web_search chip carrying the question", async () => {
  let exaCalls = 0;
  const app = buildApp({
    streamViaTogariSearch: fakeRankStream(EMPTY_STREAM),
    exaSearch: async () => {
      exaCalls += 1;
      return [];
    },
  });
  const res = await ask(app, "who do I know that roasts coffee");
  assert.equal(res.statusCode, 200);

  const events = parseSse(res.body);
  const suggestions = events.find((e) => e.type === "suggestions");
  assert.ok(suggestions, "expected a suggestions frame");
  const chip = suggestions.data.suggestions[0];
  assert.equal(chip.type, "web_search");
  // The user's own words, so accepting does not mean retyping the question.
  assert.equal(chip.query, "who do I know that roasts coffee");
  assert.ok(chip.label.length > 0);

  // The answer is written by the model now rather than being a fixed string, so
  // the web option is carried by the chip asserted above and cannot be pinned to
  // a phrase in the prose. What the prose still owes the user is being there.
  const text = events.filter((e) => e.type === "token").map((e) => e.data.text).join("");
  assert.ok(text.trim().length > 0, "an empty search must never produce an empty bubble");

  // AND NOTHING WAS SEARCHED. Offering is not doing.
  assert.equal(exaCalls, 0);
  assert.equal(events.some((e) => e.type === "sources"), false);
});

test("the web_search chip is first, not buried behind generated follow-ups", async () => {
  const app = buildApp({
    streamViaTogariSearch: fakeRankStream(EMPTY_STREAM),
    generateSuggestions: async () => [
      { type: "follow_up", label: "Tell me about coffee", prompt: "tell me about coffee" },
      { type: "connect_people", label: "Find people in food", query: "people in food" },
    ],
  });
  const events = parseSse((await ask(app, "who do I know that roasts coffee")).body);
  const list = events.find((e) => e.type === "suggestions").data.suggestions;
  assert.equal(list[0].type, "web_search");
  assert.equal(list.filter((x) => x.type === "web_search").length, 1);
  assert.ok(list.length <= 4);
});

test("forceWeb searches Exa, emits sources, and skips the intent router", async () => {
  let routerCalls = 0;
  let seenQuery = null;
  const app = buildApp({
    classifyIntent: async () => {
      routerCalls += 1;
      return { intent: "network_query", needsWeb: false };
    },
    exaSearch: async ({ query }) => {
      seenQuery = query;
      return [
        { title: "Best cafes in the West Village", url: "https://example.com/cafes", text: "..." },
      ];
    },
  });
  const res = await ask(app, "best cafe with wifi in the west village", { forceWeb: true });
  assert.equal(res.statusCode, 200);

  const events = parseSse(res.body);
  // The router is not consulted at all: the intent is not in question, and that
  // saved hop is the latency win.
  assert.equal(routerCalls, 0);
  assert.equal(events.find((e) => e.type === "intent").data.intent, "chat");

  assert.equal(seenQuery, "best cafe with wifi in the west village");
  const sources = events.find((e) => e.type === "sources");
  assert.ok(sources, "expected a sources frame");
  assert.equal(sources.data.sources[0].url, "https://example.com/cafes");
});

test("a normal turn still never touches the web", async () => {
  let exaCalls = 0;
  const app = buildApp({ exaSearch: async () => { exaCalls += 1; return []; } });
  await ask(app, "who do I know in private equity");
  assert.equal(exaCalls, 0);
});

// ── Retrieval depth ─────────────────────────────────────────────────────────────
// "list ten VPs of finance in New York" cannot be answered out of five pages. The
// count the user asked for is what decides how wide to search.

test("webResultCount scales with the count the question asks for", async () => {
  assert.equal(webResultCount("is Balthazar open on Sunday"), 6);
  // A listy ask with no number: 8, not 12. Prompt size is time-to-first-token, and
  // twelve sources made an ordinary recommendation slow enough to miss the hard
  // deadline.
  assert.equal(webResultCount("what's the best coffee in the West Village"), 8);
  assert.equal(webResultCount("list me ten vice presidents of finance in New York"), 20);
  assert.equal(webResultCount("list 10 VPs of finance in NY"), 20);
  assert.equal(webResultCount("top 3 cafes with wifi"), 6); // floored at the default
  // Never unbounded, whatever the user types.
  assert.equal(webResultCount("list 900 restaurants"), 8);
  // A number that is plainly NOT a requested count does not widen the search.
  assert.equal(webResultCount("a cafe in the 10th arrondissement"), 6);
  // "10th" is an ordinal, not a count: \b does not break between "10" and "th",
  // so it never reads as "ten of them". Listy, so it still gets the wide default.
  assert.equal(webResultCount("best cafes near the 10th arrondissement"), 8);
  assert.equal(webResultCount(""), 6);
  assert.equal(webResultCount(undefined), 6);
});

test("a list-shaped web question pulls more sources than a yes/no one", async () => {
  const counts = [];
  const app = buildApp({
    classifyIntent: async () => ({ intent: "chat", needsWeb: true }),
    exaSearch: async ({ numResults }) => {
      counts.push(numResults);
      return [{ title: "t", url: "https://example.com/a", text: "..." }];
    },
  });
  await ask(app, "is Balthazar open on Sunday");
  await ask(app, "list me ten vice presidents of finance in New York");
  assert.equal(counts[0], 6);
  assert.equal(counts[1], 20);
});

// ── Sharing ─────────────────────────────────────────────────────────────────────
// Finding something out inside Amber is only better than a browser if it can then
// go to the people it is useful to, so a real answer ALWAYS offers that.

test("a real answer always carries exactly one share_note chip", async () => {
  const app = buildApp({
    classifyIntent: async () => ({ intent: "chat", needsWeb: false }),
    // The suggestion model returns nothing useful; the chip must still be there.
    generateSuggestions: async () => [],
    streamChat: async ({ onToken }) => {
      const text =
        "Three cafes in the West Village worth the walk, all with real wifi and " +
        "seats you can sit in for two hours without being asked to leave.";
      onToken(text);
      return text;
    },
  });
  const events = parseSse((await ask(app, "best coffee in the west village")).body);
  const list = events.find((e) => e.type === "suggestions").data.suggestions;
  const shares = list.filter((x) => x.type === "share_note");
  assert.equal(shares.length, 1);
  assert.ok(shares[0].label.length > 0);
});

test("the web-search offer turn does NOT also offer sharing", async () => {
  const app = buildApp({
    streamViaTogariSearch: fakeRankStream(EMPTY_STREAM),
    generateSuggestions: async () => [],
  });
  const events = parseSse((await ask(app, "who do I know that roasts coffee")).body);
  const list = events.find((e) => e.type === "suggestions").data.suggestions;
  // One clear next move on a dead end, not two competing ones.
  assert.equal(list[0].type, "web_search");
  assert.equal(list.some((x) => x.type === "share_note"), false);
});

test("suggestions are capped, and the guaranteed ones are never the ones cut", async () => {
  const app = buildApp({
    classifyIntent: async () => ({ intent: "chat", needsWeb: false }),
    generateSuggestions: async () => [
      { type: "follow_up", label: "a", prompt: "a" },
      { type: "follow_up", label: "b", prompt: "b" },
      { type: "connect_people", label: "c", query: "c" },
      { type: "follow_up", label: "d", prompt: "d" },
    ],
    streamChat: async ({ onToken }) => {
      const text = "A long enough answer to be worth sharing with somebody who cares.";
      onToken(text);
      return text;
    },
  });
  const chips = parseSse((await ask(app, "tell me about coffee")).body).find(
    (e) => e.type === "suggestions",
  ).data.suggestions;
  // Five, not four: two can be guaranteed now, and a four-cap left room for only
  // two of the model's own — which are the ones actually about this answer.
  assert.ok(chips.length <= 5, `got ${chips.length}`);
  // THE FORCED CHIP IS FIRST, not appended and then truncated off the end. That was
  // the bug: a model returning four chips pushed the share chip to position five
  // and the slice removed it, so it only ever appeared when the model was quiet.
  assert.equal(chips[0].type, "share_note");
});

test("generateSuggestions accepts share_note and caps it at one", async () => {
  const out = await generateSuggestions({
    message: "best coffee nearby",
    answer: "Three places.",
    apiKey: "test-key",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        content: [
          {
            text: JSON.stringify([
              { type: "share_note", label: "Send this to a circle" },
              { type: "share_note", label: "Share with Sunday Run Club" },
              { type: "follow_up", label: "Find more", prompt: "find more" },
            ]),
          },
        ],
      }),
    }),
  });
  assert.equal(out.filter((x) => x.type === "share_note").length, 1);
  assert.equal(out[0].label, "Send this to a circle");
  // A share chip carries no payload beyond its label; nothing else leaks through.
  assert.deepEqual(Object.keys(out[0]).sort(), ["label", "type"]);
});

// ── Depth ───────────────────────────────────────────────────────────────────────
// A snippet is the TOP of a page. Answers that have to EXTRACT — ten names, a figure
// out of a filing, what a pasted document says — need the middle of it.

test("webPageChars asks for far more text on an extraction question", async () => {
  assert.equal(webPageChars("is Balthazar open on Sunday"), 1200);
  assert.equal(webPageChars("list ten VPs of finance in New York"), 5000);
  assert.equal(webPageChars("what does this report say about revenue"), 5000);
  assert.equal(webPageChars("scan that page and find the pricing"), 5000);
  assert.equal(webPageChars(""), 1200);
});

test("isThin measures characters, not row count", async () => {
  // Ten sources that Exa could not extract text from still means nothing to read.
  assert.equal(isThin(Array.from({ length: 10 }, () => ({ text: "", highlights: [] }))), true);
  assert.equal(isThin([{ text: "x".repeat(3000), highlights: [] }]), false);
  assert.equal(isThin([]), true);
  assert.equal(isThin(undefined), true);
});

test("a pasted link is READ, not searched for", async () => {
  let searched = 0;
  let readUrls = null;
  let routerCalls = 0;
  const app = buildApp({
    classifyIntent: async () => {
      routerCalls += 1;
      return { intent: "chat", needsWeb: false };
    },
    exaSearch: async () => {
      searched += 1;
      return [];
    },
    exaContents: async ({ urls, maxCharacters }) => {
      readUrls = urls;
      assert.ok(maxCharacters >= 20000, "a named document is read deeply");
      return [{ title: "Q3 filing", url: urls[0], text: "Revenue was 41.2m.", highlights: [] }];
    },
  });
  const res = await ask(app, "read https://example.com/q3.pdf and tell me the revenue");
  assert.equal(res.statusCode, 200);
  const events = parseSse(res.body);

  // No search, no router: the user named the document.
  assert.equal(searched, 0);
  assert.equal(routerCalls, 0);
  assert.deepEqual(readUrls, ["https://example.com/q3.pdf"]);
  assert.equal(events.find((e) => e.type === "intent").data.intent, "chat");
  assert.equal(
    events.find((e) => e.type === "sources").data.sources[0].url,
    "https://example.com/q3.pdf",
  );
});

test("an unreadable pasted link falls back to searching rather than saying nothing", async () => {
  let searched = 0;
  const app = buildApp({
    exaContents: async () => [], // page could not be retrieved at all
    exaSearch: async () => {
      searched += 1;
      return [{ title: "About that page", url: "https://example.com/about", text: "…" }];
    },
  });
  const events = parseSse((await ask(app, "what does https://example.com/x say")).body);
  assert.equal(searched, 1);
  assert.ok(events.find((e) => e.type === "sources"));
});

test("an extraction question that comes back empty triggers a deep re-read", async () => {
  let deepCalls = 0;
  const app = buildApp({
    classifyIntent: async () => ({ intent: "chat", needsWeb: true }),
    // Ten rows, no extractable text — the invisible failure this exists to catch.
    exaSearch: async () => [
      { title: "Staff", url: "https://a.com/1", text: "", highlights: [] },
      { title: "Team", url: "https://b.com/2", text: "", highlights: [] },
    ],
    exaContents: async ({ urls }) => {
      deepCalls += 1;
      return urls.map((u) => ({ title: "Deep", url: u, text: "x".repeat(4000), highlights: [] }));
    },
  });
  const events = parseSse((await ask(app, "list ten VPs of finance in New York")).body);
  assert.equal(deepCalls, 1);
  // Citation numbering still follows the ORIGINAL search order after the merge.
  const sources = events.find((e) => e.type === "sources").data.sources;
  assert.deepEqual(sources.map((x) => x.url), ["https://a.com/1", "https://b.com/2"]);
});

test("a shallow question with good snippets does NOT pay for a deep re-read", async () => {
  let deepCalls = 0;
  const app = buildApp({
    classifyIntent: async () => ({ intent: "chat", needsWeb: true }),
    exaSearch: async () => [{ title: "Hours", url: "https://a.com/1", text: "x".repeat(3000), highlights: [] }],
    exaContents: async () => {
      deepCalls += 1;
      return [];
    },
  });
  await ask(app, "is Balthazar open on Sunday");
  assert.equal(deepCalls, 0);
});

// ── Acting on strangers ─────────────────────────────────────────────────────────

test("generateSuggestions accepts draft_outreach and research_web, one each", async () => {
  const out = await generateSuggestions({
    message: "list ten VPs of finance in New York",
    answer: "Dana Reed, Lee Ortiz, …",
    apiKey: "test-key",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        content: [
          {
            text: JSON.stringify([
              { type: "draft_outreach", label: "Draft outreach to Dana Reed", name: "Dana Reed", prompt: "Draft a cold note to Dana Reed" },
              { type: "draft_outreach", label: "Draft outreach to Lee Ortiz", name: "Lee Ortiz", prompt: "Draft a cold note to Lee Ortiz" },
              { type: "research_web", label: "Dig deeper on these five", prompt: "Find recent news on these five" },
              { type: "research_web", label: "again", prompt: "again" },
            ]),
          },
        ],
      }),
    }),
  });
  assert.equal(out.filter((x) => x.type === "draft_outreach").length, 1);
  assert.equal(out.filter((x) => x.type === "research_web").length, 1);
  assert.equal(out[0].name, "Dana Reed");
  // draft_outreach deliberately does NOT require a contactId — that is the point.
  assert.equal(out[0].contactId, undefined);
});

test("an outreach chip with no prompt is dropped, not rendered as a dead button", async () => {
  const out = await generateSuggestions({
    message: "m",
    answer: "a",
    apiKey: "test-key",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        content: [{ text: JSON.stringify([{ type: "draft_outreach", label: "Draft outreach", name: "X" }]) }],
      }),
    }),
  });
  assert.deepEqual(out, []);
});

test("the grounded block stays under budget however much text comes back", async () => {
  let promptChars = 0;
  const app = buildApp({
    classifyIntent: async () => ({ intent: "chat", needsWeb: true }),
    // Twenty pages, each far larger than any per-page cap should allow.
    exaSearch: async () =>
      Array.from({ length: 20 }, (_, i) => ({
        title: `Page ${i}`,
        url: `https://a.com/${i}`,
        text: "x".repeat(40000),
        highlights: ["a relevant line"],
      })),
    streamChat: async ({ messages, onToken }) => {
      promptChars = messages.map((m) => m.content).join("").length;
      onToken("ok");
      return "ok";
    },
  });
  await ask(app, "list twenty things");
  assert.ok(promptChars > 10000, "the block should still be substantial");
  // 90k budget plus the question and the framing, never 800k.
  assert.ok(promptChars < 120000, `block was ${promptChars} chars`);
});

// ── Verifiable people ───────────────────────────────────────────────────────────

test("a people-shaped web question emits web_people cards and grounds on them", async () => {
  let peopleQuery = null;
  const app = buildApp({
    classifyIntent: async () => ({ intent: "chat", needsWeb: true }),
    exaSearch: async () => [{ title: "Listicle", url: "https://example.com/list", text: "..." }],
    exaFindPeople: async ({ query }) => {
      peopleQuery = query;
      return [
        { name: "Ann A", title: "VP Finance", company: "Acme", url: "https://www.linkedin.com/in/a", snippet: null },
        { name: "Bo B", title: "VP Finance", company: "Bolt", url: "https://www.linkedin.com/in/b", snippet: null },
      ];
    },
    streamChat: async ({ messages, onToken }) => {
      // The profiles must reach the model, or the prose names a different five people
      // than the cards on screen.
      const prompt = messages.map((m) => m.content).join("");
      assert.match(prompt, /linkedin\.com\/in\/a/);
      assert.match(prompt, /ONLY people you may name/i);
      onToken("Two of the five could be verified.");
      return "Two of the five could be verified.";
    },
  });
  const events = parseSse((await ask(app, "list out 5 VPs of finance in nyc")).body);
  assert.equal(peopleQuery, "list out 5 VPs of finance in nyc");
  const frame = events.find((e) => e.type === "web_people");
  assert.ok(frame, "expected a web_people frame");
  assert.deepEqual(frame.data.people.map((p) => p.name), ["Ann A", "Bo B"]);
  assert.ok(frame.data.people.every((p) => p.url.includes("linkedin.com/in/")));
});

test("a place question does NOT run a people search", async () => {
  let called = 0;
  const app = buildApp({
    classifyIntent: async () => ({ intent: "chat", needsWeb: true }),
    exaSearch: async () => [{ title: "Cafes", url: "https://example.com/cafes", text: "x".repeat(3000) }],
    exaFindPeople: async () => {
      called += 1;
      return [];
    },
  });
  const events = parseSse((await ask(app, "best coffee shop in dumbo to do work")).body);
  assert.equal(called, 0);
  assert.equal(events.some((e) => e.type === "web_people"), false);
});

test("people cards are persisted with the turn so a reopened note keeps them", async () => {
  const persisted = [];
  const app = buildApp({
    classifyIntent: async () => ({ intent: "chat", needsWeb: true }),
    exaSearch: async () => [],
    exaFindPeople: async () => [
      { name: "Ann A", title: null, company: null, url: "https://www.linkedin.com/in/a", snippet: null },
    ],
    appendMessage: async (ownerId, msg) => {
      persisted.push(msg);
    },
  });
  await ask(app, "find me a CFO in nyc");
  const assistant = persisted.find((m) => m.role === "assistant");
  assert.equal(assistant.metadata.webPeople[0].name, "Ann A");
});


// ── PLACE CARDS ON A PLANNING TURN ───────────────────────────────────────────
//
// The demo path. What matters here is not that a search happened but WHERE the
// cards land in the event stream and in storage: after the answer, after the
// chips, and merged into the turn's metadata so reopening the note still has
// them. A card that only exists in the live stream disappears on reload, which is
// worse than no card.

const PLACES = [
  {
    name: "Llama Inn",
    cuisine: "Peruvian",
    neighborhood: "Williamsburg",
    address: "50 Withers St",
    url: "https://www.llamainnnyc.com",
    blurb: "Loud, fun Peruvian on a corner",
    rating: null,
    reviewCount: null,
    hours: null,
  },
];

test("a planning turn emits place cards AS SOON AS THEY LAND and merges them into metadata", async () => {
  const merges = [];
  let findPlacesCalls = 0;
  const app = buildApp({
    classifyIntent: async () => ({ intent: "chat", needsWeb: false }),
    appendMessage: async (ownerId, msg) => ({ id: "msg-1", ownerId, ...msg }),
    mergeMessageMetadata: async (ownerId, messageId, patch) => {
      merges.push({ ownerId, messageId, patch });
      return true;
    },
    findPlaces: async () => {
      findPlacesCalls += 1;
      return PLACES;
    },
  });

  const res = await ask(
    app,
    "I'm planning a dinner in Williamsburg with three friends, thinking Asian food",
  );
  assert.equal(res.statusCode, 200);
  const events = parseSse(res.body);
  const types = events.map((e) => e.type);

  assert.equal(findPlacesCalls, 1);
  assert.ok(types.includes("places"), `expected a places event, got ${types.join(",")}`);

  // THIS ASSERTION USED TO BE THE OPPOSITE, and the old one was wrong about
  // what a user is doing while they wait.
  //
  // It required the cards to come after the prose, on the reasoning that a
  // restaurant on screen before the sentence explaining it is out of order.
  // What it actually produced: cards that were ready in four seconds arrived
  // after a forty-second answer, so a question with three parts to it looked
  // like a blank spinner for most of a minute -- "it just keeps pondering and
  // doing nothing". The user's instruction is explicit: output the fastest part
  // first and let them read it while the rest is still coming.
  //
  // So the only ordering that must hold is that they arrive at all, exactly
  // once, and before the turn completes. The CLIENT decides where a section
  // sits on screen (a fixed order of headers), which is where that decision
  // belongs -- arrival order and reading order are not the same thing.
  assert.equal(
    types.filter((t) => t === "places").length,
    1,
    "places must be sent exactly once, not by both the early and late paths",
  );
  assert.ok(types.indexOf("places") < types.indexOf("complete"));
  assert.equal(types.at(-1), "complete");

  const placesEvent = events.find((e) => e.type === "places");
  assert.equal(placesEvent.data.places[0].name, "Llama Inn");
  assert.equal(placesEvent.data.places[0].rating, null);

  // Survives a reload.
  const merge = merges.find((m) => m.patch?.places);
  assert.ok(merge, "places were not merged into the stored turn");
  assert.equal(merge.messageId, "msg-1");
  assert.equal(merge.ownerId, TEST_AMBER_ID);
  assert.equal(merge.patch.places[0].url, "https://www.llamainnnyc.com");
});

test("a turn that is not planning anything never spends a place search", async () => {
  let called = 0;
  const app = buildApp({
    classifyIntent: async () => ({ intent: "chat", needsWeb: false }),
    findPlaces: async () => {
      called += 1;
      return PLACES;
    },
  });
  await ask(app, "Had dinner with Sagar last night, he is raising a seed round");
  assert.equal(called, 0);
});

// A failing place search must not take the turn down with it: the answer is
// already streamed and persisted by the time this runs.
test("a place search that throws still completes the turn", async () => {
  const app = buildApp({
    classifyIntent: async () => ({ intent: "chat", needsWeb: false }),
    findPlaces: async () => {
      throw new Error("exa down");
    },
  });
  const res = await ask(app, "Where should we get drinks in SoHo tonight?");
  assert.equal(res.statusCode, 200);
  const types = parseSse(res.body).map((e) => e.type);
  assert.equal(types.at(-1), "complete");
  assert.ok(!types.includes("places"));
});


// ── THE WHOLE PLAN TURN, IN ORDER ────────────────────────────────────────────
//
// This is the demo. "Planning a dinner in Williamsburg with Sam, Priya and Dev,
// thinking Asian" has to produce, in this order: the three people INSTANTLY (before
// a single token of the answer), the answer itself, the chips, and the venue cards.
//
// The people-before-tokens assertion is the one that matters most. The whole point
// of instant tagging is that the cards are on screen while the model is still
// writing; if that ordering ever inverts, the feature silently stops existing and
// nothing else fails.

const ADDRESS_BOOK = [
  { id: "c1", name: "Sam Ortiz" },
  { id: "c2", name: "Priya Raman" },
  { id: "c3", name: "Dev Shah" },
];

test("a plan turn tags everyone instantly, then answers, then chips, then places", async () => {
  const app = buildApp({
    classifyIntent: async () => ({ intent: "chat", needsWeb: false }),
    listContactNamesForOwner: async () => ADDRESS_BOOK,
    findPlaces: async () => PLACES,
    appendMessage: async (ownerId, msg) => ({ id: "msg-plan", ownerId, ...msg }),
    mergeMessageMetadata: async () => true,
    generateSuggestions: async () => [
      {
        type: "create_circle",
        label: "Make a circle for this dinner",
        contactIds: ["c1", "c2", "c3"],
        name: "Williamsburg dinner",
      },
    ],
  });

  const res = await ask(
    app,
    "I'm planning a dinner in Williamsburg with Sam, Priya and Dev, thinking Asian food",
  );
  assert.equal(res.statusCode, 200);
  const events = parseSse(res.body);
  const types = events.map((e) => e.type);

  // All three, before any answer text.
  const firstPeople = events.find((e) => e.type === "people");
  assert.ok(firstPeople, `no people event; got ${types.join(",")}`);
  assert.deepEqual(
    firstPeople.data.people.map((p) => p.contactId).sort(),
    ["c1", "c2", "c3"],
  );
  assert.ok(
    types.indexOf("people") < types.indexOf("token"),
    "people must be tagged before the answer streams",
  );

  // Then the answer, then the chips. The place cards are no longer pinned
  // behind either of them -- see the note in the planning-turn test above; they
  // now leave as soon as the search resolves, which on this fake is
  // immediately.
  assert.ok(types.lastIndexOf("token") < types.indexOf("suggestions"));
  assert.equal(types.filter((t) => t === "places").length, 1);
  assert.equal(types.at(-1), "complete");

  // The circle chip survives validation with all three ids intact — it is the one
  // suggestion whose payload the client cannot reconstruct on its own.
  const chips = events.find((e) => e.type === "suggestions").data.suggestions;
  const circle = chips.find((c) => c.type === "create_circle");
  assert.ok(circle, `no create_circle chip; got ${chips.map((c) => c.type).join(",")}`);
  assert.deepEqual(circle.contactIds, ["c1", "c2", "c3"]);
  assert.equal(circle.name, "Williamsburg dinner");
});

// A generated circle chip naming someone who is NOT in this turn's people is an
// invented contactId, and tapping it would build a circle around a stranger. This
// drives the REAL generateSuggestions with a faked model response, because the
// validation lives inside it — injecting a fake through deps would skip the very
// code under test.
function fakeSuggestModel(items) {
  return async () => ({
    ok: true,
    json: async () => ({ content: [{ type: "text", text: JSON.stringify(items) }] }),
  });
}

const PLAN_PEOPLE = [
  { contactId: "c1", name: "Sam Ortiz" },
  { contactId: "c2", name: "Priya Raman" },
  { contactId: "c3", name: "Dev Shah" },
];

test("create_circle keeps only real contactIds, and needs two of them", async () => {
  const run = (items) =>
    generateSuggestions({
      message: "planning dinner in Williamsburg with Sam, Priya and Dev",
      answer: "Sounds like a great night.",
      intent: "chat",
      people: PLAN_PEOPLE,
      apiKey: "test-key",
      fetchImpl: fakeSuggestModel(items),
    });

  // All three real → kept, in the order given.
  const good = await run([
    { type: "create_circle", label: "Make a circle for this dinner", contactIds: ["c1", "c2", "c3"], name: "Williamsburg dinner" },
  ]);
  assert.equal(good.length, 1);
  assert.deepEqual(good[0].contactIds, ["c1", "c2", "c3"]);

  // One invented id → filtered, leaving one, which is not a circle.
  const invented = await run([
    { type: "create_circle", label: "Make a circle", contactIds: ["c1", "nope"] },
    { type: "follow_up", label: "Show Japanese spots instead", prompt: "Show me Japanese spots in Williamsburg" },
  ]);
  assert.ok(!invented.some((c) => c.type === "create_circle"), JSON.stringify(invented));
  assert.ok(invented.some((c) => c.type === "follow_up"));

  // Two real ids out of three entries → kept with the invented one stripped.
  const partial = await run([
    { type: "create_circle", label: "Make a circle", contactIds: ["c1", "ghost", "c2"] },
  ]);
  assert.deepEqual(partial[0].contactIds, ["c1", "c2"]);

  // Only ONE circle chip, however many come back.
  const many = await run([
    { type: "create_circle", label: "A", contactIds: ["c1", "c2"] },
    { type: "create_circle", label: "B", contactIds: ["c2", "c3"] },
  ]);
  assert.equal(many.filter((c) => c.type === "create_circle").length, 1);
});

test("add_note needs a real contactId and falls back to our own name for it", async () => {
  const run = (items) =>
    generateSuggestions({
      message: "Priya just moved to Greenpoint",
      answer: "Noted.",
      intent: "chat",
      people: PLAN_PEOPLE,
      apiKey: "test-key",
      fetchImpl: fakeSuggestModel(items),
    });

  // The model forgot the name. The sheet still has to be titled with a person, and
  // the name we trust is the one from our own contact list, not the label text.
  const noName = await run([{ type: "add_note", label: "Add a note about Priya", contactId: "c2" }]);
  assert.equal(noName[0].type, "add_note");
  assert.equal(noName[0].name, "Priya Raman");

  // An invented id is dropped outright — a note sheet pointed at nothing.
  const bogus = await run([{ type: "add_note", label: "Add a note about Jo", contactId: "c99", name: "Jo" }]);
  assert.ok(!bogus.some((c) => c.type === "add_note"));
});

// ── THE WHOLE POINT OF THE PRODUCT ───────────────────────────────────────────
//
// "Help me plan a dinner in San Francisco" names nobody, so the router calls it
// `chat`, and the handler's chat branch never touches the address book — that is
// an if/else, not an oversight. Before the recall side channel this turn returned
// a good answer, restaurant cards, and not one contact, while every note the user
// had recorded about someone moving to SF sat unread.
//
// What is asserted here is that a single turn can now be a conversation AND a
// recall, and that the recall does not sit in front of the reply.

const SF_PEOPLE = [
  { contactId: "c1", name: "Priya Raman", score: 3 },
  { contactId: "c2", name: "Dev Shah", score: 2 },
];

test("a planning question with no names still surfaces the people you know there", async () => {
  let askedTerms = null;
  const app = buildApp({
    classifyIntent: async () => ({ intent: "chat", needsWeb: false }),
    findPeopleByPlaceTerms: async (_owner, terms) => {
      askedTerms = terms;
      return SF_PEOPLE;
    },
    findPlaces: async () => PLACES,
  });

  const res = await ask(app, "help me plan a dinner in san francisco");
  assert.equal(res.statusCode, 200);
  const events = parseSse(res.body);
  const types = events.map((e) => e.type);

  // The place was expanded to its aliases before searching, because a note that
  // says "SF" is about this question too.
  assert.ok(askedTerms, "the recall never ran");
  assert.ok(askedTerms.includes("san francisco"));
  assert.ok(askedTerms.includes("sf"));
  assert.ok(askedTerms.includes("bay area"));

  const people = events.filter((e) => e.type === "people");
  assert.ok(people.length > 0, `no people event; got ${types.join(",")}`);
  assert.deepEqual(
    people.at(-1).data.people.map((p) => p.name),
    ["Priya Raman", "Dev Shah"],
  );

  // All three things the user asked for, on one turn.
  assert.ok(types.includes("token"), "no written answer");
  assert.ok(types.includes("places"), "no venue cards");
  assert.equal(types.at(-1), "complete");
});

test("the recall never delays the reply", async () => {
  // If this were awaited on the hot path, the first token would land after it.
  let resolveRecall;
  const slow = new Promise((r) => {
    resolveRecall = r;
  });
  const app = buildApp({
    classifyIntent: async () => ({ intent: "chat", needsWeb: false }),
    findPeopleByPlaceTerms: async () => {
      // Let the answer stream first, then produce the people.
      await slow;
      return SF_PEOPLE;
    },
    findPlaces: async () => [],
    streamChat: async ({ onToken }) => {
      onToken('Here is a plan. ');
      // The reply is complete while the recall is still outstanding.
      resolveRecall();
      return 'Here is a plan. ';
    },
  });
  const res = await ask(app, "help me plan a dinner in san francisco");
  const types = parseSse(res.body).map((e) => e.type);
  assert.ok(types.includes('token'), 'the answer must not wait on the recall');
  assert.ok(types.includes('people'), 'the recall still lands before the turn ends');
  assert.ok(types.indexOf('token') < types.lastIndexOf('people'));
  assert.equal(types.at(-1), 'complete');
});

test("a message that names nowhere never spends a memory search", async () => {
  let called = 0;
  const app = buildApp({
    classifyIntent: async () => ({ intent: "chat", needsWeb: false }),
    findPeopleByPlaceTerms: async () => {
      called += 1;
      return SF_PEOPLE;
    },
    findPlaces: async () => [],
  });
  await ask(app, "what is a good way to structure a cold email");
  assert.equal(called, 0);
});

// ── the six dimensions on the chat path ───────────────────────────────────────
//
// The wiring these cover is ADDITIVE. Its whole safety argument is that the
// ranker keeps seeing every contact it saw before, and only 53 of 5,249
// production contacts hold any fact — so a change that narrowed the set to
// retrieval hits would make 5,196 people unreachable and break asking about
// someone by name. That is the regression these tests exist to prevent.

/** Capture the exact `contacts` the ranker is handed. */
function capturingRanker(seen) {
  return async function* (args) {
    seen.push(args.contacts);
    for (const e of OK_STREAM) yield e;
  };
}

test("dimension retrieval reorders and enriches WITHOUT dropping any contact", async () => {
  const seen = [];
  const app = buildApp({
    streamViaTogariSearch: capturingRanker(seen),
    // Retrieval says contact "2" is the relevant one, and hands back its ranked
    // facts. Contact "1" is not mentioned at all.
    retrieveByDimension: async () => ({
      contactIds: ["2"],
      factsByContact: { 2: [{ text: "Dana runs marathons", dimensions: [{ code: "physical" }] }] },
      dimensionWeights: { physical: 0.7, social: 0.3 },
      observationCount: 12,
      usedVector: true,
    }),
  });
  const res = await ask(app, "who do I know that runs");
  assert.equal(res.statusCode, 200);

  const handed = seen[0];
  assert.ok(Array.isArray(handed), "the ranker must be given a contact array");
  // BOTH contacts survive. This is the assertion that matters.
  assert.equal(handed.length, 2, "no contact may be dropped by default");
  assert.deepEqual(handed.map((c) => c.id), ["2", "1"], "the hit moves to the front");
  // The hit carries the ranked facts; the other keeps whatever it had.
  assert.equal(handed[0].facts[0].text, "Dana runs marathons");
  assert.equal(handed[0].facts[0].dimensions[0].code, "physical");
});

test("retrieval returning null leaves the contact set exactly as before", async () => {
  const seen = [];
  const app = buildApp({
    streamViaTogariSearch: capturingRanker(seen),
    retrieveByDimension: async () => null,
  });
  const res = await ask(app, "who do I know in private equity");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(seen[0].map((c) => c.id), ["1", "2"]);
});

test("retrieval throwing does not fail the turn", async () => {
  // A retrieval outage must degrade the ORDER, never the answer. The user still
  // gets their people and their tokens.
  const seen = [];
  const app = buildApp({
    streamViaTogariSearch: capturingRanker(seen),
    retrieveByDimension: async () => {
      throw new Error("pgvector unavailable");
    },
  });
  const res = await ask(app, "who do I know in private equity");
  assert.equal(res.statusCode, 200);
  const events = parseSse(res.body);
  assert.equal(events.at(-1).type, "complete");
  assert.deepEqual(seen[0].map((c) => c.id), ["1", "2"]);
  const tokens = events.filter((e) => e.type === "token").map((e) => e.data.text);
  assert.equal(tokens.join(""), "You should reach out to Neel Patel [[p:1]].");
});

test("retrieval matching a contact the owner no longer holds is ignored", async () => {
  // A contact filtered out as not-real, or deleted since it was embedded, must
  // not resurrect or empty the list.
  const seen = [];
  const app = buildApp({
    streamViaTogariSearch: capturingRanker(seen),
    retrieveByDimension: async () => ({
      contactIds: ["999"],
      factsByContact: { 999: [{ text: "ghost" }] },
      dimensionWeights: null,
      observationCount: 1,
      usedVector: false,
    }),
  });
  const res = await ask(app, "who do I know in private equity");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(seen[0].map((c) => c.id), ["1", "2"]);
});

test("the question reaching retrieval is the user's message", async () => {
  let askedWith = null;
  const app = buildApp({
    retrieveByDimension: async (args) => {
      askedWith = args;
      return null;
    },
  });
  await ask(app, "who should I talk to when I feel anxious");
  assert.ok(askedWith, "retrieval must be called on a people question");
  assert.equal(askedWith.question, "who should I talk to when I feel anxious");
  assert.equal(askedWith.ownerId, TEST_AMBER_ID, "scoped to the owner, never the DID");
  assert.ok(askedWith.limit > 0);
});

// ── how many people did they ask for ──────────────────────────────────────────

test("peopleResultCount honors an explicit count", () => {
  assert.equal(peopleResultCount("give me 5 people to talk to"), 5);
  assert.equal(peopleResultCount("who are three friends I should reconnect with"), 3);
  assert.equal(peopleResultCount("top 10 people in my network for fundraising"), 10);
  assert.equal(peopleResultCount("list 4 contacts who know design"), 4);
  assert.equal(peopleResultCount("show me twenty people"), 20);
  assert.equal(peopleResultCount("find me 2 names"), 2);
});

test("peopleResultCount does NOT read a count out of an incidental number", () => {
  // THE WHOLE REASON THIS IS STRICTER THAN webResultCount. A people question is
  // always list-shaped, so accepting any bare digit would silently truncate
  // these to 3, 30 and 10.
  assert.equal(peopleResultCount("who do I know at 3M"), 15);
  assert.equal(peopleResultCount("who do I know who just turned 30"), 15);
  assert.equal(peopleResultCount("who do I know in the 10th arrondissement"), 15);
  assert.equal(peopleResultCount("who did I meet in 2026"), 15);
  assert.equal(peopleResultCount("who lives on 5th avenue"), 15);
});

test("peopleResultCount defaults on a plain question and on junk", () => {
  assert.equal(peopleResultCount("who do I know in private equity"), 15);
  assert.equal(peopleResultCount(""), 15);
  assert.equal(peopleResultCount(null), 15);
  assert.equal(peopleResultCount(undefined), 15);
});

test("peopleResultCount refuses an implausible count rather than obeying it", () => {
  // Out of range is likelier an address or a year than a request, and the safe
  // direction to fail is the usual number of people.
  assert.equal(peopleResultCount("give me 99 people"), 15);
  assert.equal(peopleResultCount("top 0 people"), 15);
});

test("the requested count reaches the ranker", async () => {
  let askedLimit = null;
  const app = buildApp({
    streamViaTogariSearch: async function* (args) {
      askedLimit = args.limit;
      for (const e of OK_STREAM) yield e;
    },
  });
  const res = await ask(app, "give me 3 people who know private equity");
  assert.equal(res.statusCode, 200);
  assert.equal(askedLimit, 3, "the ranker must be asked for the count the user requested");
});

test("a plain people question still asks the ranker for the default", async () => {
  let askedLimit = null;
  const app = buildApp({
    streamViaTogariSearch: async function* (args) {
      askedLimit = args.limit;
      for (const e of OK_STREAM) yield e;
    },
  });
  await ask(app, "who do I know in private equity");
  assert.equal(askedLimit, 15);
});

test("a multi-part question announces its plan and reports each step as it lands", async () => {
  // THE QUESTION THAT LOOKED LIKE A HANG.
  //
  //   "Recommend the best coffee shops in east village with WiFi ... and then
  //    also recommend me a few VPs of engineering i can reach out to regarding
  //    hardware prototypes in the nyc area"
  //
  // Three asks in one message. Every section used to be collected in silence
  // and emitted at the end, so the user watched a spinner for over a minute and
  // reloaded the app to check it was alive. The contract now: say what the parts
  // are BEFORE doing them, and mark each one done as it lands.
  const app = buildApp({
    classifyIntent: async () => ({ intent: "chat", needsWeb: true }),
    exaSearch: async () => [
      { title: "Best coffee in the East Village", url: "https://example.com/coffee", text: "x".repeat(500), highlights: [] },
    ],
    exaFindPeople: async () => [
      {
        name: "Dana Ruiz",
        title: "VP of Engineering",
        company: "Hardware Co",
        url: "https://www.linkedin.com/in/danaruiz",
        location: "New York",
      },
    ],
    findPlaces: async () => PLACES,
    appendMessage: async (ownerId, msg) => ({ id: "msg-multi", ownerId, ...msg }),
    mergeMessageMetadata: async () => true,
  });

  const res = await ask(
    app,
    "recommend the best coffee shops in east village with wifi, and also find me a few VPs of engineering i can reach out to about hardware prototypes in nyc",
  );
  assert.equal(res.statusCode, 200);
  const events = parseSse(res.body);
  const types = events.map((e) => e.type);

  // 1. THE PLAN, and it arrives before any of the work it describes.
  const plan = events.find((e) => e.type === "plan");
  assert.ok(plan, `no plan event; got ${types.join(",")}`);
  const keys = plan.data.steps.map((s) => s.key);
  assert.ok(keys.includes("places"), `plan missing places: ${keys.join(",")}`);
  assert.ok(keys.includes("web_people"), `plan missing web_people: ${keys.join(",")}`);
  assert.ok(plan.data.steps.every((s) => s.label), "every step needs a label to render");
  assert.ok(types.indexOf("plan") < types.indexOf("places"), "the plan must precede its own steps");

  // 2. EVERY STEP REPORTS BOTH ENDS. A step that starts and never finishes is
  //    the spinner-with-nothing-in-it this whole change is about.
  const stages = events.filter((e) => e.type === "stage");
  for (const key of keys) {
    assert.ok(
      stages.some((s) => s.data.key === key && s.data.state === "start"),
      `no start for ${key}`,
    );
    assert.ok(
      stages.some((s) => s.data.key === key && s.data.state === "done"),
      `no done for ${key}`,
    );
  }

  // 3. AND THE SECTIONS THEMSELVES ARRIVE, each exactly once.
  assert.equal(types.filter((t) => t === "places").length, 1);
  assert.equal(types.filter((t) => t === "web_people").length, 1);
  assert.equal(types.at(-1), "complete");
});

// ── THE CODE-ONLY QUERY PLAN, END TO END ─────────────────────────────────────
//
// The three-part question is the reason any of this exists, so it is asserted
// through the real route: which lanes are promised, in what order, WHICH TEXT
// each lane is asked about, and -- the two that were explicitly asked for --
// that a question about his own people spends no web call and a question about
// the world never touches the address book.

test("a three-part question skips the classifier and plans three lanes fastest-first", async () => {
  // Back to the seeds, so "fastest first" means the seed order and not whatever
  // the tests above happened to leave behind. See the note beside the import.
  _resetLaneSpeeds();
  let classifierCalls = 0;
  const app = buildApp({
    classifyIntent: async () => {
      classifierCalls += 1;
      return { intent: "chat", needsWeb: true };
    },
    findPlaces: async () => [{ name: "Abraço", category: "Coffee", url: "https://abraco.nyc" }],
    exaFindPeople: async () => [
      { name: "Ada Byron", title: "VP Engineering", company: "Acme", url: "https://linkedin.com/in/ada" },
    ],
    exaSearch: async () => [],
  });
  const res = await ask(
    app,
    "Recommend coffee shops in the East Village, tell me who I know nearby, and find me VPs of engineering to talk to about hardware",
  );
  assert.equal(res.statusCode, 200);
  const events = parseSse(res.body);

  // NOT ONE CLASSIFIER HOP. One intent cannot describe three asks, so there is
  // nothing it could add -- and its own rules would have picked the web reading
  // and dropped "who I know nearby" entirely.
  assert.equal(classifierCalls, 0);

  const plan = events.find((e) => e.type === "plan");
  assert.ok(plan, "a multi-part question announces its plan");
  assert.deepEqual(
    plan.data.steps.map((s) => s.key),
    ["people", "web_people", "places"],
    "fastest first: his own people, then LinkedIn, then places",
  );
  // Every part actually came back.
  assert.equal(events.find((e) => e.type === "intent")?.data.intent, "both");
  assert.ok(events.some((e) => e.type === "people"));
  assert.ok(events.some((e) => e.type === "web_people"));
  assert.ok(events.some((e) => e.type === "places"));
});

test("each lane is asked only about its own part of the question", async () => {
  const seen = { places: null, people: null, web: null };
  const app = buildApp({
    classifyIntent: async () => ({ intent: "chat", needsWeb: true }),
    findPlaces: async (q) => {
      seen.places = q;
      return [];
    },
    exaFindPeople: async ({ query }) => {
      seen.people = query;
      return [];
    },
    exaSearch: async ({ query }) => {
      seen.web = query;
      return [];
    },
  });
  await ask(
    app,
    "Recommend coffee shops in the East Village, tell me who I know nearby, and find me VPs of engineering to talk to about hardware",
  );

  assert.match(seen.places, /coffee shops/i);
  assert.doesNotMatch(seen.places, /VPs of engineering/i);
  assert.match(seen.people, /VPs of engineering/i);
  assert.doesNotMatch(seen.people, /coffee shops/i);
  // The grounding search carries the world-facing asks and not the network one.
  if (seen.web) assert.doesNotMatch(seen.web, /who I know/i);
});

test("a question entirely about his own people spends no web call", async () => {
  let exaCalls = 0;
  const app = buildApp({
    // The classifier saying needs_web here is exactly the stray the veto is for.
    classifyIntent: async () => ({ intent: "network_query", needsWeb: true }),
    exaSearch: async () => {
      exaCalls += 1;
      return [];
    },
    exaFindPeople: async () => {
      exaCalls += 1;
      return [];
    },
  });
  const res = await ask(app, "who do I know in private equity");
  assert.equal(res.statusCode, 200);
  assert.equal(exaCalls, 0, "if it is categorized as network, do not look at the web");
  const events = parseSse(res.body);
  assert.ok(events.some((e) => e.type === "people"));
  assert.equal(events.some((e) => e.type === "sources"), false);
});

test("a question entirely about the world never loads the address book", async () => {
  // Cold, or an earlier test's cached payload would hide a load that did happen.
  _clearPreparedInputCache();
  let contactsLoaded = 0;
  let classifierCalls = 0;
  const app = buildApp({
    listContacts: async () => {
      contactsLoaded += 1;
      return CONTACTS;
    },
    classifyIntent: async () => {
      classifierCalls += 1;
      return { intent: "network_query", needsWeb: false };
    },
    exaSearch: async () => [],
    exaFindPeople: async () => [],
  });
  const res = await ask(app, "list me ten VPs of finance in New York");
  assert.equal(res.statusCode, 200);
  assert.equal(classifierCalls, 0, "no first-person claim: there is nothing to classify");
  assert.equal(contactsLoaded, 0, "the address book cannot contain the answer");
});

test("a spoken note is still a journal entry, not a search — but keeps its venue cards", async () => {
  let exaCalls = 0;
  let contactsLoaded = 0;
  let placeQuery = null;
  const app = buildApp({
    classifyIntent: async () => ({ intent: "chat", needsWeb: true }),
    listContacts: async () => {
      contactsLoaded += 1;
      return CONTACTS;
    },
    exaSearch: async () => {
      exaCalls += 1;
      return [];
    },
    exaFindPeople: async () => {
      exaCalls += 1;
      return [];
    },
    findPlaces: async (q) => {
      placeQuery = q;
      return [{ name: "Mala Chinese Cuisine", category: "Sichuan", url: "https://mala.example" }];
    },
  });
  const res = await ask(app, "dinner at Mala Chinese Cuisine with Meet and AJ on Friday", {
    source: "soundboard",
  });
  assert.equal(res.statusCode, 200);
  // No web grounding, no ranker pass over the whole address book.
  assert.equal(exaCalls, 0);
  assert.equal(contactsLoaded, 0);
  // The venue it NAMED still gets a card. This is not a search of the note; it
  // is the place the note is about, and it worked before the planner existed.
  assert.match(String(placeQuery), /Mala/);
  const events = parseSse(res.body);
  assert.ok(events.some((e) => e.type === "places"), "the venue card still lands");
});

test("a people question loads the address book alongside the classifier, not after it", async () => {
  // The prep used to wait for the classifier hop because it was written after
  // it. The plan knows there is a people ask in "who do I know in fintech"
  // before any network call, so the load starts in parallel.
  //
  // THE CACHE HAS TO BE COLD FOR THIS TO MEAN ANYTHING. Every test in this file
  // is the same owner, and the prepared payload is cached per owner for a
  // minute -- so an earlier test's load would satisfy this one and the assertion
  // would pass without the code doing anything.
  _clearPreparedInputCache();
  let contactsStartedAt = 0;
  let classifierDoneAt = 0;
  const app = buildApp({
    listContacts: async () => {
      contactsStartedAt = Date.now();
      return CONTACTS;
    },
    classifyIntent: async () => {
      // A classifier hop is 400ms on a good day. 40ms here, and the address book
      // must already be loading before it returns.
      await new Promise((r) => setTimeout(r, 40));
      classifierDoneAt = Date.now();
      return { intent: "network_query", needsWeb: false };
    },
  });
  const res = await ask(app, "who do I know in fintech");
  assert.equal(res.statusCode, 200);
  assert.ok(contactsStartedAt > 0, "the address book was loaded");
  assert.ok(
    contactsStartedAt < classifierDoneAt,
    `the load started at ${contactsStartedAt} and the classifier answered at ${classifierDoneAt}`,
  );
});

test("ordinary conversation does not load the address book at all", async () => {
  _clearPreparedInputCache();
  // The other half of the same rule: no first-person people ask, so nothing is
  // loaded speculatively while the classifier decides.
  let loads = 0;
  const app = buildApp({
    listContacts: async () => {
      loads += 1;
      return CONTACTS;
    },
    classifyIntent: async () => ({ intent: "chat", needsWeb: false }),
  });
  const res = await ask(app, "what can you do");
  assert.equal(res.statusCode, 200);
  assert.equal(loads, 0);
});

test("every promised step is ticked by the end of the turn", async () => {
  // A lane that produced nothing never sent its own `done`, so the checklist
  // stopped at two of three and sat there spinning next to a part of the answer
  // that was actually finished. A progress bar that can fail to reach the end
  // says the app is still working when it is not.
  _clearPreparedInputCache();
  const app = buildApp({
    classifyIntent: async () => ({ intent: "chat", needsWeb: true }),
    // Every lane comes back empty, which is the case that used to leave spinners.
    exaSearch: async () => [],
    exaFindPeople: async () => [],
    findPlaces: async () => [],
  });
  const res = await ask(
    app,
    "Recommend coffee shops in the East Village, tell me who I know nearby, and find me VPs of engineering to talk to about hardware",
  );
  assert.equal(res.statusCode, 200);
  const events = parseSse(res.body);
  const plan = events.find((e) => e.type === "plan");
  assert.ok(plan, "a multi-part question announces its plan");
  const doneKeys = new Set(
    events.filter((e) => e.type === "stage" && e.data.state === "done").map((e) => e.data.key),
  );
  for (const step of plan.data.steps) {
    assert.ok(doneKeys.has(step.key), `${step.key} never finished`);
  }
  // And the ticks come before the turn ends, not after it.
  const lastDone = events.map((e) => e.type).lastIndexOf("stage");
  assert.ok(lastDone < events.map((e) => e.type).lastIndexOf("complete"));
});

test("each announced step carries the clause it answers", async () => {
  const app = buildApp({
    classifyIntent: async () => ({ intent: "chat", needsWeb: true }),
    exaSearch: async () => [],
    exaFindPeople: async () => [],
    findPlaces: async () => [],
  });
  const res = await ask(
    app,
    "Recommend coffee shops in the East Village, tell me who I know nearby, and find me VPs of engineering to talk to about hardware",
  );
  const plan = parseSse(res.body).find((e) => e.type === "plan");
  const byKey = Object.fromEntries(plan.data.steps.map((s) => [s.key, s.ask]));
  assert.match(byKey.places, /coffee shops/i);
  assert.match(byKey.people, /who I know/i);
  assert.match(byKey.web_people, /VPs of engineering/i);
});

test("a profile that is already a contact comes back marked, and first", async () => {
  const app = buildApp({
    classifyIntent: async () => ({ intent: "chat", needsWeb: true }),
    listContactNamesForOwner: async () => [
      { id: "c1", name: "Neel Patel", company: "Springdale Private Equity" },
    ],
    exaSearch: async () => [],
    exaFindPeople: async () => [
      { name: "Ada Byron", title: "VP Engineering", company: "Acme", url: "https://linkedin.com/in/ada" },
      { name: "Neel Patel", title: "Partner", company: null, url: "https://linkedin.com/in/neel" },
    ],
  });
  const res = await ask(app, "find me VPs of engineering to talk to about hardware");
  const web = parseSse(res.body).find((e) => e.type === "web_people");
  assert.ok(web, "the LinkedIn cards were sent");
  assert.equal(web.data.known, 1);
  assert.equal(web.data.people[0].name, "Neel Patel", "the one he has leads");
  assert.equal(web.data.people[0].existingContactId, "c1");
  assert.equal(web.data.people[1].existingContactId ?? null, null);
});

test("a multi-part question tells the model the section order; a single ask does not", async () => {
  // The cards were separated by lane and the prose was not, so the text above
  // them did not agree with their order -- which is what made three answers in
  // one paragraph read as a jumble.
  //
  // Reset first: this asserts a specific order, and the estimates it reads are
  // process-wide and moved by every test above it. See the note beside the
  // import.
  _resetLaneSpeeds();
  const systems = [];
  const build = () =>
    buildApp({
      classifyIntent: async () => ({ intent: "chat", needsWeb: true }),
      exaSearch: async () => [],
      exaFindPeople: async () => [],
      findPlaces: async () => [],
      streamChat: async ({ system, onToken }) => {
        // `system` is a string on the chat path and an array of cache-able
        // blocks on the `both` path (see the prompt-caching test above), so it
        // is flattened here rather than assumed to be one or the other.
        systems.push(
          Array.isArray(system)
            ? system.map((b) => (typeof b === "string" ? b : b?.text || "")).join("\n")
            : String(system || ""),
        );
        onToken("ok");
        return "ok";
      },
    });
  await ask(
    build(),
    "Recommend coffee shops in the East Village, tell me who I know nearby, and find me VPs of engineering to talk to about hardware",
  );
  const multi = systems.at(-1);
  assert.match(multi, /SEVERAL SEPARATE ASKS/);
  // The order in the instruction is the order of the plan's lanes.
  const people = multi.indexOf("the people he already knows");
  const web = multi.indexOf("people found on the web");
  const places = multi.indexOf("places");
  assert.ok(people > 0 && web > people && places > web, `${people} ${web} ${places}`);
  assert.match(multi, /coffee shops/i, "each part quotes the clause it answers");

  await ask(build(), "what is the best way to learn Rust");
  assert.doesNotMatch(
    systems.at(-1),
    /SEVERAL SEPARATE ASKS/,
    "a single ask must not be turned into a headed report",
  );
});

/**
 * ── THE DAY REACHES THE MODEL ────────────────────────────────────────────────
 *
 *   "What's on my calendar?"
 *   "Calendar is something you'd manage through your phone or calendar app
 *    directly. What I hold is your people: 966 contacts..."
 *
 * The events were in the database and the prompt never saw them. Every piece of
 * this is unit-tested elsewhere -- the window in lib/day-brief.test.js, the
 * recognition in lib/query-plan.test.js -- and none of that would have caught
 * the actual defect, which was that nothing joined them up. So this asserts the
 * wiring: a calendar question puts the real rows in front of the model, and an
 * ordinary one does not pay for four queries it has no use for.
 */
function buildDayApp(deps = {}) {
  const seen = { systems: [], windows: [], onDates: [] };
  const app = buildApp({
    classifyIntent: async () => ({ intent: "chat", needsWeb: false }),
    exaSearch: async () => [],
    findPlaces: async () => [],
    listAgendaEvents: async (owner, args) => {
      seen.windows.push({ owner, ...args });
      return [
        {
          startsAt: "2026-09-12T14:00:00Z",
          endsAt: "2026-09-12T15:00:00Z",
          title: "Quarterly review",
          withPerson: { contactId: "1", name: "Neel Patel" },
          place: { name: "Dumbo" },
        },
      ];
    },
    listScheduledReminders: async () => [],
    listOpenReminders: async (owner, args) => {
      seen.onDates.push(args?.onDate);
      return [{ title: "Find a place for deep work", doneToday: false }];
    },
    listCalendarAccounts: async () => [{ id: "cal-1", provider: "google" }],
    streamChat: async ({ system, onToken }) => {
      seen.systems.push(
        Array.isArray(system)
          ? system.map((b) => (typeof b === "string" ? b : b?.text || "")).join("\n")
          : String(system || ""),
      );
      onToken("ok");
      return "ok";
    },
    ...deps,
  });
  return { app, seen };
}

test("a calendar question puts their actual day in the prompt", async () => {
  _resetLaneSpeeds();
  const { app, seen } = buildDayApp();
  const res = await ask(app, "What's on my calendar?", { timezone: "America/New_York" });
  assert.equal(res.statusCode, 200);

  const system = seen.systems.at(-1) || "";
  assert.match(system, /THEIR DAY, FROM AMBER'S OWN RECORDS/);
  assert.match(system, /Quarterly review/, "the event never reached the model");
  assert.match(system, /10:00 AM/, "the time was not rendered in the user's timezone");
  assert.match(system, /Neel Patel/);
  assert.match(system, /Find a place for deep work/, "the untimed reminders were left out");
  assert.match(system, /1 connected calendar account/);
});

test("the window asked for is the user's local day, not the server's", async () => {
  /**
   * THE CLOCK IS FIXED HERE ON PURPOSE. 20:00Z on the 11th is already 1:30am on
   * the TWELFTH in Kolkata, so every value below differs from the server's own
   * date -- which is the whole question this feature gets right or wrong, and
   * is invisible in a test that runs at whatever time it runs at.
   */
  _resetLaneSpeeds();
  const { app, seen } = buildDayApp({ now: () => new Date("2026-09-11T20:00:00Z") });
  await ask(app, "what does my week look like", { timezone: "Asia/Kolkata" });

  const win = seen.windows.at(-1);
  assert.ok(win, "the events were never read");
  assert.equal(win.owner, TEST_AMBER_ID, "somebody else's day");
  // +05:30, so the local day began at 18:30Z. A whole-hour shortcut lands on
  // 19:00Z and loses the first half hour of it.
  assert.equal(win.from, "2026-09-11T18:30:00.000Z");
  assert.equal(win.to, "2026-09-19T18:30:00.000Z", "eight local days, not eight UTC days");
  // The untimed reminders are asked for by LOCAL date, which is the only date
  // that can answer "is this open today". The server's own date says the 11th.
  assert.equal(seen.onDates.at(-1), "2026-09-12");
});

test("an ordinary question does not go and read the calendar", async () => {
  // Four queries on every "how have you been" would be a tax on the common turn
  // to serve the rare one.
  _resetLaneSpeeds();
  const { app, seen } = buildDayApp();
  await ask(app, "how have you been", { timezone: "America/New_York" });
  assert.equal(seen.windows.length, 0, "read the calendar for a question that was not about it");
  assert.doesNotMatch(seen.systems.at(-1) || "", /THEIR DAY, FROM AMBER'S OWN RECORDS/);
});

test("a calendar read that fails does not take the turn down with it", async () => {
  /**
   * The day is the SECOND thing this turn is for. A database hiccup while
   * fetching it must cost the calendar half of the answer and nothing else --
   * a 500 here would turn a degraded reply into no reply.
   */
  _resetLaneSpeeds();
  const { app, seen } = buildDayApp({
    listAgendaEvents: async () => {
      throw new Error("connection reset");
    },
    listOpenReminders: async () => {
      throw new Error("connection reset");
    },
  });
  const res = await ask(app, "what's on my calendar today", { timezone: "America/New_York" });
  assert.equal(res.statusCode, 200);
  const system = seen.systems.at(-1) || "";
  // Still says what it can, and still refuses to call the day free.
  assert.match(system, /Nothing scheduled in that window/);
  assert.match(system, /not proof of a free day/);
});

/**
 * ── THE FIRST QUESTION ANYBODY ASKS ──────────────────────────────────────────
 *
 *   "Tell me about my network."
 *
 * Wall-to-wall people words, so the planner and the classifier both read it as
 * a request to rank the address book against the word "network". The ranker has
 * nothing to rank, finds nobody, and the reply a beginner reads is "Nothing in
 * your contacts answers that yet" while Amber holds a thousand of their people.
 * Sometimes the classifier said "overview" instead and the same words produced a
 * completely different, good answer. Same question, two answers, coin toss.
 *
 * These pin the routing (always the account, never the ranker) and the content
 * (their real numbers, and the empty state said out loud).
 */
const INVENTORY = {
  contacts: 966,
  contactsWithFacts: 134,
  facts: 402,
  circles: 4,
  circleMembers: 37,
  eventsNext7d: 6,
  eventsTotal: 88,
  openReminders: 2,
  timedRemindersAhead: 0,
  calendarAccounts: 1,
  voiceNotes: 12,
  amberConnections: 5,
  pendingRequests: 0,
};

function buildOrientationApp(deps = {}) {
  const seen = { systems: [], ranked: 0, classified: 0 };
  const app = buildApp({
    classifyIntent: async () => {
      seen.classified += 1;
      // THE WRONG ANSWER ON PURPOSE. Even when the classifier insists this is a
      // people search, the account is what answers it.
      return { intent: "network_query", needsWeb: false };
    },
    streamViaTogariSearch: () => {
      seen.ranked += 1;
      throw new Error("the ranker was asked to answer an orientation question");
    },
    rankViaTogariSearch: async () => {
      seen.ranked += 1;
      return null;
    },
    readAmberInventory: async () => INVENTORY,
    streamChat: async ({ system, onToken }) => {
      seen.systems.push(
        Array.isArray(system)
          ? system.map((b) => (typeof b === "string" ? b : b?.text || "")).join("\n")
          : String(system || ""),
      );
      onToken("ok");
      return "ok";
    },
    ...deps,
  });
  return { app, seen };
}

test("tell me about my network answers from the account, never from the ranker", async () => {
  _resetLaneSpeeds();
  const { app, seen } = buildOrientationApp();
  const res = await ask(app, "Tell me about my network");
  assert.equal(res.statusCode, 200);

  const events = parseSse(res.body);
  const intent = events.find((e) => e.type === "intent")?.data?.intent;
  assert.equal(intent, "overview", "the classifier's network_query won");
  assert.equal(seen.ranked, 0, "the relationship ranker was run on an open-ended question");

  const system = seen.systems.at(-1) || "";
  assert.match(system, /WHAT YOU ACTUALLY HOLD FOR THIS PERSON/);
  assert.match(system, /134 of those 966/, "their real numbers never reached the model");
  assert.match(system, /4 circles/);
});

test("what can Amber do for me is answered with what she is already holding", async () => {
  _resetLaneSpeeds();
  const { app, seen } = buildOrientationApp();
  const res = await ask(app, "What can Amber do for me?");
  const intent = parseSse(res.body).find((e) => e.type === "intent")?.data?.intent;
  assert.equal(intent, "overview");

  const system = seen.systems.at(-1) || "";
  assert.match(system, /THEY ASKED WHAT YOU ARE/);
  assert.match(system, /966 contacts/);
  // Not the other flavor's instruction, or the two questions collapse into one.
  assert.doesNotMatch(system, /THEY ASKED ABOUT THEIR OWN BOOK/);
});

test("every phrasing of the same question lands in the same place", async () => {
  // A QUESTION THIS COMMON CANNOT BE A COIN TOSS. The point is not that any one
  // of these is special: it is that they are all one question.
  for (const phrasing of [
    "Tell me about my contacts",
    "tell me about my network",
    "my network",
    "what do you know about my contacts",
    "What is Amber?",
    "what can you do",
    "how does this work",
  ]) {
    _resetLaneSpeeds();
    const { app, seen } = buildOrientationApp();
    const res = await ask(app, phrasing);
    const intent = parseSse(res.body).find((e) => e.type === "intent")?.data?.intent;
    assert.equal(intent, "overview", `went somewhere else: ${phrasing}`);
    assert.equal(seen.ranked, 0, `ran the ranker on: ${phrasing}`);
  }
});

test("a question with a filter in it still goes to the ranker", async () => {
  // The other half of the contract. Orientation must not swallow a real search.
  _resetLaneSpeeds();
  const { app, seen } = buildOrientationApp({
    streamViaTogariSearch: fakeRankStream(OK_STREAM),
    rankViaTogariSearch: async () => null,
  });
  const res = await ask(app, "tell me about my contacts at Springdale Private Equity");
  const intent = parseSse(res.body).find((e) => e.type === "intent")?.data?.intent;
  assert.notEqual(intent, "overview", "an orientation answer swallowed a real search");
});

test("a brand-new account is told it is empty, not told it is fine", async () => {
  /**
   * "Should work for me, my entire team, their friends, 100000 users that we
   * onboard" -- and every one of those users asks this question on a day when
   * the account holds nothing. The empty answer has to be as good as the full
   * one, which means saying so.
   */
  _resetLaneSpeeds();
  const { app, seen } = buildOrientationApp({
    readAmberInventory: async () => ({
      ...INVENTORY,
      contacts: 0,
      contactsWithFacts: 0,
      facts: 0,
      circles: 0,
      circleMembers: 0,
      eventsNext7d: 0,
      eventsTotal: 0,
      openReminders: 0,
      voiceNotes: 0,
      amberConnections: 0,
      calendarAccounts: 0,
    }),
  });
  await ask(app, "What is Amber?");
  const system = seen.systems.at(-1) || "";
  assert.match(system, /NO contacts yet/);
  assert.match(system, /syncing/i);
});

test("an unreadable account degrades to the answer it would have given anyway", async () => {
  // A snapshot that failed must not become "you have nobody". It contributes
  // nothing and the rest of the turn is unchanged.
  _resetLaneSpeeds();
  const { app, seen } = buildOrientationApp({
    readAmberInventory: async () => {
      throw new Error("connection reset");
    },
  });
  const res = await ask(app, "tell me about my network");
  assert.equal(res.statusCode, 200);
  const system = seen.systems.at(-1) || "";
  assert.doesNotMatch(system, /NO contacts yet/, "a failed read was reported as an empty account");
  assert.doesNotMatch(system, /WHAT YOU ACTUALLY HOLD/);
});

/**
 * ── THE SEARCH THAT KNOWS WHO IS ASKING ──────────────────────────────────────
 *
 *   "There should be understanding of the person asking. The user profile should
 *    be contextualized for the search. If the user is like, 'I'm looking for VPs
 *    of finance to talk to and meet with,' even if they don't say New York, it
 *    should be like, 'Okay, the user is in New York.'"
 *
 * lib/search-brief.test.js pins the brief itself. These pin the wiring, which is
 * the half that was missing entirely: whether the brief is consulted at all,
 * whether it reaches the right lane, and whether a turn still works when the
 * brief does not.
 */
test("THE BRIEF'S QUERY IS WHAT REACHES EXA, NOT THE RAW SENTENCE", async () => {
  _resetLaneSpeeds();
  let searched = null;
  let briefedWith = null;
  const app = buildApp({
    classifyIntent: async () => ({ intent: "chat", needsWeb: true }),
    findPlaces: async () => [],
    exaFindPeople: async () => [],
    buildSearchBrief: async (args) => {
      briefedWith = args;
      return {
        queries: ['VP of Finance "New York"'],
        location: 'New York, NY',
        recency: null,
        category: 'linkedin profile',
        assumption: 'in New York, since that is where you are',
      };
    },
    exaSearch: async (args) => {
      searched = args;
      return [];
    },
  });
  await ask(app, 'find me VPs of finance to talk to and meet with');

  assert.ok(briefedWith, 'the brief was never built');
  assert.equal(searched?.query, 'VP of Finance "New York"', 'the raw sentence went to Exa');
  // The levers this client has always supported and never set.
  assert.equal(searched?.category, 'linkedin profile');
  // AND THE HIGHLIGHTS STILL COME FROM THE USER'S OWN WORDS. The query decides
  // which pages; the highlight decides which sentences of a page already found,
  // and their question is the better thing to ask of it.
  assert.match(String(searched?.highlightQuery), /VPs of finance/i);
});

test("a brief that fails leaves the search exactly as it was", async () => {
  // Web search worked before this existed. A timeout in the brief must cost
  // personalization, not the turn.
  _resetLaneSpeeds();
  let searched = null;
  const app = buildApp({
    classifyIntent: async () => ({ intent: 'chat', needsWeb: true }),
    findPlaces: async () => [],
    exaFindPeople: async () => [],
    buildSearchBrief: async () => {
      throw new Error('timeout');
    },
    exaSearch: async (args) => {
      searched = args;
      return [];
    },
  });
  const res = await ask(app, 'what is the latest on the fed rate decision');
  assert.equal(res.statusCode, 200);
  assert.match(String(searched?.query), /fed rate decision/i);
  assert.equal(searched?.category, null);
});

test('each lane is briefed on ITS OWN part of a multi-part question', async () => {
  /**
   * THE REGRESSION THIS CAUGHT ON THE WAY IN. The first version briefed the
   * whole non-network message once and handed that one query to both lanes, so
   * a search for VPs of engineering carried "coffee shops in the East Village"
   * along with it -- undoing the lane scoping that exists for exactly that.
   */
  _resetLaneSpeeds();
  const briefed = [];
  const seen = { people: null, web: null };
  const app = buildApp({
    classifyIntent: async () => ({ intent: 'chat', needsWeb: true }),
    findPlaces: async () => [],
    buildSearchBrief: async ({ message }) => {
      briefed.push(message);
      return { queries: [`briefed(${message})`], location: null, recency: null, category: null, assumption: null };
    },
    exaFindPeople: async ({ query }) => {
      seen.people = query;
      return [];
    },
    exaSearch: async ({ query }) => {
      seen.web = query;
      return [];
    },
  });
  await ask(
    app,
    'Recommend coffee shops in the East Village, tell me who I know nearby, and find me VPs of engineering to talk to about hardware',
  );

  assert.match(String(seen.people), /VPs of engineering/i);
  assert.doesNotMatch(String(seen.people), /coffee shops/i, 'the other lane rode along');
  // Every brief was asked about one lane's words, never the whole message.
  assert.ok(briefed.length > 0);
});

test('WHAT THE SEARCH ASSUMED REACHES THE ANSWER', async () => {
  // Silently narrowing somebody's search to a city they did not name means a
  // wrong guess looks like a bad search. The answer has to be able to say it.
  _resetLaneSpeeds();
  const systems = [];
  const app = buildApp({
    classifyIntent: async () => ({ intent: 'chat', needsWeb: true }),
    findPlaces: async () => [],
    exaFindPeople: async () => [],
    buildSearchBrief: async () => ({
      queries: ['VP of Finance New York'],
      location: 'New York, NY',
      recency: null,
      category: null,
      assumption: 'in New York, since that is where you are',
    }),
    exaSearch: async () => [
      { title: 'A page', url: 'https://example.com', text: 'Some text about VPs of finance.' },
    ],
    streamChat: async ({ system, onToken }) => {
      systems.push(
        Array.isArray(system)
          ? system.map((b) => (typeof b === 'string' ? b : b?.text || '')).join('\n')
          : String(system || ''),
      );
      onToken('ok');
      return 'ok';
    },
  });
  await ask(app, 'find me VPs of finance to meet');
  assert.match(systems.at(-1) ?? '', /in New York, since that is where you are/);
});
