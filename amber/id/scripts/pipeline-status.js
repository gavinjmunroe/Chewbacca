/**
 * IS THE DATA STREAM WORKING? One command, one screen.
 *
 *   railway run node scripts/pipeline-status.js
 *   railway run node scripts/pipeline-status.js --json
 *   railway run env AMBER_SQL_DB=amber_next node scripts/pipeline-status.js
 *
 * Every number here has been asked by hand at least once during the rebuild.
 * This is that, written down, so the answer takes a second rather than a
 * conversation.
 *
 * IT READS NOTHING PRIVATE. Everything comes from db/analytics.js, whose fleet
 * functions return counts and distributions and never the text of a fact -- so
 * this is safe to run, paste into a channel, or screenshot.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existing = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existing && fs.existsSync(existing))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-pipeline-status.json");
  fs.writeFileSync(tmp, credsJson, { mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const A = await import("../src/db/analytics.js");
const { query, closePool } = await import("../src/db/sql.js");

const JSON_OUT = process.argv.includes("--json");

const pct = (v) => (v == null ? "  --  " : `${String(v).padStart(5)}%`);
const num = (v) => String(v ?? 0).padStart(7);

// A queue is only bad if it is not moving, and one snapshot cannot know that.
// So the marker flags the two states a single reading CAN diagnose: nothing has
// been tried, or everything tried has failed.
const flag = (queue, gaveUp) => (gaveUp > 0 ? " ← giving up" : queue > 0 ? " ← backlog" : "");

try {
  const [{ db }] = (await query(`SELECT current_database() AS db`)).rows;
  const health = await A.pipelineHealth();
  const dims = await A.fleetDimensionDistribution();
  const sources = await A.fleetSourceMix({ sinceDays: 30 });
  const daily = await A.fleetDailyVolume({ days: 14 });
  const corrections = await A.fleetCorrectionRate({ sinceDays: 30 });

  if (JSON_OUT) {
    console.log(JSON.stringify(
      { database: db, health, dimensions: dims, sources, daily, corrections }, null, 2));
    await closePool().catch(() => {});
    process.exit(0);
  }

  const line = "=".repeat(78);
  console.log(`\n${line}\n  PIPELINE — ${db}\n${line}`);
  console.log(`  observations ......... ${num(health.observations)}   (${health.observations24h} in the last 24h)`);
  console.log(`  contacts ............. ${num(health.identity.contacts)}`);

  const c = health.classification;
  console.log(`\n  DIMENSIONS`);
  console.log(`    classified ......... ${pct(c.coveragePct)}   lexicon ${c.byLexicon}, model ${c.byModel}, human ${c.byHuman}, none ${c.noDimension}`);
  console.log(`    queue .............. ${num(c.queue)}${flag(c.queue, c.gaveUp)}`);
  if (c.gaveUp > 0) console.log(`    gave up ............ ${num(c.gaveUp)}   (three model attempts, kept the lexicon's guess)`);
  console.log(`    lexicon share ...... ${pct(c.lexiconSharePct)}   how much never needed the model`);

  const e = health.embedding;
  console.log(`\n  EMBEDDINGS`);
  console.log(`    coverage ........... ${pct(e.coveragePct)}   ${e.embedded} of ${health.observations}`);
  console.log(`    queue .............. ${num(e.queue)}${flag(e.queue, e.gaveUp)}`);
  if (e.gaveUp > 0) console.log(`    gave up ............ ${num(e.gaveUp)}   semantic search cannot see these`);

  console.log(`\n  ROLLUP`);
  console.log(`    stale owners ....... ${num(health.rollup.staleOwners)}   facts newer than their scores`);
  console.log(`    dimension_state .... ${num(health.rollup.dimensionStateRows)} rows`);
  console.log(`    contact_scores ..... ${num(health.rollup.scoreRows)} rows   ${pct(health.rollup.scoreCoveragePct)} of live contacts`);
  console.log(`    interaction_stats .. ${num(health.rollup.interactionRows)} rows   ${health.rollup.warmContacts} contact(s) with any warmth`);
  if (health.rollup.scoreRows === 0 && health.identity.contacts > 0) {
    console.log(`    ! contact-rollup has never run — run scripts/contact-rollup.js`);
  }

  const i = health.identity;
  console.log(`\n  IDENTITY`);
  console.log(`    contacts with keys . ${pct(i.keyCoveragePct)}   ${i.withKeys} of ${i.contacts}`);
  console.log(`    discovery keys ..... ${num(i.discoveryKeys)}   accounts findable at signup`);
  console.log(`    linked to accounts . ${num(i.linkedToAccounts)}`);
  if (i.contacts > 0 && i.keyCoveragePct !== null && i.keyCoveragePct < 90) {
    console.log(`    ! a contact with no key cannot be deduped or linked at signup`);
  }

  console.log(`\n  WHICH DIMENSIONS FIRE`);
  console.log(`    ${"dimension".padEnd(14)}${"facts".padStart(8)}${"conf".padStart(8)}${"weight".padStart(8)}${"human".padStart(8)}${"suppressed".padStart(12)}`);
  for (const d of dims) {
    console.log(`    ${d.code.padEnd(14)}${String(d.observations).padStart(8)}${String(d.avg_confidence ?? "-").padStart(8)}${String(d.avg_weight ?? "-").padStart(8)}${String(d.human_assigned).padStart(8)}${String(d.suppressed).padStart(12)}`);
  }
  const silent = dims.filter((d) => d.observations === 0).map((d) => d.code);
  if (silent.length) console.log(`    ! never fires: ${silent.join(", ")} — a vocabulary gap, not an absence of such facts`);

  if (sources.length) {
    console.log(`\n  WHERE FACTS COME FROM (30d)`);
    for (const s of sources) {
      console.log(`    ${String(s.source).padEnd(18)}${String(s.observations).padStart(7)}   no-dimension ${s.no_dimension}, needed model ${s.needed_model}, salience ${s.avg_salience}`);
    }
  }

  const withOverride = corrections.filter((r) => r.overridden > 0 || r.human_added > 0);
  if (withOverride.length) {
    console.log(`\n  CORRECTIONS (30d) — the only ground truth this system gets`);
    for (const r of withOverride) {
      console.log(`    ${r.code.padEnd(14)}overridden ${r.overridden}, added by hand ${r.human_added}, rate ${pct(r.overrideRatePct)}`);
    }
  }

  if (daily.length > 1) {
    console.log(`\n  DAILY`);
    for (const d of daily.slice(-7)) {
      const day = new Date(d.day).toISOString().slice(0, 10);
      console.log(`    ${day}  ${String(d.observations).padStart(5)} facts   ${String(d.classified).padStart(5)} classified   ${String(d.embedded).padStart(5)} embedded`);
    }
  }
  console.log("");
} catch (err) {
  console.error("\n  ✗ pipeline-status failed:", err?.stack || err?.message || err, "\n");
  process.exitCode = 1;
} finally {
  await closePool().catch(() => {});
}
