// Throwaway: drop the stale/empty otp_codes table so the migration can
// recreate it cleanly (the pre-existing table lacked the `id` column the
// store depends on). Mirrors run-migration.js credential materialization.
// Run: railway run node scripts/drop-otp.js   — then re-run the migration.
// Safe to delete after.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-drop.json");
  fs.writeFileSync(tmp, credsJson);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { query } = await import("../src/db/sql.js");

try {
  const cnt = await query("select count(*)::int as n from otp_codes");
  if (cnt.rows[0].n > 0) {
    console.error(`REFUSING: otp_codes has ${cnt.rows[0].n} rows — not dropping.`);
    process.exit(1);
  }
  await query("DROP TABLE IF EXISTS otp_codes");
  console.log("✓ dropped empty otp_codes table");
  process.exit(0);
} catch (err) {
  console.error("drop failed:", err);
  process.exit(1);
}
