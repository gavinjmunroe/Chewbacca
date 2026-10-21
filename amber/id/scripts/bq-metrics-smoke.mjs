/**
 * SMOKE TEST — the warehouse export, and what it is allowed to carry.
 */
process.env.IDENTITY_KEY_PEPPER ||= "smoke-only-pepper-not-a-real-secret-0123456789";
import { pool, query, closePool } from "./smoke-db.mjs";
import { __injectPoolForSmokeTests } from "../src/db/sql.js";
import * as O from "../src/db/observations-store.js";
import { exportFleetSnapshot, snapshotToRows, METRICS_DDL } from "../src/pdw/bq-metrics.js";
import * as A from "../src/db/analytics.js";
__injectPoolForSmokeTests(pool);

let pass = 0, fail = 0;
const ok = (c, m, d = "") => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m + (d ? "   " + d : "")); } };

const K = "aaaaaaaa-0000-4000-8000-000000000001";
const C = "11111111-0000-4000-8000-0000000000e1";
const SECRET = "Maggie is quietly seeing a therapist about the divorce";
await query(`TRUNCATE contact_dimension_state, observation_dimensions, observation_participants,
  observations, contacts, users RESTART IDENTITY CASCADE`);
await query(`INSERT INTO users (amber_id, phone, full_name) VALUES ($1,'+14150000001','Karthik')`, [K]);
await query(`INSERT INTO contacts (id, owner_id, full_name) VALUES ($1,$2,'Maggie Chen')`, [C, K]);
await O.insertObservation({ ownerId: K, contactId: C, body: SECRET, source: "told_directly", salience: 0.9 });
await O.insertObservation({ ownerId: K, contactId: C, body: "Maggie got a mortgage", source: "enrichment" });

console.log("\n── the export ──");
const captured = [];
const res = await exportFleetSnapshot({ write: async (t, row) => { captured.push([t, row]); return true; } });
ok(res.skipped === false && res.written > 0, "a snapshot produces metric rows", JSON.stringify([res.rows, res.written, res.failed]));
ok(captured.every(([, r]) => r.scope === "fleet"), "every row is fleet-scoped");
ok(captured.every(([, r]) => typeof r.value === "number" && Number.isFinite(r.value)),
   "every value is a finite number");
ok(captured.some(([, r]) => r.metric === "classification.coverage_pct"), "coverage is exported");
ok(captured.some(([, r]) => r.metric === "dimension.observations" && r.key), "per-dimension rows carry their code",
   JSON.stringify(captured.filter(([, r]) => r.metric === "dimension.observations").map(([, r]) => [r.key, r.value])));

console.log("\n── what may not leave ──");
const payload = JSON.stringify(captured);
ok(!payload.includes("therapist") && !payload.includes("divorce"), "no fact text reaches the warehouse");
ok(!payload.includes("Maggie") && !payload.includes("Karthik"), "no names");
ok(!payload.includes(K) && !payload.includes(C), "no owner or contact ids");
ok(!payload.includes("+1415"), "no phone numbers");

console.log("\n── null is not zero ──");
const snap = await A.fleetSnapshot();
const rows = snapshotToRows(snap);
ok(!rows.some((r) => r.metric === "daily.active_owners"),
   "a suppressed cohort is DROPPED, not written as 0 -- 'we will not say' is not 'there were none'");
const withNulls = snapshotToRows({
  health: snap.health, dimensions: [], corrections: [
    { code: "financial", overridden: 1, human_added: 0, overrideRatePct: null }], sources: [], today: null });
ok(withNulls.some((r) => r.metric === "correction.overridden" && r.key === "financial"),
   "a real number beside a suppressed one still exports");
ok(!withNulls.some((r) => r.metric === "correction.override_rate_pct"),
   "and the suppressed one does not");

console.log("\n── failure is reported, not swallowed ──");
const partial = await exportFleetSnapshot({ write: async (t, row) => row.metric !== "observations.total" });
ok(partial.failed >= 1 && partial.written > 0,
   "a rejected row is counted -- a metrics pipeline that stops silently is a flat chart nobody questions",
   JSON.stringify([partial.written, partial.failed]));

console.log("\n── the DDL is printed, not executed ──");
ok(METRICS_DDL.includes("PARTITION BY DATE(captured_at)"), "partitioned by day, so a scan is a day not a history");
ok(METRICS_DDL.includes("CLUSTER BY metric, key"), "and clustered on what every chart filters by");

console.log(`\n  ${pass} passed, ${fail} failed\n`);
await closePool();
process.exit(fail ? 1 : 0);
