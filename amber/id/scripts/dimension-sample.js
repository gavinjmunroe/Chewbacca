/**
 * WHY DID 82% OF FACTS GET NO DIMENSION? Read-only sampler. No API calls.
 *
 *   railway run node scripts/dimension-sample.js
 *   railway run node scripts/dimension-sample.js --status=none --limit=40
 *   railway run node scripts/dimension-sample.js --not-source=enrichment
 *       ^ USE THIS ONE. Sampling 'none' straight returns 91% seed data
 *         ("Lives in New York" x400), which tells you nothing about the rows
 *         that matter. Excluding enrichment shows the real facts the classifier
 *         declined, which is the actual question every time.
 *   railway run node scripts/dimension-sample.js --status=llm
 *
 * pipeline-health reported dimension_status = 'none' on 856 of 1,043
 * observations, and 'social' on 63% of the assignments that were made. Those two
 * numbers have two opposite explanations and the counts cannot tell them apart:
 *
 *   CORRECT. The classifier prompt says biographical detail -- job title, city,
 *   company, birthday -- is NOT a dimension of health. An address book imported
 *   from Apple and Google is overwhelmingly biographical, so a high 'none' rate
 *   is the RIGHT answer and forcing dimensions onto those rows would be noise
 *   dressed up as signal.
 *
 *   WRONG. The same prompt says "Be SPARSE", and a model that takes that too
 *   literally under-labels real health-relevant facts. Every one it drops is a
 *   fact PeopleRank can never see, permanently -- dimension_status settles and
 *   the row is never asked about again.
 *
 * The only way to tell is to read the actual sentences. That is what this does:
 * it prints the text, grouped by what the classifier decided, so a human can
 * judge in a couple of minutes. Nothing is written and nothing is re-classified.
 *
 * If the 'none' bucket turns out to be full of real facts, the fix is the prompt,
 * plus `dimension-worker.js --reset-attempts` to re-open the settled rows.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existing = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existing && fs.existsSync(existing))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-dimension-sample.json");
  fs.writeFileSync(tmp, credsJson, { mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { query, closePool } = await import("../src/db/sql.js");

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : dflt;
};
const STATUS = arg("status", null);
const NOT_SOURCE = arg("not-source", null);
const ONLY_SOURCE = arg("source", null);
// Built as a fragment rather than interpolated values: the source name lands as
// a bound parameter, never in the SQL text.
const srcFilter = NOT_SOURCE
  ? " AND o.source IS DISTINCT FROM $3"
  : ONLY_SOURCE
    ? " AND o.source = $3"
    : "";
const srcParam = NOT_SOURCE ?? ONLY_SOURCE ?? null;
const LIMIT = Math.min(Math.max(Number(arg("limit", 25)) || 25, 1), 200);

const trunc = (s, n = 150) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

async function all(sql, params = []) {
  const { rows } = await query(sql, params);
  return rows;
}

async function main() {
  // ── WHERE the 'none' rows came from. If they are dominated by imported
  //    sources, 'none' is very likely correct.
  console.log("\n  ── 'none' rows by SOURCE and KIND ───────────────────────────────");
  const bySource = await all(
    `SELECT o.source, o.kind, count(*)::int AS c
       FROM observations o
      WHERE o.deleted_at IS NULL AND o.dimension_status = 'none'
      GROUP BY o.source, o.kind
      ORDER BY c DESC
      LIMIT 25`,
  );
  if (bySource.length === 0) console.log("    (no 'none' rows)");
  for (const r of bySource) {
    console.log(
      `    ${String(r.source ?? "—").padEnd(16)} ${String(r.kind ?? "—").padEnd(14)} ${String(r.c).padStart(6)}`,
    );
  }

  // Same for the rows that DID get a dimension, as a control: if the two
  // populations come from the same sources, sparseness is the explanation
  // rather than provenance.
  console.log("\n  ── rows WITH a dimension, by source and kind (control) ──────────");
  const withDim = await all(
    `SELECT o.source, o.kind, count(*)::int AS c
       FROM observations o
      WHERE o.deleted_at IS NULL AND o.dimension_status <> 'none'
      GROUP BY o.source, o.kind
      ORDER BY c DESC
      LIMIT 25`,
  );
  for (const r of withDim) {
    console.log(
      `    ${String(r.source ?? "—").padEnd(16)} ${String(r.kind ?? "—").padEnd(14)} ${String(r.c).padStart(6)}`,
    );
  }

  // ── LENGTH is a cheap proxy for "is this a sentence or a field?".
  console.log("\n  ── body length by decision ──────────────────────────────────────");
  const lens = await all(
    `SELECT dimension_status,
            count(*)::int AS c,
            round(avg(length(body)))::int AS avg_chars,
            min(length(body))::int AS min_chars,
            max(length(body))::int AS max_chars
       FROM observations
      WHERE deleted_at IS NULL
      GROUP BY dimension_status
      ORDER BY c DESC`,
  );
  for (const r of lens) {
    console.log(
      `    ${String(r.dimension_status).padEnd(9)} ${String(r.c).padStart(6)} rows   avg ${String(r.avg_chars).padStart(4)} chars   (min ${r.min_chars}, max ${r.max_chars})`,
    );
  }

  // ── THE SAMPLES. This is the part a human reads.
  const statuses = STATUS ? [STATUS] : ["none", "llm", "lexicon"];
  for (const st of statuses) {
    console.log(`\n  ── SAMPLE: dimension_status = '${st}' (up to ${LIMIT}) ──────────────`);
    const params = srcParam === null ? [st, LIMIT] : [st, LIMIT, srcParam];
    const rows = await all(
      `SELECT o.body, o.source, o.kind,
              COALESCE(
                (SELECT string_agg(d.code || ':' || round(od.confidence::numeric, 2), ', ' ORDER BY d.code)
                   FROM observation_dimensions od
                   JOIN dimensions d USING (dimension_id)
                  WHERE od.observation_id = o.observation_id AND od.suppressed = false),
                '—') AS dims
         FROM observations o
        WHERE o.deleted_at IS NULL AND o.dimension_status = $1${srcFilter}
        ORDER BY random()
        LIMIT $2`,
      params,
    );
    if (rows.length === 0) {
      console.log("    (none)");
      continue;
    }
    for (const r of rows) {
      console.log(`    [${String(r.source ?? "—")}/${String(r.kind ?? "—")}] ${trunc(r.body)}`);
      if (st !== "none") console.log(`        -> ${r.dims}`);
    }
  }

  console.log(
    "\n  READ THE 'none' SAMPLE ABOVE. If those are job titles, companies, cities and\n" +
      "  birthdays, the classifier is right and 18% coverage is simply what an imported\n" +
      "  address book yields. If they are real statements about how someone is doing,\n" +
      "  the prompt is under-labeling and those rows have settled permanently —\n" +
      "  fixable with a prompt change plus dimension-worker.js --reset-attempts.\n",
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
