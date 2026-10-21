// Throwaway READ-ONLY smoke: fetch a user's Google contacts (both buckets) via
// src/lib/google-contacts.js and print a summary. No writes, no cleanup.
//
// Usage: railway run node scripts/smoke-google-contacts.js <did-or-phone-or-amber_id>
//
// The identifier is whatever the Google token is stored under. A did:* /
// amber_id uuid / 32-hex person_id is passed straight to the secrets read
// (getSecret resolves it); a phone is resolved to an amber_id first.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Materialize the service-account JSON to a temp file BEFORE importing anything
// that touches db/sql.js (mirrors the phase smoke scripts).
const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-smoke-gcontacts.json");
  fs.writeFileSync(tmp, credsJson);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { fetchGoogleContacts } = await import("../src/lib/google-contacts.js");
const { normalizePhone } = await import("../src/lib/auth-session.js");
const { resolveAmberIdByPhone } = await import("../src/db/store.js");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERSON_ID_RE = /^[0-9a-f]{32}$/i;

function sampleNames(list) {
  return list
    .slice(0, 5)
    .map((c) => c.fullName || "(no name)")
    .join(", ");
}

async function resolveIdentifier(arg) {
  if (arg.startsWith("did:") || UUID_RE.test(arg) || PERSON_ID_RE.test(arg)) {
    return arg; // getSecret's resolver understands all of these directly
  }
  // Treat as a phone → amber_id.
  const phone = normalizePhone(arg);
  const amberId = phone ? await resolveAmberIdByPhone(phone).catch(() => null) : null;
  return amberId; // may be null
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.log("❌ usage: node scripts/smoke-google-contacts.js <did-or-phone-or-amber_id>");
    process.exit(1);
  }

  const identifier = await resolveIdentifier(arg);
  if (!identifier) {
    console.log(`❌ could not resolve identifier "${arg}" to a user`);
    process.exit(1);
  }

  const result = await fetchGoogleContacts(identifier);

  if (!result.connected) {
    console.log(`ℹ️  not connected: no Google refresh token for "${arg}" — nothing to fetch.`);
    process.exit(0);
  }

  console.log(`✅ connected: true`);
  console.log(`   grantedScopes: ${result.grantedScopes.length ? result.grantedScopes.join(" ") : "(none recorded)"}`);
  console.log(`   otherContactsScope: ${result.otherContactsScope}`);
  console.log(`   saved kept:   ${result.saved.length}`);
  console.log(`   other kept:   ${result.other.length}`);
  console.log(`   filtered out: ${result.filteredCount}`);
  console.log(`   saved sample: ${sampleNames(result.saved) || "(none)"}`);
  console.log(`   other sample: ${sampleNames(result.other) || "(none)"}`);
  process.exit(0);
}

main().catch((e) => {
  console.log(`❌ unexpected error: ${e?.stack || e?.message || e}`);
  process.exit(1);
});
