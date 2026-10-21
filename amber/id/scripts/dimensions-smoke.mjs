/**
 * SMOKE TEST — the Six Dimensions as a behavior rather than a schema.
 *
 *     SMOKE_DATABASE_URL=postgres://amber:amber@127.0.0.1:5432/scratch \
 *       node scripts/dimensions-smoke.mjs
 *
 * The property that matters most is the boring one: EVERY observation comes out
 * of insertObservation already classified, or already marked as needing a model.
 * There is no state in which a fact exists and nobody has decided what it is
 * about.
 */
process.env.IDENTITY_KEY_PEPPER ||= "smoke-only-pepper-not-a-real-secret-0123456789";

import { pool, query, closePool } from "./smoke-db.mjs";
import { __injectPoolForSmokeTests } from "../src/db/sql.js";
import * as O from "../src/db/observations-store.js";
import * as Q from "../src/db/dimension-queue.js";
import {
  classifyByLexicon,
  lexiconScores,
  isUncertain,
  DIMENSION_ID,
} from "../src/lib/observation-dimensions.js";

__injectPoolForSmokeTests(pool);

let pass = 0, fail = 0;
const ok = (c, m, d = "") => {
  if (c) { pass++; console.log("  ✓ " + m); }
  else { fail++; console.log("  ✗ " + m + (d ? "   " + d : "")); }
};

const K = "aaaaaaaa-0000-4000-8000-000000000001";
const C = "11111111-0000-4000-8000-0000000000f1";

await query(`TRUNCATE observation_dimensions, observation_participants,
  observation_raw_names, observations, contacts, users RESTART IDENTITY CASCADE`);
await query(`INSERT INTO users (amber_id, phone, full_name) VALUES ($1,'+14150000001','Karthik')`, [K]);
await query(`INSERT INTO contacts (id, owner_id, full_name) VALUES ($1,$2,'Maggie Chen')`, [C, K]);

const dimsOf = async (id) => {
  const { rows } = await query(
    `SELECT d.code, od.confidence, od.weight, od.assigned_by
       FROM observation_dimensions od JOIN dimensions d USING (dimension_id)
      WHERE od.observation_id = $1 ORDER BY od.weight DESC`, [id]);
  return rows;
};
const statusOf = async (id) => (await query(
  `SELECT dimension_status s, dimension_attempts a FROM observations WHERE observation_id=$1`,
  [id])).rows[0];

// ── the lexicon on its own ───────────────────────────────────────────────────
console.log("\n── the lexicon ──");
const laidOff = classifyByLexicon("Maggie got laid off from Stripe last week");
ok(laidOff.dimensions.some((d) => d.code === "financial"),
   "'laid off' reads financial", JSON.stringify(laidOff.dimensions.map((d) => d.code)));
ok(!laidOff.uncertain, "and decisively enough not to need a model");

const surgery = classifyByLexicon("She's having surgery on her knee in March and is anxious about it");
const codes = surgery.dimensions.map((d) => d.code);
ok(codes.includes("physical") && codes.includes("emotional"),
   "a fact can bear on two dimensions at once", JSON.stringify(codes));
ok(surgery.dimensions.length <= 3, "but never on all six -- this is sparse, not a distribution");
ok(surgery.dimensions[0].weight >= surgery.dimensions[1].weight,
   "and they are ordered by how strongly it bears");

const flight = classifyByLexicon("Her flight lands at 4");
ok(flight.dimensions.length === 0, "a fact about nothing gets NO dimensions, not a floor in all six",
   JSON.stringify(flight.dimensions));
ok(flight.uncertain === true, "...and is handed to the model rather than silently dropped");

const weak = classifyByLexicon("He mentioned work");
ok(weak.uncertain === true && weak.dimensions.length === 0,
   "one weak word is not an answer -- 'work' means three things",
   JSON.stringify(lexiconScores("He mentioned work")));
ok(classifyByLexicon("Maggie got laid off").dimensions[0].confidence > 0.65,
   "one DECISIVE term is more convincing than a pile of vague ones",
   JSON.stringify([classifyByLexicon("Maggie got laid off").dimensions[0].confidence,
                   classifyByLexicon("work money job cost").dimensions?.[0]?.confidence]));

ok(classifyByLexicon("brunch").dimensions.length === 0,
   "word boundaries hold: 'brunch' is not a run");

const stacked = classifyByLexicon("New job, new salary, sorting out the mortgage and the budget");
ok(stacked.dimensions[0].code === "financial" && !stacked.uncertain,
   "weak words STACK into a confident answer", JSON.stringify(stacked.dimensions[0]));

const longThin = "We talked for about an hour and covered a lot of ground about the neighborhood " +
  "and the weather and what the plan might be for the next few months and how things are going " +
  "generally speaking without landing on anything much at all in particular this time around ok";
ok(isUncertain(lexiconScores(longThin), longThin) === true,
   "a long note with almost no signal is a note the lexicon mostly did not read");

// ── the write path ───────────────────────────────────────────────────────────
console.log("\n── every insert is classified ──");
const a = await O.insertObservation({
  ownerId: K, contactId: C, body: "Maggie got laid off from Stripe last week", source: "voice_note" });
const aDims = await dimsOf(a.observationId);
ok(aDims.length > 0, "an ordinary insert lands WITH dimensions, no caller involved",
   JSON.stringify(aDims.map((d) => d.code)));
ok(aDims.every((d) => d.assigned_by === "model"), "attributed to the model, not to a person");
ok((await statusOf(a.observationId)).s === "lexicon", "and marked as settled by the lexicon");

const b = await O.insertObservation({
  ownerId: K, contactId: C, body: "Her flight lands at 4", source: "voice_note" });
ok((await dimsOf(b.observationId)).length === 0, "a fact about nothing gets no rows");
ok((await statusOf(b.observationId)).s === "pending", "but IS queued for a model to confirm");

const c = await O.insertObservation({
  ownerId: K, contactId: C, body: "Training for the Boston marathon", source: "manual",
  dimensions: [{ dimensionId: DIMENSION_ID.spiritual, confidence: 1, weight: 1, assignedBy: "human" }],
});
const cDims = await dimsOf(c.observationId);
ok(cDims.length === 1 && cDims[0].code === "spiritual" && cDims[0].assigned_by === "human",
   "an explicit human assignment overrides the lexicon entirely", JSON.stringify(cDims));
ok((await statusOf(c.observationId)).s === "human", "and is never queued");

const d = await O.insertObservation({
  ownerId: K, contactId: C, body: "Something else entirely", source: "manual", dimensions: [] });
ok((await statusOf(d.observationId)).s === "none",
   "an explicit empty list means 'deliberately none', not 'please classify'");

const noneUnclassified = await query(
  `SELECT count(*)::int n FROM observations WHERE dimension_status IS NULL`);
ok(noneUnclassified.rows[0].n === 0, "NO observation is ever in an unclassified state");

// ── the queue ────────────────────────────────────────────────────────────────
console.log("\n── the queue ──");
ok((await Q.pendingCount()) === 1, "one row is waiting for the model",
   String(await Q.pendingCount()));

// THE CLASSIFIER TAKES A BATCH NOW. runDimensionPass hands it every claimed body
// in one array and expects one answer per body, positionally — one HTTP request
// for 25 facts instead of 25 requests each resending the same 151-token preamble.
// A null entry means "no answer for THIS row", never "no dimensions".
const fakeModel = async (texts) =>
  texts.map((text) => ({
    dimensions: text.includes("flight")
      ? []
      : [{ code: "social", dimensionId: DIMENSION_ID.social, confidence: 0.8, weight: 0.9 }],
    method: "llm",
  }));
const pass1 = await Q.runDimensionPass({ limit: 10, classify: fakeModel });
ok(pass1.claimed === 1 && pass1.classified === 1, "the pass claims and classifies it",
   JSON.stringify(pass1));
ok((await statusOf(b.observationId)).s === "none",
   "the model agreed it is about nothing, and it leaves the queue for good");
ok((await Q.pendingCount()) === 0, "the queue is empty");
ok((await Q.runDimensionPass({ limit: 10, classify: fakeModel })).claimed === 0,
   "and a second pass does no work");

// ── ONE CALL FOR THE WHOLE BATCH ────────────────────────────────────────────
//
// The pass used to invoke the classifier once per row. With a 151-token system
// prompt and a 30-token fact, two thirds of every request was the same preamble,
// and 1,034 backlogged facts took forty-eight minutes. This pins the contract so
// it cannot quietly go back to per-row.
console.log("\n── the pass makes ONE call for the whole batch ──");
for (let i = 0; i < 3; i += 1) {
  await O.insertObservation({ ownerId: K, contactId: C, body: `vague thing ${i} about work` });
}
let batchCalls = 0, batchSizes = [];
const countingModel = async (texts) => {
  batchCalls += 1; batchSizes.push(texts.length);
  return texts.map(() => ({ dimensions: [], method: "llm" }));
};
const bp = await Q.runDimensionPass({ limit: 10, classify: countingModel });
ok(batchCalls === 1, "three claimed rows cost ONE classifier call, not three",
   `calls=${batchCalls} sizes=${JSON.stringify(batchSizes)}`);
ok(batchSizes[0] === bp.claimed, "and the batch held every claimed row",
   `${batchSizes[0]} vs claimed ${bp.claimed}`);

// A PARTIAL ANSWER KEEPS WHAT IT COVERED. One unparseable row must not discard
// the rest of the batch.
console.log("\n── a partial answer keeps the rows it did cover ──");
for (let i = 0; i < 3; i += 1) {
  await O.insertObservation({ ownerId: K, contactId: C, body: `another vague ${i} about work` });
}
const partialModel = async (texts) =>
  texts.map((_, i) => (i === 0 ? null : { dimensions: [], method: "llm" }));
const pp = await Q.runDimensionPass({ limit: 10, classify: partialModel });
ok(pp.classified === pp.claimed - 1 && pp.claimed >= 2,
   "every row but the unanswered one is settled; that one retries",
   JSON.stringify(pp));

console.log("\n── the model replaces, it does not merge ──");
const e = await O.insertObservation({ ownerId: K, contactId: C, body: "He mentioned work" });
ok((await statusOf(e.observationId)).s === "pending", "an ambiguous fact is queued");
const beforeCodes = (await dimsOf(e.observationId)).map((r) => r.code);
await Q.runDimensionPass({ limit: 10, classify: fakeModel });
const afterCodes = (await dimsOf(e.observationId)).map((r) => r.code);
ok(afterCodes.length === 1 && afterCodes[0] === "social",
   "the model's answer REPLACES the keyword guess rather than sitting beside it",
   JSON.stringify([beforeCodes, afterCodes]));
ok((await statusOf(e.observationId)).s === "llm", "and the row is marked as the model's");

console.log("\n── a human correction outranks everything ──");
const f = await O.insertObservation({ ownerId: K, contactId: C, body: "He mentioned work again" });
await O.setObservationDimensions({
  observationId: f.observationId,
  dimensions: [{ dimensionId: DIMENSION_ID.emotional, confidence: 1, weight: 1 }],
  assignedBy: "human",
});
await Q.runDimensionPass({ limit: 10, classify: fakeModel });
const fDims = await dimsOf(f.observationId);
ok(fDims.some((r) => r.code === "emotional" && r.assigned_by === "human"),
   "the correction survives the model pass", JSON.stringify(fDims));
ok(!fDims.some((r) => r.code === "social"), "and the model's answer is not written alongside it");
ok((await statusOf(f.observationId)).s === "human", "the row leaves the queue as human-settled");

console.log("\n── an outage degrades, it does not corrupt ──");
const g = await O.insertObservation({ ownerId: K, contactId: C, body: "Something vague about work" });
// A dead model answers null for every row in the batch.
const deadModel = async (texts) => texts.map(() => null);
let last;
for (let i = 0; i < 4; i += 1) last = await Q.runDimensionPass({ limit: 10, classify: deadModel });
const gStatus = await statusOf(g.observationId);
ok(gStatus.a === 3, "attempts are capped, so a dead API is not an unbounded bill", String(gStatus.a));
ok(gStatus.s !== "pending", "the row eventually settles for what the lexicon said", gStatus.s);
ok(last.claimed === 0, "and stops being claimed once it is out of attempts");

const h = await O.insertObservation({ ownerId: K, contactId: C, body: "Another vague one about work" });
await Q.runDimensionPass({ limit: 10, classify: deadModel });
ok((await statusOf(h.observationId)).s === "pending",
   "ONE failure does not downgrade a row -- it is retried", (await statusOf(h.observationId)).s);

// ── retrieval ────────────────────────────────────────────────────────────────
console.log("\n── retrieval can finally filter by dimension ──");
await O.insertObservation({ ownerId: K, contactId: C, body: "Maggie is training for a half marathon and quit drinking" });
await O.insertObservation({ ownerId: K, contactId: C, body: "Maggie got promoted to VP and a big raise" });
const physical = await query(
  `SELECT o.body FROM observations o
     JOIN observation_dimensions od USING (observation_id)
    WHERE o.owner_id = $1 AND o.contact_id = $2 AND od.dimension_id = $3
      AND od.suppressed = false AND o.deleted_at IS NULL
    ORDER BY od.weight DESC`,
  [K, C, DIMENSION_ID.physical]);
ok(physical.rows.some((r) => r.body.includes("half marathon")),
   "the physical facts about a contact are one join away", JSON.stringify(physical.rows.length));
const financial = await query(
  `SELECT o.body FROM observations o
     JOIN observation_dimensions od USING (observation_id)
    WHERE o.owner_id = $1 AND o.contact_id = $2 AND od.dimension_id = $3
      AND od.suppressed = false AND o.deleted_at IS NULL`,
  [K, C, DIMENSION_ID.financial]);
ok(financial.rows.some((r) => r.body.includes("promoted")), "and so are the financial ones");
ok(!financial.rows.some((r) => r.body.includes("half marathon")),
   "a dimension filter that matches everything would not be a filter");

const plan = await query(
  `EXPLAIN (FORMAT JSON) SELECT observation_id FROM observations
    WHERE dimension_status = 'pending' AND deleted_at IS NULL ORDER BY created_at LIMIT 25`);
ok(JSON.stringify(plan.rows[0]["QUERY PLAN"]).includes("obs_dimension_pending_idx"),
   "the queue drains off its partial index, so its cost does not grow with the table");

console.log(`\n  ${pass} passed, ${fail} failed\n`);
await closePool();
process.exit(fail ? 1 : 0);
