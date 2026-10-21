// Generic migration runner. Reads the SQL file at process.argv[2] and applies
// it to Cloud SQL using the app's own connection pool.
// Run with production env injected:
//   railway run node scripts/run-migration.js db/migrations/<file>.sql
// Comment lines (--) are stripped; the rest is sent as one query.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Materialize the service-account JSON to a temp file so the Cloud SQL
// connector's Application Default Credentials can find it — mirrors
// src/db/firestore.js. Must run BEFORE dynamically importing sql.js.
const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-migration.json");
  fs.writeFileSync(tmp, credsJson);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { query } = await import("../src/db/sql.js");

const migrationPath = process.argv[2];
if (!migrationPath) {
  console.error("Usage: node scripts/run-migration.js <path-to-sql-file>");
  process.exit(1);
}

const sql = fs
  .readFileSync(migrationPath, "utf8")
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .trim();

try {
  await query(sql);
  console.log(`✓ applied ${migrationPath}`);
  process.exit(0);
} catch (err) {
  console.error("✗ migration failed:", err);
  process.exit(1);
}
