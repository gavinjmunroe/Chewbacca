/**
 * RUN THE CONTACT ROLLUP. The cron entry for contact_interaction_stats and
 * contact_scores.
 *
 *   railway run node scripts/contact-rollup.js --status            what is stale
 *   railway run node scripts/contact-rollup.js --owner <uuid>      one account
 *   railway run node scripts/contact-rollup.js --limit 500         the stalest 500
 *   railway run node scripts/contact-rollup.js --dry-run           show, change nothing
 *
 * WHY IT IS NOT ALL OWNERS BY DEFAULT. A fleet-wide pass at a million accounts
 * is a long-running write transaction against the OLTP database, and the whole
 * point of these tables is that reads are cheap, not that rebuilds are. --limit
 * defaults to 200 and the order is stalest-first, so running it every ten
 * minutes converges without ever being a big job.
 *
 * SAFE TO RUN AGAIN, ALWAYS. Both tables are derived; the job recomputes rather
 * than accumulates, and truncating either one loses nothing.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * MATERIALIZE THE SERVICE-ACCOUNT JSON BEFORE sql.js IS IMPORTED.
 *
 * Every other script here that reaches the real database opens with this, and
 * migrate.js says why in capitals. I left it out of this file and out of
 * sql-prepare-audit.mjs, and the audit died on
 * `invalid_grant: reauth related error (invalid_rapt)` -- a forty-line Google
 * stack trace that looks nothing like its cause. This job would have failed the
 * same way the first time anybody ran it against production.
 */
const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-contact-rollup.json");
  fs.writeFileSync(tmp, credsJson, { mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { refreshOwner, ownersNeedingRefresh, rollupSummary } =
  await import("../src/db/contact-rollup.js");
const { closePool } = await import("../src/db/sql.js");

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1] ?? null;
};
const has = (name) => argv.includes(name);

const owner = flag("--owner");
const limit = Number(flag("--limit") || 200);
const dryRun = has("--dry-run");

try {
  if (has("--status")) {
    const owners = await ownersNeedingRefresh(Math.min(limit, 50));
    console.log(`\n  ${owners.length} owner(s), stalest first\n`);
    console.log(`  ${"owner".padEnd(38)}${"contacts".padStart(9)}   last rollup`);
    for (const o of owners) {
      console.log(
        `  ${o.ownerId.padEnd(38)}${String(o.contacts).padStart(9)}   ` +
          (o.oldestScore ? new Date(o.oldestScore).toISOString() : "never"),
      );
    }
    console.log("");
    process.exit(0);
  }

  const targets = owner
    ? [{ ownerId: owner, contacts: null }]
    : await ownersNeedingRefresh(limit);

  if (dryRun) {
    console.log(`\n  ${targets.length} owner(s) would be rolled up. Nothing written.\n`);
    for (const t of targets.slice(0, 20)) {
      const s = await rollupSummary(t.ownerId);
      console.log(
        `  ${t.ownerId}  contacts=${s?.contacts ?? "?"}  ` +
          `stats=${s?.stats_rows ?? 0}  scores=${s?.score_rows ?? 0}`,
      );
    }
    if (targets.length > 20) console.log(`  ... and ${targets.length - 20} more`);
    console.log("");
    process.exit(0);
  }

  const started = Date.now();
  let interactions = 0;
  let scores = 0;
  let failed = 0;

  for (const t of targets) {
    try {
      const r = await refreshOwner(t.ownerId);
      interactions += r.interactions;
      scores += r.scores;
    } catch (err) {
      // ONE BAD ACCOUNT MUST NOT STOP THE SWEEP. It is a derived table; the
      // owner keeps yesterday's numbers and the next pass tries again.
      failed += 1;
      console.error(`  ✗ ${t.ownerId}: ${err?.message || err}`);
    }
  }

  console.log(
    `\n  ${targets.length} owner(s) in ${Date.now() - started}ms — ` +
      `${interactions} interaction row(s), ${scores} score row(s)` +
      (failed ? `, ${failed} FAILED` : "") +
      "\n",
  );
  if (failed) process.exitCode = 1;
} catch (err) {
  console.error("\n  ✗ contact-rollup failed:", err?.stack || err?.message || err, "\n");
  process.exitCode = 1;
} finally {
  await closePool().catch(() => {});
}
