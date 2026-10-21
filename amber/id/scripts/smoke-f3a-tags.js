// Throwaway integration smoke for F3a tag/fact synthesis, against live Cloud
// SQL amber DB with the STUB provider forced. Synthetic random owner + a mock
// Chicago/UChicago/Acme prior so the stub auto-resolves. Asserts tags + facts
// were synthesized and that re-running is idempotent (no duplicate facts).
//
// Run: railway run node scripts/smoke-f3a-tags.js   — safe to delete after.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-smoke-f3a.json");
  fs.writeFileSync(tmp, credsJson);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}
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

async function liveEnrichmentFacts() {
  const { rows } = await query(
    `SELECT fact_text, category, source, status, weight FROM contact_facts
      WHERE owner_id = $1 AND contact_id = $2 AND source = 'enrichment' AND deleted_at IS NULL
      ORDER BY id`,
    [owner, contactId],
  );
  return rows;
}

try {
  // Mock prior: Chicago / University of Chicago / Acme Corp.
  await query(
    `INSERT INTO users (amber_id, phone, status, current_city, school, occupation)
     VALUES ($1, $2, 'active', 'Chicago', 'University of Chicago', 'Acme Corp')`,
    [owner, phone],
  );
  const { rows: ins } = await query(
    `INSERT INTO contacts (owner_id, full_name, phone_primary, phone_primary_normalized, source)
     VALUES ($1, 'John Doe', '+13125550123', '13125550123', 'smoke') RETURNING id`,
    [owner],
  );
  contactId = String(ins[0].id);

  // First resolve — stub's Chicago/UChicago/Acme candidate should auto-resolve.
  const first = await resolveOneContact(owner, contactId);
  console.log(`   resolveOneContact → ${JSON.stringify(first)}`);
  check("auto-resolved", first.resolution === "auto", `resolution=${first.resolution}`);

  // Tags populated on the contact.
  const { rows: crows } = await query(
    `SELECT tags FROM contacts WHERE id = $1 AND owner_id = $2`,
    [contactId, owner],
  );
  const tags = crows[0]?.tags;
  check("contacts.tags populated", Array.isArray(tags) && tags.length > 0, JSON.stringify(tags));
  check("tags include a role tag ('software')", Array.isArray(tags) && tags.includes("software"), JSON.stringify(tags));

  // Enrichment facts written in the right shape.
  const facts1 = await liveEnrichmentFacts();
  check("enrichment facts written", facts1.length >= 1, `count=${facts1.length}`);
  check(
    "facts have source='enrichment' + status='resolved'",
    facts1.every((f) => f.source === "enrichment" && f.status === "resolved"),
    JSON.stringify(facts1),
  );
  check(
    "an identity 'Works as … at …' fact present with weight",
    facts1.some((f) => /^Works as .+ at .+/.test(f.fact_text) && f.category === "identity" && f.weight != null),
    JSON.stringify(facts1),
  );
  const count1 = facts1.length;

  // Re-run — must NOT duplicate facts (idempotent).
  const second = await resolveOneContact(owner, contactId);
  check("re-resolve still auto", second.resolution === "auto", `resolution=${second.resolution}`);
  const facts2 = await liveEnrichmentFacts();
  check("no duplicate enrichment facts after re-run", facts2.length === count1, `before=${count1} after=${facts2.length}`);
} catch (e) {
  console.log(`❌ unexpected error: ${e?.stack || e?.message || e}`);
  failed = true;
} finally {
  try {
    await query(`DELETE FROM contact_facts WHERE owner_id = $1`, [owner]);
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
