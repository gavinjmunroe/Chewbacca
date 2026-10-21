/**
 * The demo, as arithmetic: Alex needs to exercise, Sarah is starting a run
 * club, they met at a party, the note is three days old. If that does not score
 * above the threshold nothing else in the product matters.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  scoreMatch, rankMatches, kindFit, degreeWeight, freshness,
  similarityFromDistance, isWorthSurfacing, MIN_SCORE, MAX_PER_SCAN,
} from "./intent-match.js";

const NOW = Date.parse("2026-09-29T00:00:00Z");
const ago = (d) => new Date(NOW - d * 86_400_000).toISOString();

// "I really need to focus on exercising more" vs "starting a run club":
// different words, close meaning, so a low cosine distance.
const RUN_CLUB = { distance: 0.22, kindA: "seeking", kindB: "offer", createdAt: ago(3) };

test("THE RUN CLUB MATCH SURFACES", () => {
  const score = scoreMatch({ ...RUN_CLUB, degree: 1 }, { now: NOW });
  assert.ok(isWorthSurfacing(score), `scored ${score.toFixed(3)}, threshold ${MIN_SCORE}`);
});

test("AN UNRELATED THOUGHT NEVER SURFACES, however well the shapes fit", () => {
  // A perfect seeking/offer pair about two different subjects is not a match.
  // This is why the terms multiply instead of summing.
  const score = scoreMatch(
    { distance: 0.9, kindA: "seeking", kindB: "offer", degree: 1, createdAt: ago(1) },
    { now: NOW },
  );
  assert.equal(score, 0);
});

test("TWO OFFERS ARE A COINCIDENCE, NOT AN INTRODUCTION", () => {
  // Two people each starting a run club have nothing to say to each other that
  // an introduction would help with.
  assert.equal(kindFit("offer", "offer"), 0);
  assert.equal(
    scoreMatch({ distance: 0.05, kindA: "offer", kindB: "offer", degree: 1, createdAt: ago(1) }, { now: NOW }),
    0,
  );
});

test("SARAH DID NOT HAVE TO ASK FOR ANYTHING", () => {
  // She stated a fact. An offer against a seeking is the strongest fit there
  // is, and a plain 'doing' still matches a seeking, because a fact about
  // somebody is actionable by whoever needs it.
  assert.equal(kindFit("seeking", "offer"), 1);
  assert.ok(kindFit("seeking", "doing") > 0);
  // Two people who both want the same missing thing should start it together.
  assert.ok(kindFit("seeking", "seeking") > 0);
});

test("EVERY DEGREE CAN ACTUALLY PRODUCE A PROPOSAL", () => {
  // The first weighting made the third hop unreachable: it needed a similarity
  // above 1.0 to clear the threshold, so the feature existed and could never
  // fire. A tight third-degree match must be able to surface.
  for (const degree of [1, 2, 3]) {
    const tight = scoreMatch({ distance: 0.08, kindA: "seeking", kindB: "offer", degree, createdAt: ago(1) }, { now: NOW });
    assert.ok(isWorthSurfacing(tight), `degree ${degree} cannot ever surface (scored ${tight.toFixed(3)})`);
  }
  // And an ordinary match three hops out still loses.
  const ordinary = scoreMatch({ ...RUN_CLUB, degree: 3 }, { now: NOW });
  assert.ok(!isWorthSurfacing(ordinary), "a mediocre third-degree match should not interrupt anybody");
});

test("nearer beats further, all else equal", () => {
  const at = (degree) => scoreMatch({ ...RUN_CLUB, degree }, { now: NOW });
  assert.ok(at(1) > at(2));
  assert.ok(at(2) > at(3));
  assert.equal(degreeWeight(4), 0, "a fourth hop is not reachable");
  assert.equal(degreeWeight(0), 0, "nobody is their own contact");
});

test("A FRESH THOUGHT BEATS AN ABANDONED ONE", () => {
  const fresh = scoreMatch({ ...RUN_CLUB, degree: 1, createdAt: ago(3) }, { now: NOW });
  const stale = scoreMatch({ ...RUN_CLUB, degree: 1, createdAt: ago(365) }, { now: NOW });
  assert.ok(fresh > stale * 2);
  assert.ok(!isWorthSurfacing(stale), "a year-old resolution should not be surfaced as news");
  // Floored, not erased: an old intent ranks low rather than vanishing.
  assert.ok(freshness(ago(9999), NOW) > 0);
  // An unparseable date is treated as middling rather than as brand new.
  assert.equal(freshness(null, NOW), 0.5);
});

test("a dormant contact is nudged down, never scored out", () => {
  // Part of the point is surfacing people you have NOT been talking to.
  const close = scoreMatch({ ...RUN_CLUB, degree: 1, relationshipStrength: 1 }, { now: NOW });
  const dormant = scoreMatch({ ...RUN_CLUB, degree: 1, relationshipStrength: 0 }, { now: NOW });
  assert.ok(close > dormant);
  assert.ok(isWorthSurfacing(dormant), "a dormant contact must still be able to match");
});

test("distance maps sanely, and garbage scores nothing", () => {
  assert.equal(similarityFromDistance(0), 1);
  assert.equal(similarityFromDistance(2), 0);
  assert.equal(similarityFromDistance(NaN), 0);
  assert.equal(similarityFromDistance(undefined), 0);
  assert.equal(scoreMatch({}, { now: NOW }), 0);
  assert.equal(scoreMatch(undefined, { now: NOW }), 0);
});

// ── what a person actually gets shown ───────────────────────────────────────

test("ONE PROPOSAL PER PERSON, however many of their intents matched", () => {
  // Two of Sarah's notes both fitting is still one conversation to have with
  // Sarah, and showing it twice reads as a broken app.
  const ranked = rankMatches(
    [
      { ownerId: "sarah", ...RUN_CLUB, degree: 1 },
      { ownerId: "sarah", distance: 0.1, kindA: "seeking", kindB: "offer", degree: 1, createdAt: ago(1) },
      { ownerId: "jack", ...RUN_CLUB, degree: 1 },
    ],
    { now: NOW },
  );
  assert.equal(ranked.filter((r) => r.ownerId === "sarah").length, 1);
  // And the better of Sarah's two is the one kept.
  assert.equal(ranked.find((r) => r.ownerId === "sarah").distance, 0.1);
});

test("A LIMIT IS PART OF THE PRODUCT", () => {
  // Six introductions in one sitting is a chore, and the failure mode is that
  // people stop reading the feed, which loses the good match with the rest.
  const many = Array.from({ length: 12 }, (_, i) => ({
    ownerId: `p${i}`, ...RUN_CLUB, degree: 1,
  }));
  assert.equal(rankMatches(many, { now: NOW }).length, MAX_PER_SCAN);
});

test("nothing worth saying produces nothing", () => {
  assert.deepEqual(rankMatches([], { now: NOW }), []);
  assert.deepEqual(rankMatches(null, { now: NOW }), []);
  const weak = [{ ownerId: "x", distance: 0.5, kindA: "doing", kindB: "doing", degree: 3, createdAt: ago(200) }];
  assert.deepEqual(rankMatches(weak, { now: NOW }), []);
});
