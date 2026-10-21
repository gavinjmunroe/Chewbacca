// Throwaway smoke: proves mergeContact collapses multi-source contacts into ONE
// canonical contact with provenance rows, against the live Cloud SQL amber DB.
// Uses a random synthetic owner_id so no real user's contacts are touched.
//
// Run: railway run node scripts/smoke-contact-merge.js   — safe to delete after.
// Cleans up (hard-deletes its contact_sources + contacts) in a finally.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-smoke-merge.json");
  fs.writeFileSync(tmp, credsJson);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { query } = await import("../src/db/sql.js");
const { mergeContact } = await import("../src/db/store.js");

let failed = false;
function check(label, cond, detail) {
  if (cond) console.log(`✅ ${label}`);
  else {
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
    failed = true;
  }
}

const owner = randomUUID(); // synthetic, isolated test owner

async function counts() {
  const { rows: c } = await query(
    `SELECT count(*)::int AS n FROM contacts WHERE owner_id = $1 AND deleted_at IS NULL`,
    [owner],
  );
  const { rows: s } = await query(
    `SELECT count(*)::int AS n FROM contact_sources WHERE owner_id = $1 AND deleted_at IS NULL`,
    [owner],
  );
  return { contacts: c[0].n, sources: s[0].n };
}

try {
  console.log(`   test owner ${owner}`);

  // 1) Apple record → new canonical contact.
  const apple = await mergeContact(owner, {
    source: "apple",
    externalId: "apple-smoke-1",
    fullName: "Test Person",
    emails: ["a@x.com"],
    phones: ["+15551230001"],
  });
  check("apple merge → created", apple && apple.action === "created", JSON.stringify(apple));

  // 2) Google record sharing the email (diff externalId, adds company) → merged.
  const google = await mergeContact(owner, {
    source: "google",
    externalId: "google-smoke-1",
    fullName: "Test Person",
    emails: ["a@x.com"],
    phones: [],
    company: "Acme",
  });
  check("google merge (shared email) → merged", google && google.action === "merged", JSON.stringify(google));
  check(
    "google merged into the SAME canonical contact",
    apple && google && google.contactId === apple.contactId,
    `apple=${apple?.contactId} google=${google?.contactId}`,
  );

  // 3) One canonical contact; fields unioned/filled; two provenance rows.
  const c1 = await counts();
  check("exactly ONE canonical contact", c1.contacts === 1, `contacts=${c1.contacts}`);
  check("exactly TWO contact_sources rows", c1.sources === 2, `sources=${c1.sources}`);

  const { rows: crow } = await query(
    `SELECT phones_all, emails, company FROM contacts WHERE owner_id = $1 AND deleted_at IS NULL LIMIT 1`,
    [owner],
  );
  const canon = crow[0] || {};
  check("phone preserved on canonical", (canon.phones_all || "").includes("5551230001") || (canon.phones_all || "").includes("+15551230001"), `phones_all=${canon.phones_all}`);
  check("email unioned (single a@x.com)", (canon.emails || "").toLowerCase().includes("a@x.com"), `emails=${canon.emails}`);
  check("company filled from google", canon.company === "Acme", `company=${canon.company}`);

  // 4) Re-merge the same google record → idempotent.
  const googleAgain = await mergeContact(owner, {
    source: "google",
    externalId: "google-smoke-1",
    fullName: "Test Person",
    emails: ["a@x.com"],
    phones: [],
    company: "Acme",
  });
  check("re-merge google → updated (idempotent)", googleAgain && googleAgain.action === "updated", JSON.stringify(googleAgain));
  const c2 = await counts();
  check("still ONE contact + TWO sources after re-merge", c2.contacts === 1 && c2.sources === 2, JSON.stringify(c2));

  // 5) Unrelated google record → a brand-new canonical contact.
  const other = await mergeContact(owner, {
    source: "google",
    externalId: "google-smoke-2",
    fullName: "Other Human",
    emails: ["z@y.com"],
    phones: ["+15559990002"],
  });
  check("unrelated google → created (new contact)", other && other.action === "created", JSON.stringify(other));
  check(
    "new contact is distinct from the canonical one",
    other && apple && other.contactId !== apple.contactId,
    `other=${other?.contactId} apple=${apple?.contactId}`,
  );
  const c3 = await counts();
  check("now TWO canonical contacts", c3.contacts === 2, `contacts=${c3.contacts}`);
} catch (e) {
  console.log(`❌ unexpected error: ${e?.stack || e?.message || e}`);
  failed = true;
} finally {
  // Cleanup: contact_sources first (FK contact_id → contacts), then contacts.
  try {
    await query(`DELETE FROM contact_sources WHERE owner_id = $1`, [owner]);
    await query(`DELETE FROM contacts WHERE owner_id = $1`, [owner]);
    console.log("✅ cleanup done");
  } catch (e) {
    console.log(`❌ cleanup failed: ${e?.message || e}`);
    failed = true;
  }
}

console.log(failed ? "\n❌ SMOKE FAILED" : "\n✅ SMOKE PASSED");
process.exit(failed ? 1 : 0);
