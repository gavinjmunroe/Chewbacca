/**
 * SMOKE TEST — pipeline analytics, and the privacy boundary they promise.
 *
 * The assertion that matters most is the negative one: no fleet function returns
 * a fact body, a name, or a hash. An analytics layer that leaks is worse than no
 * analytics layer, because it leaks continuously and nobody looks.
 */
process.env.IDENTITY_KEY_PEPPER ||= "smoke-only-pepper-not-a-real-secret-0123456789";
import { pool, query, closePool } from "./smoke-db.mjs";
import { __injectPoolForSmokeTests } from "../src/db/sql.js";
import * as O from "../src/db/observations-store.js";
import * as R from "../src/db/retrieval.js";
import * as A from "../src/db/analytics.js";
__injectPoolForSmokeTests(pool);

let pass = 0, fail = 0;
const ok = (c, m, d = "") => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m + (d ? "   " + d : "")); } };

const K = "aaaaaaaa-0000-4000-8000-000000000001";
const K2 = "aaaaaaaa-0000-4000-8000-000000000002";
const C = "11111111-0000-4000-8000-0000000000d1";
const SECRET = "Maggie is quietly seeing a therapist about the divorce";

await query(`TRUNCATE contact_dimension_state, observation_dimensions,
  observation_participants, observations, contact_identity_keys, discovery_keys,
  conversations, contacts, users RESTART IDENTITY CASCADE`);
await query(`INSERT INTO users (amber_id, phone, full_name) VALUES
  ($1,'+14150000001','Karthik'),($2,'+14150000002','Second')`, [K, K2]);
await query(`INSERT INTO contacts (id, owner_id, full_name) VALUES ($1,$2,'Maggie Chen')`, [C, K]);

await O.insertObservation({ ownerId: K, contactId: C, body: SECRET, source: "told_directly", salience: 0.9 });
await O.insertObservation({ ownerId: K, contactId: C, body: "Maggie got a mortgage", source: "enrichment", salience: 0.5 });
await O.insertObservation({ ownerId: K, contactId: C, body: "Her flight lands at 4", source: "voice_note", salience: 0.2 });

console.log("\n── is the stream working ──");
const h = await A.pipelineHealth();
ok(h.observations === 3, "counts the facts", String(h.observations));
ok(h.classification.queue >= 1, "reports the classification backlog", String(h.classification.queue));
ok(h.classification.coveragePct !== null, "and a coverage percentage",
   String(h.classification.coveragePct));
ok(h.embedding.queue === 3 && h.embedding.embedded === 0,
   "the embedding queue is visible before the worker has run",
   JSON.stringify([h.embedding.queue, h.embedding.embedded]));
ok(h.rollup.staleOwners === 1, "and one owner is waiting on a rollup", String(h.rollup.staleOwners));
await R.refreshContactDimensionState(K);
ok((await A.pipelineHealth()).rollup.staleOwners === 0, "which clears once it runs");

console.log("\n── tuning signal ──");
const dims = await A.fleetDimensionDistribution();
ok(dims.length > 0 && dims.every((d) => "avg_confidence" in d),
   "each dimension reports how often it fires and how sure it is",
   JSON.stringify(dims.filter((d) => d.assignments > 0).map((d) => [d.code, d.assignments])));
const sources = await A.fleetSourceMix();
ok(sources.some((s) => s.source === "enrichment"),
   "the source mix separates scraped from told-directly",
   JSON.stringify(sources.map((s) => [s.source, s.observations])));
const daily = await A.fleetDailyVolume({ days: 7 });
ok(daily.length >= 1 && daily.at(-1).observations === 3, "and the daily series counts today");

console.log("\n── the privacy boundary ──");
const fleet = JSON.stringify([
  await A.pipelineHealth(),
  await A.fleetDimensionDistribution(),
  await A.fleetCorrectionRate(),
  await A.fleetSourceMix(),
  await A.fleetDailyVolume({ days: 30 }),
  await A.fleetSnapshot(),
]);
ok(!fleet.includes("therapist") && !fleet.includes("divorce"),
   "NO fleet function returns the text of a fact");
ok(!fleet.includes("Maggie"), "or a contact's name");
ok(!fleet.includes("Karthik") && !fleet.includes(K),
   "or an owner's name or id", fleet.length > 4000 ? "(large payload checked)" : "");
ok(!fleet.includes("+1415"), "or a phone number");

console.log("\n── a small cohort is a person ──");
ok(daily.at(-1).active_owners === null,
   "an owner count below the k-anonymity floor is suppressed, not published",
   JSON.stringify(daily.at(-1)));
const corr = await A.fleetCorrectionRate();
ok(corr.every((c) => c.overrideRatePct === null),
   "and an override rate over three samples is reported as null, not as 33%",
   JSON.stringify(corr.filter((c) => c.model_assigned > 0).map((c) => [c.code, c.model_assigned, c.overrideRatePct])));

console.log("\n── one account's own numbers ──");
const mine = await A.ownerScopedSummary(K);
ok(mine.observations === 3 && mine.contacts === 1, "owner-scoped counts are specific",
   JSON.stringify([mine.observations, mine.contacts]));
ok(Array.isArray(mine.dimensions) && mine.dimensions.length > 0,
   "with their own dimension profile", JSON.stringify(mine.dimensions.map((d) => [d.code, d.top_score])));
ok(!JSON.stringify(mine).includes("therapist"),
   "and STILL no fact text, even for the owner's own summary");
ok((await A.ownerScopedSummary(K2)).observations === 0,
   "a second account sees none of the first account's rows");
ok((await A.ownerScopedSummary("not-a-uuid")) === null, "and junk gets nothing");

console.log(`\n  ${pass} passed, ${fail} failed\n`);
await closePool();
process.exit(fail ? 1 : 0);
