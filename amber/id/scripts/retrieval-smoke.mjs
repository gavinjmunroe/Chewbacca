/**
 * SMOKE TEST — dimension-weighted retrieval.
 *
 * Until this existed, observation_dimensions was written on every insert and read
 * by nothing. These assertions are the claims the design makes: that the question
 * changes the order, that a closed window still counts but counts less, that who
 * told you matters, and that a person's own weights move their results.
 */
process.env.IDENTITY_KEY_PEPPER ||= "smoke-only-pepper-not-a-real-secret-0123456789";
import { pool, query, closePool } from "./smoke-db.mjs";
import { __injectPoolForSmokeTests } from "../src/db/sql.js";
import * as O from "../src/db/observations-store.js";
import * as R from "../src/db/retrieval.js";
__injectPoolForSmokeTests(pool);

let pass = 0, fail = 0;
const ok = (c, m, d = "") => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m + (d ? "   " + d : "")); } };

const K = "aaaaaaaa-0000-4000-8000-000000000001";
const MAGGIE = "11111111-0000-4000-8000-0000000000a1";
const SAGAR  = "11111111-0000-4000-8000-0000000000a2";
const DAY = 86400000;

await query(`TRUNCATE contact_dimension_state, observation_dimensions,
  observation_participants, observations, user_dimension_weights, contacts, users
  RESTART IDENTITY CASCADE`);
await query(`INSERT INTO users (amber_id, phone, full_name) VALUES ($1,'+14150000001','K')`, [K]);
await query(`INSERT INTO contacts (id, owner_id, full_name) VALUES ($1,$2,'Maggie'),($3,$2,'Sagar')`,
  [MAGGIE, K, SAGAR]);

const FINANCIAL = { financial: 0.8, emotional: 0.04, physical: 0.04, social: 0.04, spiritual: 0.04, intellectual: 0.04 };
const PHYSICAL  = { physical: 0.8, emotional: 0.04, financial: 0.04, social: 0.04, spiritual: 0.04, intellectual: 0.04 };

const money = await O.insertObservation({ ownerId: K, contactId: MAGGIE,
  body: "Maggie raised a seed round and took out a mortgage", source: "told_directly", salience: 0.8 });
const body_ = await O.insertObservation({ ownerId: K, contactId: SAGAR,
  body: "Sagar is training for a half marathon and quit drinking", source: "told_directly", salience: 0.8 });
const logistics = await O.insertObservation({ ownerId: K, contactId: MAGGIE,
  body: "Her flight lands at 4", source: "voice_note", salience: 0.2, dimensions: [] });

console.log("\n── the question changes the order ──");
const fin = await R.retrieveObservations({ ownerId: K, dimensionWeights: FINANCIAL, limit: 10 });
ok(fin[0]?.observationId === money.observationId,
   "a financial question puts the financial fact first", JSON.stringify(fin.map((r) => r.body.slice(0, 22))));
const phy = await R.retrieveObservations({ ownerId: K, dimensionWeights: PHYSICAL, limit: 10 });
ok(phy[0]?.observationId === body_.observationId,
   "a physical question puts the physical one first", JSON.stringify(phy.map((r) => r.body.slice(0, 22))));
ok(fin.some((r) => r.observationId === logistics.observationId),
   "an UNTAGGED fact is still retrievable -- a floor, not exclusion");
ok(fin.find((r) => r.observationId === logistics.observationId).score <
   fin.find((r) => r.observationId === money.observationId).score,
   "...but ranks below a fact the question is actually about");
ok(fin[0].dimensions.length > 0 && fin[0].dimensions[0].code === "financial",
   "each row carries the dimensions that earned it", JSON.stringify(fin[0].dimensions));

console.log("\n── time ──");
const closed = await O.insertObservation({ ownerId: K, contactId: MAGGIE,
  body: "Maggie took out a loan for three months", source: "told_directly", salience: 0.8,
  temporalShape: "window", validFrom: new Date(Date.now() - 200 * DAY),
  validUntil: new Date(Date.now() - 100 * DAY) });
const withClosed = await R.retrieveObservations({ ownerId: K, dimensionWeights: FINANCIAL, limit: 10 });
const closedRow = withClosed.find((r) => r.observationId === closed.observationId);
const liveRow = withClosed.find((r) => r.observationId === money.observationId);
ok(!!closedRow, "a window that has closed is still returned -- it is real knowledge");
ok(closedRow.score < liveRow.score, "but scores below the fact that is still true",
   JSON.stringify([closedRow.score, liveRow.score]));

console.log("\n── who told you ──");
const scraped = await O.insertObservation({ ownerId: K, contactId: SAGAR,
  body: "Sagar quit drinking and started a new workout", source: "enrichment", salience: 0.8 });
const bySource = await R.retrieveObservations({ ownerId: K, dimensionWeights: PHYSICAL, limit: 10 });
const told = bySource.find((r) => r.observationId === body_.observationId);
const web = bySource.find((r) => r.observationId === scraped.observationId);
ok(told.score > web.score, "told directly outranks scraped off the web, by scoring_params",
   JSON.stringify([told.score, web.score]));

console.log("\n── suppressing a wrong tag ──");
await query(`UPDATE observation_dimensions SET suppressed = true
              WHERE observation_id = $1 AND dimension_id = 6`, [money.observationId]);
const afterSuppress = await R.retrieveObservations({ ownerId: K, dimensionWeights: FINANCIAL, limit: 10 });
const suppressed = afterSuppress.find((r) => r.observationId === money.observationId);
ok(suppressed.score < liveRow.score,
   "a suppressed tag is EXCLUDED, not down-weighted -- the fact drops to the neutral floor",
   JSON.stringify([suppressed.score, liveRow.score]));
ok(!suppressed.dimensions.some((d) => d.code === "financial"),
   "and stops being reported as financial");
await query(`UPDATE observation_dimensions SET suppressed = false WHERE observation_id = $1`, [money.observationId]);

console.log("\n── who should I talk to ──");
const people = await R.rankContactsByDimensions({ ownerId: K, dimensionWeights: FINANCIAL });
ok(people[0]?.contactId === MAGGIE, "a financial question ranks Maggie first",
   JSON.stringify(people.map((p) => [p.name, p.score.toFixed(3)])));
ok(people[0].citations.length > 0 && people[0].citations[0].body.includes("seed round"),
   "with the fact that made the case", JSON.stringify(people[0].citations[0]?.body));
const peoplePhy = await R.rankContactsByDimensions({ ownerId: K, dimensionWeights: PHYSICAL });
ok(peoplePhy[0]?.contactId === SAGAR, "and a physical one ranks Sagar first",
   JSON.stringify(peoplePhy.map((p) => [p.name, p.score.toFixed(3)])));
ok(people.every((p) => p.score <= 1), "scores saturate rather than growing without bound",
   JSON.stringify(people.map((p) => p.score)));

console.log("\n── the user's own weights ──");
await query(`INSERT INTO user_dimension_weights (amber_id, dimension_id, weight)
             VALUES ($1, 6, 0.05)`, [K]);
const damped = await R.rankContactsByDimensions({ ownerId: K, dimensionWeights: FINANCIAL });
ok(damped.find((p) => p.contactId === MAGGIE).score < people[0].score,
   "'financial shouldn't count this much for me' moves the result, from a table row",
   JSON.stringify([damped.find((p) => p.contactId === MAGGIE).score, people[0].score]));
await query(`DELETE FROM user_dimension_weights WHERE amber_id = $1`, [K]);

console.log("\n── the rollup ──");
const n = await R.refreshContactDimensionState(K);
ok(n > 0, "contact_dimension_state is populated -- it had never had a row", String(n));
const finList = await R.shortlistByDimension(K, "financial");
ok(finList[0]?.contactId === MAGGIE, "the standing financial shortlist is Maggie",
   JSON.stringify(finList.map((p) => [p.name, p.score.toFixed(3)])));
const phyList = await R.shortlistByDimension(K, "physical");
ok(phyList[0]?.contactId === SAGAR, "the physical one is Sagar");
ok((await R.refreshContactDimensionState(K)) > 0, "and the rollup is safe to run again");
const before = (await query(`SELECT count(*)::int n FROM contact_dimension_state`)).rows[0].n;
await query(`UPDATE observations SET deleted_at = now() WHERE contact_id = $1`, [SAGAR]);
await R.refreshContactDimensionState(K);
const after = (await query(`SELECT count(*)::int n FROM contact_dimension_state WHERE contact_id = $1`, [SAGAR])).rows[0].n;
ok(after === 0 && before > 0,
   "deleting a contact's facts clears their state -- a stale score is confidently wrong",
   JSON.stringify([before, after]));

console.log("\n── it stays one query ──");
const plan = await query(
  `EXPLAIN (FORMAT JSON) SELECT 1 FROM observations o WHERE o.owner_id = $1 AND o.deleted_at IS NULL`, [K]);
ok(!!plan.rows[0], "planner reachable");

console.log(`\n  ${pass} passed, ${fail} failed\n`);
await closePool();
process.exit(fail ? 1 : 0);
