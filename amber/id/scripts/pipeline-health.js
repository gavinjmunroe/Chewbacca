/**
 * PIPELINE HEALTH. Read-only. Walks the whole loop and says where data stops.
 *
 *   railway run node scripts/pipeline-health.js
 *   railway run node scripts/pipeline-health.js --dimensions   per-dimension detail
 *
 * WRITES NOTHING AND CALLS NO API. Every number here is a SELECT, so it costs
 * nothing and is safe to run against production as often as you like.
 *
 * WHAT IT IS FOR. The end state is: a fact enters, gets tagged with the six
 * dimensions and embedded, rolls up into a standing per-contact score, and comes
 * back out through retrieval into the app. Each of those stages can be healthy
 * while the NEXT one is empty, and every failure in this system so far has been
 * of exactly that shape -- a stage that reported success on rows that never
 * landed, or landed with no content. Counting the population at every hop is the
 * only way to see that from the outside.
 *
 * Each section prints a verdict: OK, EMPTY, or STALLED, and says what to run.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existing = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existing && fs.existsSync(existing))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-pipeline-health.json");
  fs.writeFileSync(tmp, credsJson, { mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { query, closePool } = await import("../src/db/sql.js");
const { ownersNeedingRollup } = await import("../src/db/retrieval.js");
const { EMBEDDING_DIMS, EMBEDDING_MODEL } = await import("../src/db/embedding-queue.js");

const detail = process.argv.slice(2).includes("--dimensions");
const n = (v) => Number(v ?? 0).toLocaleString();
const pct = (a, b) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");

function verdict(label, ok, note) {
  const tag = ok === true ? "OK" : ok === false ? "PROBLEM" : "NOTE";
  console.log(`    ${tag.padEnd(8)} ${label}${note ? ` — ${note}` : ""}`);
}

async function one(sql, params = []) {
  const { rows } = await query(sql, params);
  return rows[0] || {};
}
async function all(sql, params = []) {
  const { rows } = await query(sql, params);
  return rows;
}

async function main() {
  console.log("");
  console.log("  ── 1. OBSERVATIONS (what came in) ───────────────────────────────");
  const obs = await one(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS deleted,
            count(*) FILTER (WHERE deleted_at IS NULL AND status = 'pending')::int AS pending,
            count(*) FILTER (WHERE deleted_at IS NULL AND contact_id IS NULL)::int AS no_contact,
            count(*) FILTER (WHERE deleted_at IS NULL AND status <> 'pending'
                             AND contact_id IS NOT NULL)::int AS eligible
       FROM observations`,
  );
  console.log(`    total ${n(obs.total)}   deleted ${n(obs.deleted)}   pending ${n(obs.pending)}   no contact ${n(obs.no_contact)}`);
  console.log(`    ELIGIBLE for rollup (live, non-pending, contact-linked): ${n(obs.eligible)}`);
  verdict("observations present", obs.total > 0, obs.total === 0 ? "nothing has been captured" : null);
  if (obs.pending > 0) {
    verdict("pending subjects", null,
      `${n(obs.pending)} observation(s) whose subject is unresolved. These are ` +
      `INTENTIONALLY excluded from ranking and rollup.`);
  }

  console.log("");
  console.log("  ── 2. DIMENSION TAGGING (the six dimensions) ────────────────────");
  const dim = await all(
    `SELECT dimension_status, count(*)::int AS c,
            count(*) FILTER (WHERE dimension_attempts >= 3)::int AS exhausted
       FROM observations
      WHERE deleted_at IS NULL
      GROUP BY dimension_status
      ORDER BY c DESC`,
  );
  for (const r of dim) {
    console.log(`    ${String(r.dimension_status).padEnd(8)} ${n(r.c).padStart(8)}` +
      (r.exhausted > 0 ? `   (${n(r.exhausted)} gave up after 3 attempts)` : ""));
  }
  const queued = dim.find((r) => r.dimension_status === "pending")?.c ?? 0;
  const tagged = await one(
    `SELECT count(DISTINCT o.observation_id)::int AS c
       FROM observations o
       JOIN observation_dimensions od
         ON od.observation_id = o.observation_id AND od.suppressed = false
      WHERE o.deleted_at IS NULL`,
  );
  console.log(`    observations carrying >=1 unsuppressed dimension: ${n(tagged.c)} of ${n(obs.total - obs.deleted)} (${pct(tagged.c, obs.total - obs.deleted)})`);
  verdict("classification queue drained", queued === 0,
    queued > 0 ? `${n(queued)} still queued — run: railway run node scripts/dimension-worker.js --watch` : null);

  // THE CONFIDENCE FLOOR, CHECKED AGAINST THE DATABASE rather than trusted.
  // observation-dimensions.js refuses to write a dimension below
  // DIMENSION_MIN_CONFIDENCE, but rows written BEFORE that existed are still
  // there, and a floor is exactly the kind of guarantee that is easy to assert
  // and never verify. Anything reported here predates the floor or bypassed it.
  const FLOOR = Number(process.env.DIMENSION_MIN_CONFIDENCE) || 0.35;
  const belowFloor = await one(
    `SELECT count(*)::int AS c,
            count(DISTINCT od.observation_id)::int AS obs
       FROM observation_dimensions od
       JOIN observations o ON o.observation_id = od.observation_id
      WHERE od.suppressed = false AND o.deleted_at IS NULL
        AND od.assigned_by <> 'human'
        AND od.confidence < $1`,
    [FLOOR],
  );
  verdict(`no dimension below the ${FLOOR} confidence floor`, belowFloor.c === 0,
    belowFloor.c > 0
      ? `${n(belowFloor.c)} label(s) across ${n(belowFloor.obs)} observation(s) sit below it — ` +
        `these were written before the floor existed. Re-open them with: ` +
        `railway run node scripts/dimension-worker.js --reset-all`
      : null);

  if (detail) {
    const perDim = await all(
      `SELECT d.code, count(*)::int AS assignments,
              round(avg(od.confidence)::numeric, 2) AS avg_conf,
              round(avg(od.weight)::numeric, 2) AS avg_weight
         FROM observation_dimensions od
         JOIN dimensions d USING (dimension_id)
         JOIN observations o ON o.observation_id = od.observation_id
        WHERE od.suppressed = false AND o.deleted_at IS NULL
        GROUP BY d.code
        ORDER BY assignments DESC`,
    );
    console.log("    per dimension:");
    for (const r of perDim) {
      console.log(`      ${String(r.code).padEnd(13)} ${n(r.assignments).padStart(7)} assignments   conf ${r.avg_conf}   weight ${r.avg_weight}`);
    }
    // A classifier that labels everything one thing is a quality problem the
    // counts above cannot show.
    if (perDim.length > 0) {
      const top = perDim[0];
      const totalA = perDim.reduce((a, r) => a + r.assignments, 0);
      const share = top.assignments / totalA;
      // THIS CHECK WAS CRYING WOLF. It flagged anything over 60% as a collapsing
      // classifier and then fired on every single run, because social IS ~60% of
      // assignments in an app about relationships and always will be. A gate that
      // reports the expected state as a PROBLEM teaches you to ignore the gate.
      //
      // What would actually be wrong: one dimension swallowing nearly everything
      // (85%+, which no honest corpus produces), or a dimension that never fires
      // at all -- a lexicon or prompt bug that makes a sixth of the model
      // unreachable.
      const SHARE_ALARM = 0.85;
      verdict("dimension spread", share < SHARE_ALARM,
        share >= SHARE_ALARM
          ? `${top.code} is ${pct(top.assignments, totalA)} of all assignments — that is a collapsing classifier, not a skew`
          : `${top.code} leads at ${pct(top.assignments, totalA)}` +
            (top.code === "social" ? " — expected for a relationship app" : ""));

      const missing = ["spiritual", "emotional", "physical", "intellectual", "social", "financial"]
        .filter((c) => !perDim.some((r) => r.code === c));
      if (missing.length > 0) {
        verdict("every dimension reachable", false,
          `never assigned to anything: ${missing.join(", ")} — check the prompt and lexicon can produce them`);
      }
    }
  }

  console.log("");
  console.log("  ── 3. OBSERVATION EMBEDDINGS (semantic search) ──────────────────");
  const emb = await one(
    `SELECT count(*)::int AS total,
            count(embedding)::int AS embedded
       FROM observations WHERE deleted_at IS NULL`,
  );
  console.log(`    ${n(emb.embedded)} / ${n(emb.total)} live observations embedded (${pct(emb.embedded, emb.total)})  [${EMBEDDING_MODEL}, ${EMBEDDING_DIMS}d]`);
  verdict("embeddings complete", emb.embedded === emb.total,
    emb.embedded < emb.total ? `${n(emb.total - emb.embedded)} missing — run: railway run node scripts/dimension-worker.js --watch` : null);

  console.log("");
  console.log("  ── 4. CONTACT VECTORS (the ranker's pre-filter) ─────────────────");
  const cv = await one(
    `SELECT (SELECT count(*)::int FROM contacts WHERE deleted_at IS NULL) AS contacts,
            (SELECT count(*)::int FROM contact_embedding) AS vectors`,
  );
  // The number that matters is not how many vectors exist, it is how many are
  // built from more than a name. A name-only vector ranks by spelling.
  const withFacts = await one(
    `SELECT count(DISTINCT p.contact_id)::int AS c
       FROM observation_participants p
       JOIN observations o USING (observation_id)
      WHERE o.deleted_at IS NULL AND o.status <> 'pending'`,
  );
  console.log(`    ${n(cv.vectors)} / ${n(cv.contacts)} contacts have a vector (${pct(cv.vectors, cv.contacts)})`);
  console.log(`    ${n(withFacts.c)} contact(s) have at least one fact attached (${pct(withFacts.c, cv.contacts)})`);
  verdict("vectors present", cv.vectors > 0,
    cv.vectors === 0 ? "run: railway run node scripts/contact-vectors-backfill.js" : null);
  verdict("vector content", null,
    `${n(cv.contacts - withFacts.c)} contact(s) are name-only, so their vector encodes a NAME and ` +
    `nothing else. That is correct for a fresh address-book import — it becomes a problem only ` +
    `if contacts you have written facts about show up here.`);

  console.log("");
  console.log("  ── 5. CONTACT DIMENSION STATE (what PeopleRank reads) ───────────");
  const cds = await one(
    `SELECT count(*)::int AS rows,
            count(DISTINCT contact_id)::int AS contacts,
            count(DISTINCT owner_id)::int AS owners,
            min(computed_at) AS oldest,
            max(computed_at) AS newest
       FROM contact_dimension_state`,
  );
  console.log(`    ${n(cds.rows)} row(s) across ${n(cds.contacts)} contact(s), ${n(cds.owners)} owner(s)`);
  console.log(`    computed between ${cds.oldest || "—"} and ${cds.newest || "—"}`);
  verdict("dimension state populated", cds.rows > 0,
    cds.rows === 0
      ? "EMPTY — the six dimensions have no per-contact scores, so PeopleRank has nothing to read. " +
        "Run: railway run node scripts/dimension-worker.js"
      : null);

  const stale = await ownersNeedingRollup(500);
  verdict("rollup up to date", stale.length === 0,
    stale.length > 0
      ? `${stale.length} owner(s) have eligible facts newer than their scores — ` +
        `run: railway run node scripts/dimension-worker.js`
      : "no owner has eligible facts newer than their computed state");

  console.log("");
  console.log("  ── 6. SOURCE TRUST (silent 0.5 defaults) ────────────────────────");
  // An unmapped source scores 0.5 forever with no error anywhere.
  const unmapped = await all(
    `SELECT o.source, count(*)::int AS c
       FROM observations o
      WHERE o.deleted_at IS NULL AND o.source IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM scoring_params sp
                         WHERE sp.key = 'source_' || o.source)
      GROUP BY o.source ORDER BY c DESC`,
  );
  if (unmapped.length === 0) {
    verdict("every source has a trust weight", true);
  } else {
    for (const r of unmapped) console.log(`    ${String(r.source).padEnd(16)} ${n(r.c)} observation(s)`);
    verdict("unmapped sources", false,
      `these silently score 0.5. Add scoring_params rows named source_<name>.`);
  }

  console.log("");
  console.log("  ── VERDICT ──────────────────────────────────────────────────────");
  const blocking = [];
  if (obs.eligible === 0) blocking.push("no observation is eligible for rollup");
  if (queued > 0) blocking.push(`${n(queued)} facts awaiting classification`);
  if (emb.embedded < emb.total) blocking.push(`${n(emb.total - emb.embedded)} facts unembedded`);
  if (cds.rows === 0) blocking.push("contact_dimension_state is empty");
  if (stale.length > 0) blocking.push(`${stale.length} owner(s) need a rollup`);
  if (unmapped.length > 0) blocking.push(`${unmapped.length} unmapped source(s)`);

  // COVERAGE IS PART OF THE VERDICT, not a footnote. The first version of this
  // script checked only that each stage RAN, and reported "the loop is closed"
  // on a corpus where 82% of facts carried no dimension at all and PeopleRank had
  // scores for 31 contacts out of 5,249. Everything flowed and almost nothing was
  // in it. A pipeline that is plumbed but empty is not closed in any sense that
  // matters, so a thin corpus now says so out loud.
  const live = obs.total - obs.deleted;
  const coverage = live > 0 ? tagged.c / live : 0;
  const thin = [];
  if (coverage < 0.5) {
    thin.push(
      `only ${pct(tagged.c, live)} of facts carry a dimension (${n(tagged.c)} of ${n(live)}) — ` +
        `run: railway run node scripts/dimension-sample.js to see whether that is correct`,
    );
  }
  if (cds.rows > 0 && cds.contacts < 100) {
    thin.push(
      `PeopleRank has dimension scores for ${n(cds.contacts)} contact(s) only — ` +
        `everything downstream of the six dimensions is working off that`,
    );
  }
  if (obs.no_contact > 0) {
    thin.push(
      `${n(obs.no_contact)} observation(s) have no contact_id and can never roll up`,
    );
  }

  if (blocking.length === 0 && thin.length === 0) {
    console.log("    The loop is closed: facts in, tagged, embedded, rolled up, ready to read.");
  } else if (blocking.length === 0) {
    console.log("    Every stage runs, but the corpus is THIN:");
    for (const t of thin) console.log(`      - ${t}`);
  } else {
    console.log("    Not closed yet:");
    for (const b of blocking) console.log(`      - ${b}`);
    for (const t of thin) console.log(`      - ${t}`);
  }
  console.log("");
}

try {
  await main();
} catch (err) {
  console.error(`  FAILED: ${err?.message || err}`);
  process.exitCode = 1;
} finally {
  await closePool();
}
