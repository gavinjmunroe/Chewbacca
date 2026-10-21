// Throwaway integration smoke for F2 resolveOneContact, against live Cloud SQL
// amber DB with the STUB provider (forced). Synthetic random owner + a mock
// Chicago/UChicago prior. Asserts resolveOneContact wrote either resolved
// fields or an ambiguous candidate array to F1 storage, per the ranker.
//
// Run: railway run node scripts/smoke-f2-resolve.js   — safe to delete after.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-smoke-f2.json");
  fs.writeFileSync(tmp, credsJson);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}
// Force the deterministic stub provider (no live Clay call).
process.env.ENRICHMENT_PROVIDER = "stub";

const { query } = await import("../src/db/sql.js");
const { resolveOneContact } = await import("../src/enrichment/resolve-contact.js");

let failed = false;
function check(label, cond, detail) {
  if (cond) console.log(`✅ ${label}`);
  else {
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
    failed = true;
  }
}

const owner = randomUUID();
const phone = "+1999" + String(Math.floor(1000000 + Math.random() * 8999999));
let contactId = null;

try {
  // Mock prior: a Chicago / University of Chicago / Acme Corp user.
  await query(
    `INSERT INTO users (amber_id, phone, status, current_city, school, occupation)
     VALUES ($1, $2, 'active', 'Chicago', 'University of Chicago', 'Acme Corp')`,
    [owner, phone],
  );

  // A contact with a Chicago (312) area code.
  const { rows: ins } = await query(
    `INSERT INTO contacts (owner_id, full_name, phone_primary, phone_primary_normalized, source)
     VALUES ($1, 'John Doe', '+13125550123', '13125550123', 'smoke') RETURNING id`,
    [owner],
  );
  contactId = String(ins[0].id);
  check("created contact", !!contactId, "no id");

  const summary = await resolveOneContact(owner, contactId);
  console.log(`   resolveOneContact → ${JSON.stringify(summary)}`);
  check(
    "resolution is auto or ambiguous (candidates found)",
    summary.resolution === "auto" || summary.resolution === "ambiguous",
    `resolution=${summary.resolution}`,
  );
  check("count > 0 (ranked, nothing filtered out)", summary.count > 0, `count=${summary.count}`);

  const { rows } = await query(
    `SELECT enrichment_status, linkedin_url, company, title, enrichment, enrichment_candidates
       FROM contacts WHERE id = $1 AND owner_id = $2`,
    [contactId, owner],
  );
  const row = rows[0] || {};

  if (summary.resolution === "auto") {
    check("status 'resolved'", row.enrichment_status === "resolved", `status=${row.enrichment_status}`);
    check("chosen linkedin_url written to column", !!row.linkedin_url, `linkedin_url=${row.linkedin_url}`);
    check("enrichment jsonb written (provider stub)", row.enrichment?.provider === "stub", JSON.stringify(row.enrichment));
    check("no leftover candidates on auto", row.enrichment_candidates == null, JSON.stringify(row.enrichment_candidates));
  } else {
    check("status 'ambiguous'", row.enrichment_status === "ambiguous", `status=${row.enrichment_status}`);
    check(
      "ambiguous candidate array stored (full ranked)",
      Array.isArray(row.enrichment_candidates) && row.enrichment_candidates.length > 0,
      JSON.stringify(row.enrichment_candidates),
    );
  }
} catch (e) {
  console.log(`❌ unexpected error: ${e?.stack || e?.message || e}`);
  failed = true;
} finally {
  try {
    await query(`DELETE FROM contacts WHERE owner_id = $1`, [owner]);
    await query(`DELETE FROM users WHERE amber_id = $1`, [owner]);
    console.log("✅ cleanup done");
  } catch (e) {
    console.log(`❌ cleanup failed: ${e?.message || e}`);
    failed = true;
  }
}

console.log(failed ? "\n❌ SMOKE FAILED" : "\n✅ SMOKE PASSED");
process.exit(failed ? 1 : 0);
