// Applies the wall_posts DDL to Cloud SQL using the app's own connection.
// Run with production env injected:
//   railway run node scripts/apply-wall-migration.js
// Idempotent — the migration uses CREATE TABLE/INDEX IF NOT EXISTS.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Materialize the service-account JSON (Railway's GOOGLE_APPLICATION_CREDENTIALS_JSON
// shape) to a file so the Cloud SQL connector's Application Default Credentials
// can find it — mirrors src/db/firestore.js. Must run BEFORE the connector is
// instantiated (i.e. before sql.js's getPool()), so we set it up here and only
// then dynamically import the pool.
const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-migration.json");
  fs.writeFileSync(tmp, credsJson);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { query } = await import("../src/db/sql.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(__dirname, "..", "db", "migrations", "20260722_add_wall_posts.sql");

// Strip comment lines, run the statements as one simple query (pg allows
// multiple ';'-separated statements when no params are passed).
const sql = fs
  .readFileSync(sqlPath, "utf8")
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .trim();

try {
  await query(sql);
  console.log("✓ wall_posts table + index applied to Cloud SQL.");
  process.exit(0);
} catch (err) {
  console.error("✗ migration failed:", err);
  process.exit(1);
}
