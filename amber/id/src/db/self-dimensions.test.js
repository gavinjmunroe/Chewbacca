/**
 * THE SELF COVERAGE SCORE, AND THE ONE MISTAKE THAT WOULD MAKE IT NONSENSE.
 *
 * `contact_id IS NULL AND circle_id IS NULL` reads like "about me" and is not.
 * It also matches every observation about a person Amber could not resolve to a
 * contact card -- the unfiled ones, which carry the spoken name in `raw_name`
 * and which an earlier round of this project added a whole retrieval layer for.
 * Score those as the owner's own and "Marcus got laid off" becomes the OWNER's
 * financial dimension, on a card that claims to say how well Amber knows THEM.
 *
 * getUserFacts in observations-compat.js has exactly that shape, so the wrong
 * version of this was one import away. The first test below is that one.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  KNOWN_AT,
  QUESTION_WEIGHT,
  coverageSummary,
  getSelfDimensionCoverage,
  recordQueryDimensions,
} from "./self-dimensions.js";
import { DIMENSIONS } from "../lib/dimensions.js";
import { __injectPoolForSmokeTests } from "./sql.js";

/**
 * A FAKE POOL THAT RECORDS THE SQL, so a test can assert on the query itself.
 *
 * The decay and the raw_name filter live in SQL, so a test that only checks the
 * returned numbers against rows this file invented would be testing the fake.
 * These check both: the shape of what comes back, and that the statement really
 * does what the comment says.
 */
function fakePool(rowsFor) {
  const seen = [];
  return {
    seen,
    query: async (text, params) => {
      seen.push({ text, params });
      return { rows: rowsFor(text, params) ?? [] };
    },
  };
}

const DIM_ROWS = (over = {}) =>
  DIMENSIONS.map((code, i) => ({
    dimension_id: i + 1,
    code,
    label: code.charAt(0).toUpperCase() + code.slice(1),
    from_facts: over[code]?.facts ?? 0,
    from_questions: over[code]?.questions ?? 0,
    facts: over[code]?.factCount ?? 0,
    questions: over[code]?.questionCount ?? 0,
  }));

test("THE SELF QUERY EXCLUDES UNFILED FACTS ABOUT OTHER PEOPLE", async () => {
  // The whole correctness of the card rests on this one predicate.
  const pool = fakePool(() => DIM_ROWS());
  __injectPoolForSmokeTests(pool);
  await getSelfDimensionCoverage("11111111-1111-1111-1111-111111111111");

  const sql = pool.seen[0].text;
  assert.match(sql, /o\.raw_name IS NULL/, "unfiled facts about other people are being counted as the owner's");
  assert.match(sql, /o\.contact_id IS NULL/);
  assert.match(sql, /o\.circle_id IS NULL/);
  assert.match(sql, /o\.owner_id = \$1/, "the self query is not owner-scoped");
  assert.match(sql, /od\.suppressed = false/, "a suppressed dimension tag still counts");
  assert.match(sql, /deleted_at IS NULL/);
});

test("decay comes from the dimensions table, not from a number in the code", async () => {
  const pool = fakePool(() => DIM_ROWS());
  __injectPoolForSmokeTests(pool);
  await getSelfDimensionCoverage("11111111-1111-1111-1111-111111111111");
  const sql = pool.seen[0].text;
  assert.match(sql, /half_life_days/, "the per-dimension half life is not being used");
  assert.match(sql, /exp\(-ln\(2\)/, "evidence is not decaying at all");
  // Spiritual's half life is 730 days and emotional's is 90 BECAUSE they are
  // different kinds of fact. A constant here would flatten that.
  assert.doesNotMatch(sql, /\/\s*(?:90|180|365|730)(?:\.0)?\s*\)/, "a half life is hardcoded in the SQL");
});

test("every dimension comes back, including the empty ones", async () => {
  const pool = fakePool(() => DIM_ROWS({ social: { facts: 3, factCount: 2 } }));
  __injectPoolForSmokeTests(pool);
  const rows = await getSelfDimensionCoverage("11111111-1111-1111-1111-111111111111");
  assert.equal(rows.length, 6, "a radar that only draws the filled dimensions changes shape as it fills");
  assert.deepEqual(rows.map((r) => r.code), [...DIMENSIONS]);
  assert.equal(rows.find((r) => r.code === "spiritual").score, 0);
  assert.equal(rows.find((r) => r.code === "spiritual").facts, 0);
});

test("a question counts, and counts far less than something you said", async () => {
  const pool = fakePool(() =>
    DIM_ROWS({
      social: { facts: 1, factCount: 1 },
      financial: { questions: 1, questionCount: 1 },
    }),
  );
  __injectPoolForSmokeTests(pool);
  const rows = await getSelfDimensionCoverage("11111111-1111-1111-1111-111111111111");
  const social = rows.find((r) => r.code === "social");
  const financial = rows.find((r) => r.code === "financial");
  assert.equal(social.evidence, 1);
  assert.equal(financial.evidence, QUESTION_WEIGHT);
  assert.ok(financial.evidence < social.evidence, "asking about money outweighed saying something about it");
  // And the halves are reported separately, so the card can say which is which.
  assert.equal(social.fromFacts, 1);
  assert.equal(financial.fromQuestions, 1);
});

test("the score is capped and never leaves 0..1, whatever the evidence", async () => {
  const pool = fakePool(() => DIM_ROWS({ social: { facts: 9999, factCount: 400 } }));
  __injectPoolForSmokeTests(pool);
  const rows = await getSelfDimensionCoverage("11111111-1111-1111-1111-111111111111");
  const social = rows.find((r) => r.code === "social");
  assert.equal(social.score, 1);
  // The uncapped evidence survives, so "just crossed the line" is still tellable
  // from "knows a great deal".
  assert.equal(social.evidence, 9999);
  for (const r of rows) assert.ok(r.score >= 0 && r.score <= 1, `${r.code} scored ${r.score}`);
});

test("KNOWN_AT is the bar, and one fact is not yet knowing somebody", async () => {
  const pool = fakePool(() => DIM_ROWS({ social: { facts: 1 }, physical: { facts: KNOWN_AT } }));
  __injectPoolForSmokeTests(pool);
  const rows = await getSelfDimensionCoverage("11111111-1111-1111-1111-111111111111");
  assert.ok(rows.find((r) => r.code === "social").score < 1);
  assert.equal(rows.find((r) => r.code === "physical").score, 1);
});

test("A BRAND-NEW OWNER GETS SIX ZEROS, NOT AN ERROR AND NOT AN EMPTY LIST", async () => {
  // The first-run state, and the one most likely to be shipped broken.
  const pool = fakePool(() => DIM_ROWS());
  __injectPoolForSmokeTests(pool);
  const rows = await getSelfDimensionCoverage("11111111-1111-1111-1111-111111111111");
  assert.equal(rows.length, 6);
  assert.ok(rows.every((r) => r.score === 0 && r.evidence === 0));
  const s = coverageSummary(rows);
  assert.deepEqual(s, { known: 0, some: 0, empty: 6, total: 6 });
});

test("no owner at all is six zeros and no query", async () => {
  const pool = fakePool(() => DIM_ROWS());
  __injectPoolForSmokeTests(pool);
  const rows = await getSelfDimensionCoverage(null);
  assert.equal(rows.length, 6);
  assert.equal(pool.seen.length, 0, "a missing owner should not reach the database");
});

test("A MISSING TABLE DEGRADES TO ZEROS RATHER THAN BREAKING THE PROFILE", async () => {
  // query_dimensions arrives in a migration. An instance that has not run it
  // must still render the card.
  __injectPoolForSmokeTests({
    query: async () => {
      throw Object.assign(new Error('relation "query_dimensions" does not exist'), { code: "42P01" });
    },
  });
  const rows = await getSelfDimensionCoverage("11111111-1111-1111-1111-111111111111");
  assert.equal(rows.length, 6);
  assert.ok(rows.every((r) => r.score === 0));
});

test("the summary counts dimensions instead of averaging them", () => {
  // An average says the same thing about somebody known deeply on two dimensions
  // and somebody known slightly on all six. Those are different people.
  const deep = DIMENSIONS.map((code, i) => ({ code, score: i < 2 ? 1 : 0 }));
  const broad = DIMENSIONS.map((code) => ({ code, score: 0.33 }));
  assert.deepEqual(coverageSummary(deep), { known: 2, some: 0, empty: 4, total: 6 });
  assert.deepEqual(coverageSummary(broad), { known: 0, some: 6, empty: 0, total: 6 });
  assert.deepEqual(coverageSummary([]), { known: 0, some: 0, empty: 6, total: 6 });
  assert.deepEqual(coverageSummary(null), { known: 0, some: 0, empty: 6, total: 6 });
});

// ── recording what was asked ────────────────────────────────────────────────

test("a question writes one row per dimension it actually touched", async () => {
  const pool = fakePool(() => []);
  __injectPoolForSmokeTests(pool);
  const n = await recordQueryDimensions("11111111-1111-1111-1111-111111111111", {
    social: 0.8,
    emotional: 0.4,
  });
  assert.equal(n, 2);
  const [{ text, params }] = pool.seen;
  assert.match(text, /INSERT INTO query_dimensions/);
  assert.deepEqual(params[1], [5, 2], "dimension ids should be the ontology's, in the order given");
  assert.deepEqual(params[2], [0.8, 0.4]);
});

test("THE CLASSIFIER'S FLOOR IS NOT EVIDENCE ABOUT SOMEBODY'S LIFE", async () => {
  /**
   * The retrieval classifier gives EVERY dimension a floor on purpose, so that
   * retrieval never fully excludes one. Writing those floors down would mean
   * every question ever asked slowly fills in all six dimensions, and the card
   * would converge on "Amber knows you completely" for a user it knows nothing
   * about. Only a dimension the question genuinely leans on is recorded.
   */
  const pool = fakePool(() => []);
  __injectPoolForSmokeTests(pool);
  const n = await recordQueryDimensions("11111111-1111-1111-1111-111111111111", {
    social: 0.9,
    spiritual: 0.05,
    emotional: 0.05,
    physical: 0.05,
    intellectual: 0.05,
    financial: 0.05,
  });
  assert.equal(n, 1, "the floor was written down as though somebody had asked about it");
  assert.deepEqual(pool.seen[0].params[1], [5]);
});

test("an unrecognized dimension is dropped, never guessed at", async () => {
  const pool = fakePool(() => []);
  __injectPoolForSmokeTests(pool);
  const n = await recordQueryDimensions("11111111-1111-1111-1111-111111111111", {
    social: 0.9,
    occupational: 0.9,
    "": 0.9,
    nonsense: 0.9,
  });
  assert.equal(n, 1);
  assert.deepEqual(pool.seen[0].params[1], [5]);
});

test("garbage in writes nothing and throws nothing", async () => {
  const pool = fakePool(() => []);
  __injectPoolForSmokeTests(pool);
  for (const bad of [null, undefined, {}, { social: NaN }, { social: "lots" }, [], "social"]) {
    assert.equal(await recordQueryDimensions("11111111-1111-1111-1111-111111111111", bad), 0);
  }
  assert.equal(await recordQueryDimensions(null, { social: 1 }), 0);
  assert.equal(pool.seen.length, 0, "something with nothing to write still hit the database");
});

test("A FAILED WRITE IS SWALLOWED, because a score must never break an answer", async () => {
  __injectPoolForSmokeTests({
    query: async () => {
      throw new Error("connection terminated unexpectedly");
    },
  });
  assert.equal(await recordQueryDimensions("11111111-1111-1111-1111-111111111111", { social: 0.9 }), 0);
});

test("a score outside 0..1 is clamped rather than rejected by the check constraint", async () => {
  // The classifier is a heuristic and has been tuned more than once. A 1.4 that
  // reaches the insert is a 500 on somebody's question.
  const pool = fakePool(() => []);
  __injectPoolForSmokeTests(pool);
  await recordQueryDimensions("11111111-1111-1111-1111-111111111111", { social: 1.4, emotional: 0.9 });
  for (const s of pool.seen[0].params[2]) assert.ok(s >= 0 && s <= 1, `${s} would violate the CHECK`);
});
