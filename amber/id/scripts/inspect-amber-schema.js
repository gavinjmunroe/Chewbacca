// Throwaway: dump column names + types for the Cloud SQL "amber" tables that
// user-store.js will be repointed onto. Uses the AMBER_SQL_* connection (db/sql.js).
// Run: railway run node scripts/inspect-amber-schema.js   — safe to delete after.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-amber-schema.json");
  fs.writeFileSync(tmp, credsJson);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { query } = await import("../src/db/sql.js");

const TABLES = [
  "users",
  "contacts",
  "contact_notes",
  "contact_experiences",
  "contact_name_memory",
  "personality_profiles",
  "permissions",
  "permission_audit",
  "onboarding_progress",
  "user_facts",
];

try {
  for (const t of TABLES) {
    const { rows } = await query(
      `select column_name, data_type
       from information_schema.columns
       where table_schema = 'public' and table_name = $1
       order by ordinal_position`,
      [t],
    );
    if (rows.length === 0) {
      console.log(`\n📂 ${t}: (not present)`);
      continue;
    }
    console.log(`\n📂 ${t}`);
    for (const r of rows) console.log(`   - ${r.column_name} : ${r.data_type}`);
  }
  process.exit(0);
} catch (err) {
  console.error("schema inspect failed:", err?.message || err);
  process.exit(1);
}
