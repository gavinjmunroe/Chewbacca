// Throwaway integration smoke for the F6 enrichment HTTP surface, against live
// Cloud SQL (stub enrichment provider). Boots a minimal Fastify with a stubbed
// requireAuth (injects a synthetic owner) and drives the real route handlers via
// app.inject — so batch/commit/summary logic is exercised end-to-end over the
// F1/F2 engine. No network, no deploy.
//
// Run: railway run node scripts/smoke-f6api.js   — safe to delete after.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-smoke-f6.json");
  fs.writeFileSync(tmp, credsJson);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const Fastify = (await import("fastify")).default;
const { query } = await import("../src/db/sql.js");
const { setContactEnrichmentCandidates } = await import("../src/db/store.js");
const { registerContactEnrichmentRoutes } = await import("../src/routes/contacts-enrich.js");

let failed = false;
function check(label, cond, detail) {
  if (cond) console.log(`✅ ${label}`);
  else {
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
    failed = true;
  }
}

const OWNER = randomUUID();
const rnd = () => String(Math.floor(1000000 + Math.random() * 8999999));
const suffix = rnd();
const OWNER_PHONE = "+1995" + suffix;

// Stub auth: every request is the synthetic owner (phone → resolveAmberIdByPhone).
const stubAuth = async (request) => {
  request.privyUser = { userId: OWNER, phone: OWNER_PHONE };
};

const app = Fastify();
registerContactEnrichmentRoutes(app, { requireAuth: stubAuth });

// Two candidates in the STORED ranked shape [{ candidate, score, signals }].
const candidateArray = [
  { candidate: { linkedinUrl: "https://linkedin.com/in/xavier-a", title: "VP", company: "Acme", city: "Chicago", industry: "Tech" }, score: 3, signals: [{ signal: "same_city", weight: 2 }] },
  { candidate: { linkedinUrl: "https://linkedin.com/in/xavier-b", title: "Director", company: "Globex", city: "Denver" }, score: 1.5, signals: [] },
];

let cA, cB;

try {
  await app.ready();

  // Synthetic owner (pre-inserted so resolveAmberIdByPhone resolves, not creates).
  await query(
    `INSERT INTO users (amber_id, phone, status, full_name, current_city, privacy_tier)
     VALUES ($1, $2, 'active', 'Owner F6', 'Chicago', 'full_social')`,
    [OWNER, OWNER_PHONE],
  );
  // Two contacts with distinct sources; unenriched to start.
  const ins = await query(
    `INSERT INTO contacts (owner_id, full_name, source)
     VALUES ($1, 'Xavier Apple', 'apple'), ($1, 'Yara Google', 'google')
     RETURNING id, source`,
    [OWNER],
  );
  cA = String(ins.rows.find((r) => r.source === "apple").id);
  cB = String(ins.rows.find((r) => r.source === "google").id);

  // ── 1) POST /enrich over both ids → tally + per-contact results ──
  const enrichRes = await app.inject({
    method: "POST",
    url: "/v1/me/contacts/enrich",
    payload: { contactIds: [cA, cB] },
  });
  check("enrich 200", enrichRes.statusCode === 200, `status=${enrichRes.statusCode}`);
  const enrichBody = JSON.parse(enrichRes.payload);
  const t = enrichBody.tally || {};
  check("enrich results: one per contact", Array.isArray(enrichBody.results) && enrichBody.results.length === 2, JSON.stringify(enrichBody.results));
  check("enrich tally sums to 2", (t.auto || 0) + (t.ambiguous || 0) + (t.none || 0) === 2, JSON.stringify(t));

  // ── 2) Force cA into 'ambiguous' with a stored candidate array ──
  await setContactEnrichmentCandidates(OWNER, cA, candidateArray);

  // ── 3) POST /:id/enrichment/resolve with a valid candidate → resolved ──
  const resolveRes = await app.inject({
    method: "POST",
    url: `/v1/me/contacts/${cA}/enrichment/resolve`,
    payload: { candidateIndex: 0 },
  });
  check("resolve 200", resolveRes.statusCode === 200, `status=${resolveRes.statusCode}`);
  const resolved = JSON.parse(resolveRes.payload).contact || {};
  check("resolve: status 'resolved'", resolved.enrichmentStatus === "resolved", JSON.stringify(resolved.enrichmentStatus));
  check("resolve: candidates cleared", resolved.enrichmentCandidates == null, JSON.stringify(resolved.enrichmentCandidates));
  check("resolve: chosen columns written", resolved.company === "Acme" && resolved.title === "VP" && resolved.city === "Chicago", JSON.stringify({ c: resolved.company, t: resolved.title, city: resolved.city }));

  // Verified tags + facts written (feeds PeopleRank).
  const tagRes = await query(`SELECT tags FROM contacts WHERE id = $1 AND owner_id = $2`, [cA, OWNER]);
  const tags = tagRes.rows[0]?.tags || [];
  check("resolve: tags written", Array.isArray(tags) && tags.length > 0, JSON.stringify(tags));
  const factRes = await query(
    `SELECT count(*)::int AS n FROM contact_facts
      WHERE owner_id = $1 AND contact_id = $2 AND source = 'enrichment' AND status = 'resolved' AND deleted_at IS NULL`,
    [OWNER, cA],
  );
  check("resolve: enrichment facts written", (factRes.rows[0]?.n || 0) > 0, JSON.stringify(factRes.rows[0]));

  // ── 4) resolve with a candidate NOT in the array → 400 ──
  await setContactEnrichmentCandidates(OWNER, cB, candidateArray);
  const badRes = await app.inject({
    method: "POST",
    url: `/v1/me/contacts/${cB}/enrichment/resolve`,
    payload: { candidateLinkedinUrl: "https://linkedin.com/in/not-offered" },
  });
  check("resolve non-offered candidate → 400", badRes.statusCode === 400, `status=${badRes.statusCode} body=${badRes.payload}`);
  // cB must remain ambiguous (rejected, not committed).
  const cBstate = await query(`SELECT enrichment_status FROM contacts WHERE id = $1`, [cB]);
  check("rejected commit left cB ambiguous", cBstate.rows[0]?.enrichment_status === "ambiguous", JSON.stringify(cBstate.rows[0]));

  // ── 5) GET /summary → counts reflect state ──
  const sumRes = await app.inject({ method: "GET", url: "/v1/me/contacts/summary" });
  check("summary 200", sumRes.statusCode === 200, `status=${sumRes.statusCode}`);
  const summary = JSON.parse(sumRes.payload);
  check("summary.total === 2", summary.total === 2, JSON.stringify(summary));
  check("summary.bySource has apple+google", (summary.bySource?.apple || 0) === 1 && (summary.bySource?.google || 0) === 1, JSON.stringify(summary.bySource));
  const statusSum = Object.values(summary.byStatus || {}).reduce((a, b) => a + b, 0);
  check("summary.byStatus sums to total", statusSum === 2, JSON.stringify(summary.byStatus));
  check("summary.byStatus.resolved >= 1", (summary.byStatus?.resolved || 0) >= 1, JSON.stringify(summary.byStatus));
  check("summary.byStatus.ambiguous >= 1", (summary.byStatus?.ambiguous || 0) >= 1, JSON.stringify(summary.byStatus));
} catch (e) {
  console.log(`❌ unexpected error: ${e?.stack || e?.message || e}`);
  failed = true;
} finally {
  try {
    await app.close();
    await query(`DELETE FROM contact_facts WHERE owner_id = $1`, [OWNER]);
    await query(`DELETE FROM contacts WHERE owner_id = $1`, [OWNER]);
    await query(`DELETE FROM users WHERE amber_id = $1`, [OWNER]);
    console.log("✅ cleanup done");
  } catch (e) {
    console.log(`❌ cleanup failed: ${e?.message || e}`);
    failed = true;
  }
}

console.log(failed ? "\n❌ SMOKE FAILED" : "\n✅ SMOKE PASSED");
process.exit(failed ? 1 : 0);
