// Throwaway integration smoke for F4b cross-user visibility, against live Cloud
// SQL amber DB with synthetic users. Exercises the real policy + viewer-context
// + store composition via the exported getVisibleProfile / getVisibleNetwork
// (the routes are thin wrappers over these). No HTTP boot.
//
// Run: railway run node scripts/smoke-f4b-visibility.js   — safe to delete after.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-smoke-f4b.json");
  fs.writeFileSync(tmp, credsJson);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { query } = await import("../src/db/sql.js");
const { getVisibleProfile, getVisibleNetwork } = await import("../src/routes/profiles-public.js");

let failed = false;
function check(label, cond, detail) {
  if (cond) console.log(`✅ ${label}`);
  else {
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
    failed = true;
  }
}

const A = randomUUID(); // viewer (connected mutual)
const B = randomUUID(); // owner
const C = randomUUID(); // stranger (no users row needed)
const rnd = () => String(Math.floor(1000000 + Math.random() * 8999999));
const suffix = rnd();

async function setBTier(tier) {
  await query(`UPDATE users SET privacy_tier = $2 WHERE amber_id = $1`, [B, tier]);
}

try {
  // Owner B: full_social, with phone + email + linkedin + city.
  await query(
    `INSERT INTO users (amber_id, phone, status, full_name, username, current_city, school, occupation, privacy_tier, profile_extra)
     VALUES ($1, $2, 'active', 'Bella Owner', $3, 'Chicago', 'University of Chicago', 'Engineer', 'full_social',
             $4::jsonb)`,
    [B, "+1999" + suffix, "bella_" + suffix, JSON.stringify({ linkedinUrl: "https://linkedin.com/in/bella", email: "bella@example.com" })],
  );
  // Viewer A.
  await query(
    `INSERT INTO users (amber_id, phone, status, full_name, username) VALUES ($1, $2, 'active', 'Al Viewer', $3)`,
    [A, "+1998" + suffix, "al_" + suffix],
  );
  // Connection A<->B (canonical a_amber_id < b_amber_id).
  const ua = A < B ? A : B;
  const ub = A < B ? B : A;
  await query(`INSERT INTO connections (a_amber_id, b_amber_id) VALUES ($1, $2)`, [ua, ub]);
  // B's contacts (with contact methods + enrichment that must be stripped).
  await query(
    `INSERT INTO contacts (owner_id, full_name, company, title, city, phone_primary, phone_primary_normalized, emails, linkedin_url, source, enrichment)
     VALUES
       ($1,'Carla Contact','Acme','VP','Chicago','+13125551111','13125551111','carla@acme.com','https://linkedin.com/in/carla','smoke','{"provider":"stub"}'::jsonb),
       ($1,'Dan Contact','Globex','PM','Denver','+17205552222','17205552222','dan@globex.com','https://linkedin.com/in/dan','smoke','{"provider":"stub"}'::jsonb)`,
    [B],
  );

  // ── 1) A (connected + B shares) views B's profile ──
  let prof = await getVisibleProfile(A, B);
  check("A→B profile: name visible", prof?.name === "Bella Owner", JSON.stringify(prof));
  check("A→B profile: city visible", prof?.city === "Chicago", JSON.stringify(prof));
  check("A→B profile: linkedin_url visible", prof?.linkedin_url === "https://linkedin.com/in/bella", JSON.stringify(prof));
  check("A→B profile: phone NOT visible", !("phone" in (prof || {})), JSON.stringify(prof));
  check("A→B profile: email NOT visible", !("email" in (prof || {})), JSON.stringify(prof));

  // ── 2) A views B's network (baseline-only) ──
  let net = await getVisibleNetwork(A, B);
  check("A→B network: 2 contacts", net.length === 2, `len=${net.length}`);
  const c0 = net[0] || {};
  check("A→B network: name/company/city/linkedin visible", c0.name && c0.company && c0.city && c0.linkedinUrl, JSON.stringify(c0));
  check("A→B network: phoneNumbers NOT present", !("phoneNumbers" in c0), JSON.stringify(c0));
  check("A→B network: emails NOT present", !("emails" in c0), JSON.stringify(c0));
  check("A→B network: enrichment NOT present", !("enrichment" in c0), JSON.stringify(c0));

  // ── 3) Stranger C (not connected), B still full_social → nothing ──
  const cProf = await getVisibleProfile(C, B);
  check("C→B profile: empty (not connected)", cProf && Object.keys(cProf).length === 0, JSON.stringify(cProf));
  const cNet = await getVisibleNetwork(C, B);
  check("C→B network: [] (not connected)", Array.isArray(cNet) && cNet.length === 0, JSON.stringify(cNet));

  // ── 4) B not full_social → connected A sees nothing ──
  await setBTier("selective_cloud");
  prof = await getVisibleProfile(A, B);
  check("A→B profile: empty when owner not full_social", prof && Object.keys(prof).length === 0, JSON.stringify(prof));
  net = await getVisibleNetwork(A, B);
  check("A→B network: [] when owner not full_social", Array.isArray(net) && net.length === 0, JSON.stringify(net));

  // ── 5) B viewing self → sees own phone + email ──
  const selfProf = await getVisibleProfile(B, B);
  check("B→B self: phone visible", !!selfProf?.phone, JSON.stringify(selfProf));
  check("B→B self: email visible", selfProf?.email === "bella@example.com", JSON.stringify(selfProf));
  check("B→B self: name visible", selfProf?.name === "Bella Owner", JSON.stringify(selfProf));
} catch (e) {
  console.log(`❌ unexpected error: ${e?.stack || e?.message || e}`);
  failed = true;
} finally {
  try {
    await query(`DELETE FROM contacts WHERE owner_id = $1`, [B]);
    await query(`DELETE FROM connections WHERE a_amber_id = ANY($1::uuid[]) OR b_amber_id = ANY($1::uuid[])`, [[A, B]]);
    await query(`DELETE FROM users WHERE amber_id = ANY($1::uuid[])`, [[A, B]]);
    console.log("✅ cleanup done");
  } catch (e) {
    console.log(`❌ cleanup failed: ${e?.message || e}`);
    failed = true;
  }
}

console.log(failed ? "\n❌ SMOKE FAILED" : "\n✅ SMOKE PASSED");
process.exit(failed ? 1 : 0);
