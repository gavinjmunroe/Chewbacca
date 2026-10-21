/**
 * SHIP A FLEET SNAPSHOT TO BIGQUERY. The cron entry for analytics.
 *
 *   railway run node scripts/bq-snapshot.js --ddl     print the table DDL
 *   railway run node scripts/bq-snapshot.js --dry-run show the rows, send none
 *   railway run node scripts/bq-snapshot.js           send them
 *
 * ONE RUN PER DAY IS ENOUGH for the trend charts; hourly is fine and cheap
 * (these are tens of rows). The table is partitioned by day, so cost is a
 * function of how much you query, not how much you keep.
 *
 * WHAT IT SENDS is whatever db/analytics.js's fleet functions return: counts,
 * percentages, distributions. No fact text, no names, no ids. Run --dry-run and
 * read it -- that is the point of having the flag.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existing = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existing && fs.existsSync(existing))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-bq-snapshot.json");
  fs.writeFileSync(tmp, credsJson, { mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { exportFleetSnapshot, snapshotToRows, METRICS_DDL, METRICS_TABLE } =
  await import("../src/pdw/bq-metrics.js");
const A = await import("../src/db/analytics.js");
const { closePool } = await import("../src/db/sql.js");

const argv = process.argv.slice(2);

try {
  if (argv.includes("--ddl")) {
    console.log(`\n  Run this once in the BigQuery console, then this job can write:\n`);
    console.log(METRICS_DDL);
    console.log("");
    process.exit(0);
  }

  if (argv.includes("--dry-run")) {
    const snapshot = await A.fleetSnapshot();
    const rows = snapshotToRows(snapshot);
    console.log(`\n  ${rows.length} rows would be written to ${METRICS_TABLE}:\n`);
    for (const r of rows) {
      console.log(`    ${r.metric.padEnd(34)}${(r.key ?? "").padEnd(14)}${r.value}`);
    }
    console.log(`\n  Nothing above is a name, an id, or anything anybody said.\n`);
    process.exit(0);
  }

  const res = await exportFleetSnapshot();
  if (res.skipped) {
    console.log(`\n  skipped: ${res.reason}\n`);
  } else {
    console.log(
      `\n  ${res.written}/${res.rows} metric rows written at ${res.capturedAt}` +
        (res.failed ? `  (${res.failed} FAILED — see the dead-letter queue)` : "") +
        "\n",
    );
    if (res.failed) process.exitCode = 1;
  }
} catch (err) {
  console.error("\n  ✗ bq-snapshot failed:", err?.stack || err?.message || err, "\n");
  process.exitCode = 1;
} finally {
  await closePool().catch(() => {});
}
