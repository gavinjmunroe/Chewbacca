// Throwaway integration smoke for F5 disambiguation-prior fields, against live
// Cloud SQL amber DB with a synthetic user. Upserts the prior fields through
// upsertProfile (the same profile_extra overflow path PATCH /v1/me now uses),
// then asserts they round-trip out of getProfile and that buildMe surfaces
// cities/schools/employers. No HTTP boot.
//
// Run: railway run node scripts/smoke-f5-prior.js   — safe to delete after.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-smoke-f5.json");
  fs.writeFileSync(tmp, credsJson);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { query } = await import("../src/db/sql.js");
const { upsertProfile, getProfile } = await import("../src/db/user-store.js");
const { buildMe } = await import("../src/enrichment/togari-search-rank.js");

let failed = false;
function check(label, cond, detail) {
  if (cond) console.log(`✅ ${label}`);
  else {
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
    failed = true;
  }
}

const A = randomUUID(); // synthetic user; bare uuid resolves directly to amber_id
const rnd = () => String(Math.floor(1000000 + Math.random() * 8999999));
const suffix = rnd();

const priors = {
  placesLived: ["Chicago", "Austin"],
  schools: ["University of Chicago", "Stanford"],
  employers: ["Acme", "Globex"],
  travel: ["Tokyo", "Lisbon"],
  socialDynamism: { connectsEasily: 4, connectsAcrossBackgrounds: "high" },
};

try {
  // Synthetic user with a current city + occupation so buildMe has warmth inputs.
  await query(
    `INSERT INTO users (amber_id, phone, status, full_name, username, current_city, occupation, privacy_tier)
     VALUES ($1, $2, 'active', 'Prior Tester', $3, 'Chicago', 'Engineer', 'full_social')`,
    [A, "+1996" + suffix, "prior_" + suffix],
  );

  // ── 1) Upsert the prior fields (profile_extra overflow path) ──
  const after = await upsertProfile(A, { ...priors });
  check("upsertProfile returned a profile", !!after, JSON.stringify(after));

  // ── 2) getProfile round-trips each prior field out of profile_extra ──
  const prof = await getProfile(A);
  check(
    "placesLived round-trips",
    JSON.stringify(prof?.placesLived) === JSON.stringify(priors.placesLived),
    JSON.stringify(prof?.placesLived),
  );
  check(
    "schools round-trips",
    JSON.stringify(prof?.schools) === JSON.stringify(priors.schools),
    JSON.stringify(prof?.schools),
  );
  check(
    "employers round-trips",
    JSON.stringify(prof?.employers) === JSON.stringify(priors.employers),
    JSON.stringify(prof?.employers),
  );
  check(
    "travel round-trips",
    JSON.stringify(prof?.travel) === JSON.stringify(priors.travel),
    JSON.stringify(prof?.travel),
  );
  check(
    "socialDynamism round-trips",
    JSON.stringify(prof?.socialDynamism) === JSON.stringify(priors.socialDynamism),
    JSON.stringify(prof?.socialDynamism),
  );

  // ── 3) Confirm profile_extra is the actual storage (not a column) ──
  const { rows } = await query(`SELECT profile_extra FROM users WHERE amber_id = $1`, [A]);
  const pe = rows[0]?.profile_extra || {};
  check(
    "stored in profile_extra jsonb",
    JSON.stringify(pe.placesLived) === JSON.stringify(priors.placesLived) &&
      JSON.stringify(pe.socialDynamism) === JSON.stringify(priors.socialDynamism),
    JSON.stringify(pe),
  );

  // ── 4) buildMe surfaces cities (from placesLived), schools, employers ──
  const me = buildMe(prof);
  check("buildMe returned a me object", !!me, JSON.stringify(me));
  check(
    "buildMe.cities from placesLived",
    Array.isArray(me?.cities) && priors.placesLived.every((c) => me.cities.includes(c)),
    JSON.stringify(me?.cities),
  );
  check(
    "buildMe.schools present",
    Array.isArray(me?.schools) && priors.schools.every((s) => me.schools.includes(s)),
    JSON.stringify(me?.schools),
  );
  check(
    "buildMe.employers present",
    Array.isArray(me?.employers) && priors.employers.every((e) => me.employers.includes(e)),
    JSON.stringify(me?.employers),
  );
} catch (e) {
  console.log(`❌ unexpected error: ${e?.stack || e?.message || e}`);
  failed = true;
} finally {
  try {
    await query(`DELETE FROM users WHERE amber_id = $1`, [A]);
    console.log("✅ cleanup done");
  } catch (e) {
    console.log(`❌ cleanup failed: ${e?.message || e}`);
    failed = true;
  }
}

console.log(failed ? "\n❌ SMOKE FAILED" : "\n✅ SMOKE PASSED");
process.exit(failed ? 1 : 0);
