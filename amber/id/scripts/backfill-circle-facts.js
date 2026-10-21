// One-time backfill: classify every existing circle and materialize its
// member facts. Safe to re-run (syncCircleFacts reconciles idempotently).
// Run with production env injected (after the classification migration):
//   railway run node scripts/backfill-circle-facts.js

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Materialize the service-account JSON so the Cloud SQL connector's ADC can
// find it (mirrors scripts/run-migration.js). Must run before importing the
// DB modules.
const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-backfill.json");
  fs.writeFileSync(tmp, credsJson);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { query } = await import("../src/db/sql.js");
const { syncCircleFacts } = await import("../src/db/circle-enrichment.js");

const run = async () => {
  const { rows } = await query(
    "SELECT id, owner_id FROM circles WHERE deleted_at IS NULL ORDER BY id ASC",
  );
  console.log(`Backfilling ${rows.length} circle(s)…`);
  let ok = 0;
  for (const r of rows) {
    try {
      await syncCircleFacts(r.owner_id, r.id);
      ok += 1;
      console.log(`  ✓ circle ${r.id}`);
    } catch (err) {
      console.error(`  ✗ circle ${r.id}:`, err?.message ?? err);
    }
  }
  console.log(`✓ done — ${ok}/${rows.length} circles synced.`);
  process.exit(0);
};

run().catch((err) => {
  console.error("✗ backfill failed:", err);
  process.exit(1);
});
