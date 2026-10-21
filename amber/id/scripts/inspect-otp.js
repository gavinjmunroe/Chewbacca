// Throwaway diagnostic: dump otp_codes schema + row count.
// Mirrors scripts/run-migration.js credential materialization so the Cloud SQL
// connector authenticates via the Railway-injected service account (NOT local
// gcloud ADC). Run with: railway run node scripts/inspect-otp.js
// Safe to delete after debugging.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-inspect.json");
  fs.writeFileSync(tmp, credsJson);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { query } = await import("../src/db/sql.js");

try {
  const cols = await query(
    "select column_name, is_nullable, column_default from information_schema.columns where table_name = 'otp_codes' order by ordinal_position",
  );
  console.log("=== otp_codes columns ===");
  console.table(cols.rows);

  const cnt = await query("select count(*)::int as n from otp_codes");
  console.log("row count:", cnt.rows[0].n);

  process.exit(0);
} catch (err) {
  console.error("inspect failed:", err);
  process.exit(1);
}
