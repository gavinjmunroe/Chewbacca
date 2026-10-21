// Widens note_reactions_kind_chk to accept the fifth tapback ('like').
//
//   railway run node scripts/apply-reactions-migration.js
//
// Idempotent: DROP CONSTRAINT IF EXISTS then ADD, so running it twice leaves the
// same constraint. Mirrors scripts/apply-note-media-migration.js.

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
  "20260818_reactions_add_like.sql",
);

const sql = fs
  .readFileSync(sqlPath, "utf8")
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .trim();

const EXPECTED = ["emphasis", "like", "dislike", "laugh", "question"];

try {
  await query(sql);

  // Read the constraint back rather than trusting "no error". An ALTER that ran
  // against the wrong database, or a DROP that succeeded while the ADD silently did
  // not, both look like success from here otherwise.
  const { rows } = await query(
    `SELECT pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = 'note_reactions' AND c.conname = 'note_reactions_kind_chk'`,
  );
  const def = rows[0]?.def ?? "";
  if (!def) {
    console.error("✗ note_reactions_kind_chk is missing after the migration ran.");
    process.exit(1);
  }
  const missing = EXPECTED.filter((k) => !def.includes(`'${k}'`));
  if (missing.length > 0) {
    console.error(`✗ constraint does not accept: ${missing.join(", ")}`);
    console.error(`   it reads: ${def}`);
    process.exit(1);
  }
  console.log(`✓ note_reactions_kind_chk accepts all ${EXPECTED.length} kinds`);
  console.log(`   ${def}`);

  // Any row already holding a kind the client no longer offers would render as a
  // blank pill. Report it rather than deleting anything — this migration only ever
  // widens, and nothing here should be destructive.
  const { rows: strays } = await query(
    `SELECT kind, count(*)::int AS n
       FROM note_reactions
      WHERE NOT (kind = ANY($1::text[]))
      GROUP BY kind`,
    [EXPECTED],
  );
  if (strays.length > 0) {
    console.log("⚠ rows with kinds the client no longer renders (left in place):");
    for (const s of strays) console.log(`   ${s.kind}: ${s.n}`);
  } else {
    console.log("✓ every stored reaction is one the client can draw");
  }
  process.exit(0);
} catch (err) {
  console.error("✗ migration failed:", err);
  process.exit(1);
}
