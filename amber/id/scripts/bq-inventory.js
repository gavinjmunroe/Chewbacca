/**
 * WHAT IS ACTUALLY IN BIGQUERY. Datasets, tables, row counts, location, and
 * whether each dataset carries a customer-managed key.
 *
 *   railway run node scripts/bq-inventory.js            names only, fast
 *   railway run node scripts/bq-inventory.js --counts   + rows, location, CMEK
 *
 * READ-ONLY. --counts reads table metadata rather than running SELECT count(*),
 * so it costs nothing and scans nothing.
 *
 * WHY IT MATTERS BEYOND CURIOSITY: this is the check that caught the app's
 * service account being able to see one dataset out of sixteen, which meant
 * every iMessage write was failing on permissions into a console.warn. An
 * inventory you can run in one command is how that stops being invisible.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-bq.json");
  fs.writeFileSync(tmp, credsJson);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const WITH_COUNTS = process.argv.slice(2).includes("--counts");

const { BigQuery } = await import("@google-cloud/bigquery");

try {
  const bq = new BigQuery();
  console.log("project:", await bq.getProjectId());
  const [datasets] = await bq.getDatasets();
  if (datasets.length === 0) {
    console.log("(no datasets visible to this service account)");
    process.exit(0);
  }
  for (const ds of datasets) {
    const [tables] = await ds.getTables();
    let suffix = "";
    if (WITH_COUNTS) {
      const [md] = await ds.getMetadata();
      const key = md.defaultEncryptionConfiguration?.kmsKeyName;
      suffix = `  [${md.location}${key ? `, CMEK ${key.split("/").pop()}` : ", Google-managed key"}]`;
    }
    console.log(`\n📂 ${ds.id}  (${tables.length} table${tables.length === 1 ? "" : "s"})${suffix}`);
    for (const t of tables) {
      if (!WITH_COUNTS) { console.log(`   - ${t.id}`); continue; }
      // Table metadata carries numRows for a real table; a view has none.
      const [tmd] = await t.getMetadata().catch(() => [null]);
      const kind = tmd?.type === "VIEW" ? "view" : `${Number(tmd?.numRows ?? 0).toLocaleString()} rows`;
      console.log(`   - ${t.id.padEnd(38)} ${kind}`);
    }
  }
  process.exit(0);
} catch (err) {
  console.error("bq inventory failed:", err?.message || err);
  process.exit(1);
}
