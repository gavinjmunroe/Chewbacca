// Throwaway smoke for the dedup sweep, against live Cloud SQL amber DB, using a
// random synthetic owner_id (no real user touched). Verifies:
//   - transitive 100% grouping (A~C by phone, B~C by email → all one group)
//   - collapse leaves ONE live survivor with both phone + email, all 3
//     contact_sources repointed
//   - two same-name rows with no shared key are NOT collapsed and DO surface in
//     the name-only review list
//
// Run: railway run node scripts/smoke-dedup-sweep.js   — safe to delete after.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-smoke-dedup.json");
  fs.writeFileSync(tmp, credsJson);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { query } = await import("../src/db/sql.js");
const { collapseContactGroup } = await import("../src/db/store.js");
const { buildGroups, loadOwnerContacts } = await import("./dedup-sweep.js");

let failed = false;
function check(label, cond, detail) {
  if (cond) console.log(`✅ ${label}`);
  else {
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
    failed = true;
  }
}

const owner = randomUUID();
const P = "+15551110001";
const E = "shared@example.com";

async function insertContact({ fullName, phone = null, email = null }) {
  const phones = phone ? [phone] : [];
  const emails = email ? [email] : [];
  const { rows } = await query(
    `INSERT INTO contacts
       (owner_id, full_name, phone_primary, phones_all, emails, phone_primary_normalized, source)
     VALUES ($1, $2, $3, $4, $5, $6, 'smoke')
     RETURNING id`,
    [owner, fullName, phone, phones.join(", ") || null, emails.join(", ") || null, phone ? phone.replace(/\D/g, "") : null],
  );
  return String(rows[0].id);
}
async function insertSource(contactId, externalId) {
  await query(
    `INSERT INTO contact_sources (owner_id, contact_id, source, external_id)
     VALUES ($1, $2, 'smoke', $3)`,
    [owner, contactId, externalId],
  );
}

try {
  // A: phone only, B: email only, C: both (bridges A and B).
  const a = await insertContact({ fullName: "Alpha One", phone: P });
  const b = await insertContact({ fullName: "Beta Two", email: E });
  const c = await insertContact({ fullName: "Gamma Three", phone: P, email: E });
  await insertSource(a, "sm-a");
  await insertSource(b, "sm-b");
  await insertSource(c, "sm-c");

  // Two same-name rows with NO shared phone/email → must NOT collapse.
  const d = await insertContact({ fullName: "Same Name", phone: "+15559990001" });
  const e2 = await insertContact({ fullName: "Same Name", phone: "+15559990002" });

  const contacts = await loadOwnerContacts(owner);
  const { groups, nameOnly } = buildGroups(contacts);

  // Grouping assertions.
  check("exactly ONE 100% group", groups.length === 1, `groups=${groups.length}`);
  const g = groups[0] || {};
  check("group has all 3 members", g.members && g.members.length === 3, `members=${g.members?.length}`);
  check("survivor is lowest id (A)", g.survivorId === a, `survivor=${g.survivorId} a=${a}`);
  check(
    "absorbed are exactly {B, C}",
    g.absorbedIds && new Set(g.absorbedIds).size === 2 && g.absorbedIds.includes(b) && g.absorbedIds.includes(c),
    `absorbed=${JSON.stringify(g.absorbedIds)}`,
  );
  check(
    "name-only list contains 'same name' (D & E2), not the A/B/C group",
    nameOnly.some((n) => n.name === "same name" && n.ids.includes(d) && n.ids.includes(e2)),
    JSON.stringify(nameOnly),
  );

  // Apply the collapse (only the 100% group).
  const res = await collapseContactGroup(owner, g.survivorId, g.absorbedIds);
  check("collapse ok, 2 rows absorbed", res && res.ok && res.collapsed === 2, JSON.stringify(res));

  // Exactly one live contact among A/B/C, and it's A with P + E.
  const { rows: liveAbc } = await query(
    `SELECT id, phones_all, emails FROM contacts
      WHERE owner_id = $1 AND id = ANY($2::bigint[]) AND deleted_at IS NULL`,
    [owner, [a, b, c]],
  );
  check("exactly ONE live contact among A/B/C", liveAbc.length === 1, `live=${liveAbc.length}`);
  const survivor = liveAbc[0] || {};
  check("survivor is A", String(survivor.id) === a, `survivor=${survivor.id}`);
  check("survivor has phone P", (survivor.phones_all || "").includes("5551110001"), `phones_all=${survivor.phones_all}`);
  check("survivor has email E", (survivor.emails || "").toLowerCase().includes(E), `emails=${survivor.emails}`);

  // All 3 provenance rows repointed to the survivor.
  const { rows: srcRows } = await query(
    `SELECT external_id, contact_id FROM contact_sources WHERE owner_id = $1 AND deleted_at IS NULL`,
    [owner],
  );
  check(
    "all 3 contact_sources repointed to survivor",
    srcRows.length === 3 && srcRows.every((r) => String(r.contact_id) === a),
    JSON.stringify(srcRows),
  );

  // D & E2 untouched (still two live 'Same Name' contacts).
  const { rows: sameName } = await query(
    `SELECT id FROM contacts WHERE owner_id = $1 AND lower(btrim(full_name)) = 'same name' AND deleted_at IS NULL`,
    [owner],
  );
  check("name-only rows NOT collapsed (still 2 live)", sameName.length === 2, `live 'Same Name'=${sameName.length}`);
} catch (e) {
  console.log(`❌ unexpected error: ${e?.stack || e?.message || e}`);
  failed = true;
} finally {
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
