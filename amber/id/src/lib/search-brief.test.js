/**
 * THE SEARCH THAT KNOWS WHO IS ASKING.
 *
 * The model decides the queries and no test can assert taste. What these pin is
 * everything around that decision, which is where this will actually break:
 * what the model is TOLD about the person, what happens to an answer it gets
 * wrong, and what happens when it does not answer at all.
 *
 * The last one matters most. Web search worked before this existed, badly but
 * reliably, and a brief that turned a timeout into a failed turn would be a
 * clear regression dressed up as an improvement.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  assumptionInstruction,
  buildSearchBrief,
  homeCityOf,
  normalizeBrief,
  profileLine,
  startDateFor,
} from "./search-brief.js";

const PROFILE = {
  displayName: "Karthik",
  currentCity: "New York, NY",
  occupation: "partner at a search fund",
  employers: ["Blue Modern Advisory", { name: "Togari" }],
  school: "Michigan",
  bio: "Building an AI-native relationship app.",
};

/** A model that answers with exactly this object. */
const modelSaying = (obj) => async () => ({
  ok: true,
  json: async () => ({ content: [{ type: "text", text: JSON.stringify(obj) }] }),
});

const build = (over = {}) =>
  buildSearchBrief({
    message: "I'm looking for VPs of finance to talk to and meet with",
    profile: PROFILE,
    apiKey: "test-key",
    fetchImpl: modelSaying({
      queries: ["VP of Finance New York City"],
      location: "New York, NY",
      recency: null,
      category: "linkedin profile",
      assumption: "in New York, since that is where you are",
    }),
    ...over,
  });

test("WHO THEY ARE REACHES THE MODEL, or none of this works", () => {
  /**
   * The whole feature in one assertion. The old code sent Exa the user's
   * sentence and nothing else; if the profile does not make it into the prompt
   * then the model is guessing from the same six words and the brief is
   * theater.
   */
  const line = profileLine(PROFILE);
  assert.match(line, /New York, NY/);
  assert.match(line, /partner at a search fund/);
  assert.match(line, /Blue Modern Advisory/);
  assert.match(line, /Togari/, "an employer stored as an object was dropped");
  assert.match(line, /Michigan/);
});

test("an empty profile is an empty line, not a row of empty labels", () => {
  // Day one is a real state. "Lives in: . Does: ." would be worse than nothing
  // and would teach the model that this person has no city rather than that
  // nobody has said yet.
  assert.equal(profileLine(null), "");
  assert.equal(profileLine({}), "");
  assert.equal(profileLine({ currentCity: "  " }), "");
});

test("the city ladder matches the one contact ranking already uses", () => {
  assert.equal(homeCityOf({ currentCity: "Brooklyn" }), "Brooklyn");
  assert.equal(homeCityOf({ city: "Austin" }), "Austin");
  assert.equal(homeCityOf({ hometown: "Chennai" }), "Chennai");
  assert.equal(homeCityOf({ currentCity: "Brooklyn", hometown: "Chennai" }), "Brooklyn");
  assert.equal(homeCityOf({}), null);
  assert.equal(homeCityOf(null), null);
});

test("the brief comes back with the levers the old path never set", async () => {
  const brief = await build();
  assert.deepEqual(brief.queries, ["VP of Finance New York City"]);
  assert.equal(brief.location, "New York, NY");
  assert.equal(brief.category, "linkedin profile");
  assert.match(brief.assumption ?? "", /New York/);
});

test("A MODEL FAILURE IS YESTERDAY'S SEARCH, NOT A FAILED TURN", async () => {
  /**
   * Web search worked before this existed. Every one of these has to degrade to
   * the user's own words -- which is exactly what the code sent before -- rather
   * than to nothing.
   */
  const cases = [
    { apiKey: null },
    { fetchImpl: async () => ({ ok: false }) },
    {
      fetchImpl: async () => {
        throw new Error("timeout");
      },
    },
    { fetchImpl: async () => ({ ok: true, json: async () => ({ content: [{ text: "not json" }] }) }) },
    { fetchImpl: async () => ({ ok: true, json: async () => ({ content: [] }) }) },
    { fetchImpl: modelSaying({ queries: [] }) },
    { fetchImpl: modelSaying({}) },
  ];
  for (const over of cases) {
    const brief = await build(over);
    assert.deepEqual(
      brief.queries,
      ["I'm looking for VPs of finance to talk to and meet with"],
      `did not fall back: ${JSON.stringify(Object.keys(over))}`,
    );
    assert.equal(brief.location, null);
    assert.equal(brief.assumption, null);
  }
});

test("an empty ask never reaches the model at all", async () => {
  let called = false;
  const brief = await buildSearchBrief({
    message: "   ",
    apiKey: "test-key",
    fetchImpl: async () => {
      called = true;
      return { ok: true, json: async () => ({ content: [] }) };
    },
  });
  assert.equal(called, false, "spent a model call on nothing");
  assert.deepEqual(brief.queries, []);
});

test("A CATEGORY EXA DOES NOT HAVE IS DROPPED, NOT SENT", () => {
  /**
   * An invented category reaches the request body and Exa rejects the whole
   * search -- turning a slightly imaginative brief into no results at all. The
   * same for a recency of "soonish".
   */
  // Real queries: a one-character query is junk and is dropped by the filter
  // below, which would send this down the fallback path and prove nothing.
  const bad = normalizeBrief(
    { queries: ["VP of Finance New York"], category: "people", recency: "soonish" },
    { message: "vps of finance" },
  );
  assert.equal(bad.category, null);
  assert.equal(bad.recency, null);

  const good = normalizeBrief(
    { queries: ["VP of Finance New York"], category: "LinkedIn Profile", recency: "WEEK" },
    { message: "vps of finance" },
  );
  assert.equal(good.category, "linkedin profile", "a valid category was lost to its casing");
  assert.equal(good.recency, "week");
});

test("the fan-out is capped, and junk queries are dropped", () => {
  const brief = normalizeBrief(
    { queries: ["one", "two", "three", "four", "five", "", "  ", "x", 7, null] },
    { message: "counting" },
  );
  assert.equal(brief.queries.length, 3, "an ask fanned out into more searches than the cap");
  assert.deepEqual(brief.queries, ["one", "two", "three"]);
  // A single character is not a search. It reaches Exa as a wildcard and comes
  // back as noise, so it is dropped rather than counted toward the cap.
  assert.ok(!brief.queries.includes("x"));
});

test("the assumption is capped, because it is shown to the user", () => {
  const long = normalizeBrief(
    { queries: ["VP of Finance New York"], assumption: "a".repeat(400) },
    { message: "vps of finance" },
  );
  assert.equal(long.assumption?.length, 160);
});

test("a recency window becomes a real start date, and nothing else does", () => {
  const now = new Date("2026-09-12T12:00:00Z");
  assert.equal(startDateFor("day", now), "2026-09-11T12:00:00.000Z");
  assert.equal(startDateFor("week", now), "2026-09-05T12:00:00.000Z");
  assert.equal(startDateFor(null, now), null);
  assert.equal(startDateFor("soonish", now), null);
});

test("WHAT IT ASSUMED IS SAID OUT LOUD, ONCE", () => {
  /**
   * Adding a city to somebody's search is putting words in their mouth. Silent,
   * it is a wrong guess they cannot correct; at length, it is a paragraph about
   * search plumbing instead of an answer.
   */
  const line = assumptionInstruction({ assumption: "in New York, since that is where you are" });
  assert.match(line, /in New York/);
  assert.match(line, /ONE short clause/);
  assert.equal(assumptionInstruction({ assumption: null }), "");
  assert.equal(assumptionInstruction(null), "");
});

test("the prompt carries the situation, so the stressed-out case can work at all", async () => {
  /**
   * "I'm just looking for people that can help me right now. I'm just so
   * stressed out" is not a search for the phrase "people who can help". The only
   * thing that can turn it into a useful search is knowing about the exams, and
   * the only way the model knows about the exams is if this string is in the
   * prompt.
   */
  let sent = "";
  await buildSearchBrief({
    message: "I'm just looking for people that can help me right now",
    profile: PROFILE,
    situation: "Three reminders this week about the CPA exam.",
    apiKey: "test-key",
    fetchImpl: async (_url, init) => {
      sent = String(init?.body ?? "");
      return { ok: true, json: async () => ({ content: [{ text: '{"queries":["x"]}' }] }) };
    },
  });
  /**
   * ASSERTED AGAINST THE USER TURN, NOT THE WHOLE REQUEST. The system prompt
   * carries worked examples that mention New York, so matching the raw body for
   * "New York" passes even when the profile was never included -- which a
   * mutation proved: deleting profileLine from the prompt changed nothing and
   * every test stayed green. Two values that appear nowhere in the prompt are
   * the ones worth checking.
   */
  const userTurn = JSON.parse(sent).messages[0].content;
  assert.match(userTurn, /CPA exam/, "what is going on with them never reached the model");
  assert.match(userTurn, /Blue Modern Advisory/, "where they work never reached the model");
  assert.match(userTurn, /Michigan/, "where they studied never reached the model");
  assert.match(userTurn, /New York/, "where they live never reached the model");
});

test("the situation is capped so one long day cannot crowd out the ask", async () => {
  let sent = "";
  await buildSearchBrief({
    message: "somewhere to eat",
    situation: "x".repeat(5000),
    apiKey: "test-key",
    fetchImpl: async (_url, init) => {
      sent = String(init?.body ?? "");
      return { ok: true, json: async () => ({ content: [{ text: '{"queries":["y"]}' }] }) };
    },
  });
  const body = JSON.parse(sent);
  const userTurn = body.messages[0].content;
  assert.ok(userTurn.length < 2000, `the prompt ran to ${userTurn.length} characters`);
  assert.match(userTurn, /somewhere to eat/, "the ask itself was crowded out");
});
