/**
 * DELETE the seed 'enrichment' observations.
 *
 *   railway run node scripts/purge-seed-enrichment.js            REPORT ONLY
 *   railway run node scripts/purge-seed-enrichment.js --confirm  actually delete
 *
 * DESTRUCTIVE, AND GATED. Without --confirm it reads and prints and changes
 * nothing. The gate is not ceremony: this deletes user-scoped rows, and the
 * argument for deleting them is that they are FALSE, which is a judgment a
 * person makes and a script must not.
 *
 * WHAT THESE ROWS ARE. 800 of the 1,043 observations carry source='enrichment',
 * and their entire content is a couple of strings repeated across hundreds of
 * different people -- "Lives in New York" and "Works as Product Manager at
 * Globex" (Globex is a placeholder company). Karthik confirmed the content is
 * simply wrong: those people do not all live in New York and are not all product
 * managers anywhere.
 *
 * WHY THEY ARE WORSE THAN CLUTTER:
 *   - They are 77% of the vector index. Eight hundred near-identical embeddings
 *     compete with real facts in every semantic search, so retrieval spends its
 *     similarity budget on "Lives in New York".
 *   - They are asserted as facts about real contacts. Any surface that shows a
 *     person's facts shows them a false one.
 *   - They distort every coverage number computed over observations, which is
 *     how "18% of facts carry a dimension" got reported as a classifier problem.
 *
 * WHAT IT TOUCHES. One DELETE against observations, scoped to source =
 * 'enrichment' and nothing else. Everything downstream goes with it by
 * ON DELETE CASCADE, verified against the migrations rather than assumed:
 *   observation_dimensions, observation_participants (015)
 *   observation_embeddings-adjacent detail tables (007)
 *   conversation links (014)
 *   media_assets.observation_id -> SET NULL (010), so media is kept and
 *   un-linked rather than deleted with the fact.
 *
 * WHAT IT DOES NOT TOUCH: contacts, names, phones, emails, identity keys,
 * circles, notes anyone wrote, or observations from any other source. A contact
 * whose ONLY fact was one of these keeps its row and simply has no facts, which
 * is the truthful state.
 *
 * AFTER RUNNING, re-roll the dimension state so contacts scored off a deleted
 * fact stop carrying it:
 *   railway run node scripts/dimension-worker.js
 * refreshContactDimensionState's DELETE clause clears rows with no surviving
 * observation, so this is a normal pass and not a special repair.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existing = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existing && fs.existsSync(existing))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-purge-seed.json");
  fs.writeFileSync(tmp, credsJson, { mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { query, closePool } = await import("../src/db/sql.js");

const argv = process.argv.slice(2);
const CONFIRM = argv.includes("--confirm");
const SOURCE = "enrichment";
const n = (v) => Number(v ?? 0).toLocaleString();

async function main() {
  // ── EXACTLY WHAT IS IN THERE, printed before anything is removed. If this
  //    list ever contains something that looks like a real fact somebody wrote,
  //    stop and do not pass --confirm.
  const { rows: bodies } = await query(
    `SELECT body, count(*)::int AS c,
            count(DISTINCT contact_id)::int AS contacts
       FROM observations
      WHERE deleted_at IS NULL AND source = $1
      GROUP BY body
      ORDER BY c DESC
      LIMIT 40`,
    [SOURCE],
  );
  const { rows: totals } = await query(
    `SELECT count(*)::int AS obs,
            count(DISTINCT contact_id)::int AS contacts,
            count(DISTINCT body)::int AS distinct_bodies,
            count(embedding)::int AS embedded
       FROM observations
      WHERE deleted_at IS NULL AND source = $1`,
    [SOURCE],
  );
  const t = totals[0] || {};

  console.log(`\n  source='${SOURCE}': ${n(t.obs)} observation(s), ${n(t.distinct_bodies)} DISTINCT text(s), across ${n(t.contacts)} contact(s)`);
  console.log(`  ${n(t.embedded)} of them hold an embedding.\n`);
  console.log("  every distinct text, with how many people it is asserted about:");
  for (const r of bodies) {
    console.log(`    ${String(r.c).padStart(5)} rows / ${String(r.contacts).padStart(4)} contacts   "${String(r.body).slice(0, 90)}"`);
  }

  // What the cascade will take with it.
  const { rows: kids } = await query(
    `SELECT
       (SELECT count(*)::int FROM observation_dimensions od
          JOIN observations o USING (observation_id)
         WHERE o.source = $1 AND o.deleted_at IS NULL)   AS dimension_tags,
       (SELECT count(*)::int FROM observation_participants p
          JOIN observations o USING (observation_id)
         WHERE o.source = $1 AND o.deleted_at IS NULL)   AS participant_links`,
    [SOURCE],
  );
  const k = kids[0] || {};
  console.log(`\n  cascade will also remove: ${n(k.dimension_tags)} dimension tag(s), ${n(k.participant_links)} participant link(s)`);
  console.log("  NOT touched: contacts, names, phones, emails, circles, notes, or any other source.");

  if (!CONFIRM) {
    console.log(
      `\n  REPORT ONLY — nothing was deleted.\n` +
        `  Re-run with --confirm to delete these ${n(t.obs)} observation(s).\n`,
    );
    return;
  }

  // HARD DELETE, not a soft delete. A soft delete would leave the rows in the
  // vector index and in every count -- which is the entire problem being solved.
  const { rowCount } = await query(
    `DELETE FROM observations WHERE source = $1`,
    [SOURCE],
  );
  console.log(`\n  DELETED ${n(rowCount)} observation(s) with source='${SOURCE}'.`);

  const { rows: after } = await query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE dimension_status <> 'none')::int AS with_dim
       FROM observations WHERE deleted_at IS NULL`,
  );
  const a = after[0] || {};
  const pctv = a.total > 0 ? Math.round((a.with_dim / a.total) * 100) : 0;
  console.log(`  remaining: ${n(a.total)} observation(s), ${n(a.with_dim)} carrying a dimension (${pctv}%)`);
  console.log(
    `\n  NEXT: railway run node scripts/dimension-worker.js\n` +
      `  (re-rolls contact_dimension_state so no contact is scored off a deleted fact)\n`,
  );
}

try {
  await main();
} catch (err) {
  console.error(`  FAILED: ${err?.message || err}`);
  process.exitCode = 1;
} finally {
  await closePool();
}
