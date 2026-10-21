// Throwaway smoke for F1 enrichment lifecycle, against live Cloud SQL amber DB,
// using a random synthetic owner_id (no real user touched). Verifies the
// ambiguous → resolved lifecycle and the read-path split-brain fix (dedicated
// columns win over metadata.*).
//
// Run: railway run node scripts/smoke-f1-enrichment.js   — safe to delete after.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-smoke-f1.json");
  fs.writeFileSync(tmp, credsJson);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { query } = await import("../src/db/sql.js");
const { setContactEnrichmentCandidates, resolveContactEnrichment } = await import("../src/db/store.js");
const { rowToContact } = await import("../src/db/user-store.js");

let failed = false;
function check(label, cond, detail) {
  if (cond) console.log(`✅ ${label}`);
  else {
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
    failed = true;
  }
}

const owner = randomUUID();
let contactId = null;

async function fetchRow() {
  const { rows } = await query(`SELECT * FROM contacts WHERE id = $1 AND owner_id = $2`, [contactId, owner]);
  return rows[0] || null;
}

try {
  // 1) Create a contact.
  const { rows: ins } = await query(
    `INSERT INTO contacts (owner_id, full_name, source) VALUES ($1, 'Enrich Target', 'smoke') RETURNING id`,
    [owner],
  );
  contactId = String(ins[0].id);
  check("created contact", !!contactId, "no id");

  // 2) Ambiguous candidates.
  const candidates = [
    { rank: 1, name: "Enrich Target", linkedin_url: "https://linkedin.com/in/a", company: "Acme" },
    { rank: 2, name: "Enrich Target", linkedin_url: "https://linkedin.com/in/b", company: "Globex" },
  ];
  const setRes = await setContactEnrichmentCandidates(owner, contactId, candidates);
  check("setContactEnrichmentCandidates returned contactId", setRes && setRes.contactId === contactId, JSON.stringify(setRes));
  let row = await fetchRow();
  check("status = 'ambiguous'", row?.enrichment_status === "ambiguous", `status=${row?.enrichment_status}`);
  check(
    "enrichment_candidates present (array of 2)",
    Array.isArray(row?.enrichment_candidates) && row.enrichment_candidates.length === 2,
    JSON.stringify(row?.enrichment_candidates),
  );
  check("not yet resolved (enriched_at null)", row?.enriched_at == null, `enriched_at=${row?.enriched_at}`);

  // 3) Resolve with the chosen profile.
  const chosen = {
    fields: {
      linkedin_url: "https://linkedin.com/in/chosen",
      company: "ChosenCo",
      title: "Chosen Title",
    },
    enrichment: { provider: "smoke", confidence: 0.99, headline: "Chosen headline", fetched_at: "2026-07-29T00:00:00Z" },
  };
  const resolveRes = await resolveContactEnrichment(owner, contactId, chosen);
  check("resolveContactEnrichment returned contactId", resolveRes && resolveRes.contactId === contactId, JSON.stringify(resolveRes));
  row = await fetchRow();
  check("status = 'resolved'", row?.enrichment_status === "resolved", `status=${row?.enrichment_status}`);
  check("chosen linkedin_url written to column", row?.linkedin_url === "https://linkedin.com/in/chosen", `linkedin_url=${row?.linkedin_url}`);
  check("chosen company written to column", row?.company === "ChosenCo", `company=${row?.company}`);
  check("chosen title written to column", row?.title === "Chosen Title", `title=${row?.title}`);
  check("enrichment jsonb merged (provider=smoke)", row?.enrichment?.provider === "smoke", JSON.stringify(row?.enrichment));
  check("enrichment_candidates cleared to NULL", row?.enrichment_candidates == null, JSON.stringify(row?.enrichment_candidates));
  check("enriched_at set", row?.enriched_at != null, `enriched_at=${row?.enriched_at}`);

  // 4) Split-brain read fix: columns win over metadata.* in rowToContact.
  await query(
    `UPDATE contacts SET avatar_url = 'COL_AVATAR', linkedin_url = 'COL_LINKEDIN',
       metadata = '{"avatarUrl":"META_AVATAR","linkedinUrl":"META_LINKEDIN"}'::jsonb
     WHERE id = $1 AND owner_id = $2`,
    [contactId, owner],
  );
  const shaped = rowToContact(await fetchRow());
  check("rowToContact reads avatarUrl from COLUMN (not metadata)", shaped?.avatarUrl === "COL_AVATAR", `avatarUrl=${shaped?.avatarUrl}`);
  check("rowToContact reads linkedinUrl from COLUMN (not metadata)", shaped?.linkedinUrl === "COL_LINKEDIN", `linkedinUrl=${shaped?.linkedinUrl}`);
  check("rowToContact surfaces enrichmentStatus", shaped?.enrichmentStatus === "resolved", `enrichmentStatus=${shaped?.enrichmentStatus}`);

  // Legacy fallback: column NULL → metadata.* used.
  await query(
    `UPDATE contacts SET avatar_url = NULL,
       metadata = '{"avatarUrl":"META_ONLY"}'::jsonb WHERE id = $1 AND owner_id = $2`,
    [contactId, owner],
  );
  const legacy = rowToContact(await fetchRow());
  check("legacy fallback: NULL column → metadata.avatarUrl", legacy?.avatarUrl === "META_ONLY", `avatarUrl=${legacy?.avatarUrl}`);
} catch (e) {
  console.log(`❌ unexpected error: ${e?.stack || e?.message || e}`);
  failed = true;
} finally {
  try {
    await query(`DELETE FROM contacts WHERE owner_id = $1`, [owner]);
    console.log("✅ cleanup done");
  } catch (e) {
    console.log(`❌ cleanup failed: ${e?.message || e}`);
    failed = true;
  }
}

console.log(failed ? "\n❌ SMOKE FAILED" : "\n✅ SMOKE PASSED");
process.exit(failed ? 1 : 0);
