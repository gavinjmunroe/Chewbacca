// Creates voice_vocabulary -- the learned voice dictionary that was never created.
//
//   railway run node scripts/apply-voice-vocab-migration.js
//
// src/lib/voice-vocab.js has been writing to this table for a while and catching every
// error, by design, so transcription can never break because of it. The side effect is
// that a missing table looks exactly like a working one: corrections vanish silently
// and the next transcript repeats the mistake. This creates it and then PROVES it
// works by writing a probe term and reading it back.
//
// Idempotent: CREATE TABLE / INDEX IF NOT EXISTS, so running it twice is a no-op.
// Mirrors scripts/apply-note-media-migration.js.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Materialize the service-account JSON (Railway's GOOGLE_APPLICATION_CREDENTIALS_JSON
// shape) so the Cloud SQL connector's Application Default Credentials can find it.
// Must happen BEFORE sql.js is imported, since that is when the connector is
// constructed — hence the dynamic import below. Skip it and the connector falls back
// to your personal gcloud login, which under an org reauth policy fails with
// `invalid_grant / invalid_rapt`.
const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-migration.json");
  fs.writeFileSync(tmp, credsJson);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { query } = await import("../src/db/sql.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(
  __dirname,
  "..",
  "db",
  "migrations",
  "20260818_add_voice_vocabulary.sql",
);

const sql = fs
  .readFileSync(sqlPath, "utf8")
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .trim();

try {
  await query(sql);

  // Read the schema back rather than trusting "no error" -- a migration that ran
  // against the wrong database looks identical to success from here.
  const { rows: cols } = await query(
    `SELECT column_name, data_type
       FROM information_schema.columns
      WHERE table_name = 'voice_vocabulary'
      ORDER BY ordinal_position`,
  );
  if (cols.length === 0) {
    console.error("\u2717 voice_vocabulary is missing after the migration ran.");
    process.exit(1);
  }
  console.log(`\u2713 voice_vocabulary: ${cols.length} columns`);
  console.log(`   ${cols.map((c) => `${c.column_name} ${c.data_type}`).join(", ")}`);

  // The exact columns src/lib/voice-vocab.js writes. A missing one would be swallowed
  // by that file's deliberate fail-open catch, leaving the feature silently dead --
  // which is the bug this migration exists to fix, so it is worth asserting.
  const have = new Set(cols.map((c) => c.column_name));
  const need = ["owner_id", "term", "term_key", "contact_id", "hits", "updated_at"];
  const missing = need.filter((c) => !have.has(c));
  if (missing.length > 0) {
    console.error(`\u2717 missing columns: ${missing.join(", ")}`);
    process.exit(1);
  }
  console.log("\u2713 every column voice-vocab.js writes is present");

  const { rows: idx } = await query(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'voice_vocabulary'`,
  );
  console.log(`\u2713 indexes: ${idx.map((r) => r.indexname).join(", ")}`);

  // Prove the round trip end to end, against the real table, with a term nobody would
  // ever say. Writing then reading is the only way to know the fail-open catch is not
  // still swallowing something.
  const probeOwner = "00000000-0000-4000-8000-000000000000";
  const probeTerm = "ZzProbeTerm" + Date.now();
  const { recordVoiceVocab, getVoiceVocab } = await import("../src/lib/voice-vocab.js");
  await recordVoiceVocab(probeOwner, [probeTerm]);
  const back = await getVoiceVocab(probeOwner, 5);
  if (!back.includes(probeTerm)) {
    console.error("\u2717 wrote a term but could not read it back -- the table is still not usable.");
    process.exit(1);
  }
  await query(`DELETE FROM voice_vocabulary WHERE owner_id = $1`, [probeOwner]);
  console.log("\u2713 round trip verified: a correction now actually persists");
  process.exit(0);
} catch (err) {
  console.error("✗ migration failed:", err);
  process.exit(1);
}
