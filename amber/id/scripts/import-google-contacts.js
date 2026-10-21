// Import a user's Google contacts into the canonical contacts table (deduped
// via mergeContact). Real, safe, idempotent admin/import tool — mergeContact is
// idempotent on (source, external_id), so re-running only enriches/updates, it
// never duplicates. This is how we import a real address book on demand.
//
// Usage: railway run node scripts/import-google-contacts.js <did-or-phone-or-amber_id>

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Materialize the service-account JSON to a temp file BEFORE importing anything
// that touches db/sql.js (mirrors the other Cloud SQL scripts).
const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-import-gcontacts.json");
  fs.writeFileSync(tmp, credsJson);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { importGoogleContactsForOwner } = await import(
  "../src/lib/google-contacts.js"
);

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.log("usage: node scripts/import-google-contacts.js <did-or-phone-or-amber_id>");
    process.exit(1);
  }

  const result = await importGoogleContactsForOwner(arg);

  if (!result.connected) {
    console.log(`ℹ️  not connected: no Google token resolves for "${arg}" — nothing imported.`);
    process.exit(1);
  }

  console.log(`✅ Google contacts import for "${arg}":`);
  console.log(`   otherContactsScope: ${result.otherContactsScope}`);
  console.log(`   fetched (post-filter): ${result.fetched}`);
  console.log(`   created: ${result.created}`);
  console.log(`   merged:  ${result.merged}`);
  console.log(`   updated: ${result.updated}`);
  console.log(`   failed:  ${result.failed}`);
  console.log(`   filtered out (junk): ${result.filteredCount}`);
  process.exit(0);
}

main().catch((e) => {
  console.log(`❌ unexpected error: ${e?.stack || e?.message || e}`);
  process.exit(1);
});
