// Applies the voice-note media DDL (note_audio, note_reactions, note_comments)
// to Cloud SQL using the app's own connection.
//
//   railway run node scripts/apply-note-media-migration.js
//
// Idempotent — every statement is CREATE TABLE/INDEX IF NOT EXISTS, so running it
// twice is a no-op. Mirrors scripts/apply-wall-migration.js.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Materialize the service-account JSON (Railway's GOOGLE_APPLICATION_CREDENTIALS_JSON
// shape) so the Cloud SQL connector's Application Default Credentials can find
// it. Must happen BEFORE sql.js is imported, since that is when the connector is
// constructed — hence the dynamic import below.
const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-migration.json");
  fs.writeFileSync(tmp, credsJson);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { query } = await import("../src/db/sql.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(__dirname, "..", "db", "migrations", "20260817_add_note_media.sql");

const sql = fs
  .readFileSync(sqlPath, "utf8")
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .trim();

try {
  await query(sql);
  // Read the schema back rather than trusting "no error" — a typo'd column name
  // in a CREATE TABLE IF NOT EXISTS against an already-existing table succeeds
  // silently and leaves you with the OLD shape.
  const { rows } = await query(
    `SELECT table_name, column_name, data_type
       FROM information_schema.columns
      WHERE table_name IN ('note_audio','note_reactions','note_comments')
      ORDER BY table_name, ordinal_position`,
  );
  const byTable = {};
  for (const r of rows) {
    byTable[r.table_name] = byTable[r.table_name] || [];
    byTable[r.table_name].push(`${r.column_name} ${r.data_type}`);
  }
  for (const t of ["note_audio", "note_reactions", "note_comments"]) {
    const cols = byTable[t];
    if (!cols) {
      console.error(`✗ ${t} is missing after the migration ran.`);
      process.exit(1);
    }
    console.log(`✓ ${t}: ${cols.length} columns`);
    console.log(`   ${cols.join(", ")}`);
  }
  // The types that matter: these must match note_shares or every join silently
  // becomes "operator does not exist: uuid = text" at runtime.
  const audio = byTable.note_audio.join(", ");
  if (!/owner_id uuid/.test(audio) || !/conversation_id text/.test(audio)) {
    console.error("✗ note_audio key types do not match note_shares (uuid + text).");
    process.exit(1);
  }
  console.log("✓ key types match note_shares (owner_id uuid, conversation_id text).");
  process.exit(0);
} catch (err) {
  console.error("✗ migration failed:", err);
  process.exit(1);
}
