// Throwaway READ-ONLY schema dump for the contact-enrichment foundation (F1).
// Prints the EXACT live columns/types/nullability for the contacts-related
// tables so we can commit a canonical DDL that matches production instead of a
// reconstruction. No writes.
//
// Run: railway run node scripts/inspect-contacts-schema.js

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-contacts-schema.json");
  fs.writeFileSync(tmp, credsJson);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { query } = await import("../src/db/sql.js");

const TABLES = ["contacts", "contact_sources", "contact_facts", "users"];

try {
  for (const t of TABLES) {
    const { rows: cols } = await query(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position`,
      [t],
    );
    if (cols.length === 0) {
      console.log(`\n📂 ${t}: (not present)`);
      continue;
    }
    console.log(`\n📂 ${t}  (${cols.length} columns)`);
    for (const c of cols) {
      const nul = c.is_nullable === "YES" ? "NULL" : "NOT NULL";
      const def = c.column_default ? ` default ${String(c.column_default).slice(0, 40)}` : "";
      console.log(`   - ${c.column_name} : ${c.data_type} ${nul}${def}`);
    }
    // Indexes for this table (so the canonical DDL can reproduce them).
    const { rows: idx } = await query(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = $1
        ORDER BY indexname`,
      [t],
    );
    if (idx.length) {
      console.log(`   indexes:`);
      for (const i of idx) console.log(`     · ${i.indexdef}`);
    }
  }
  process.exit(0);
} catch (err) {
  console.error("schema inspect failed:", err?.message || err);
  process.exit(1);
}
