// Throwaway READ-ONLY smoke test: proves resolveContactAmberUser resolves a
// phone to an Amber user + connection status, and never matches the caller
// themselves. No writes, no cleanup.
//
// Run: railway run node scripts/smoke-connect-resolve.js   — safe to delete after.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Materialize the service-account JSON to a temp file BEFORE importing anything
// that touches db/sql.js (mirrors the phase smoke scripts).
const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-smoke-connect.json");
  fs.writeFileSync(tmp, credsJson);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { query } = await import("../src/db/sql.js");
const { resolveContactAmberUser } = await import("../src/db/connections-store.js");

const ALLOWED_STATUS = ["connected", "pending_out", "pending_in", "none"];

let failed = false;
function check(label, cond, detail) {
  if (cond) {
    console.log(`✅ ${label}`);
  } else {
    console.log(`❌ ${label}${detail ? ` — ${detail}` : ""}`);
    failed = true;
  }
}

try {
  // Two distinct, non-deleted users that both have a phone (B needs one to be
  // resolvable; A needs one so the self-exclusion test is genuine).
  const { rows } = await query(
    `SELECT amber_id, phone FROM users
      WHERE phone IS NOT NULL AND deleted_at IS NULL
      LIMIT 2`,
  );
  if (rows.length < 2) {
    console.log(`⏭️  SKIP: need 2 users with a phone, found ${rows.length}`);
    process.exit(0);
  }
  const A = { amberId: String(rows[0].amber_id), phone: rows[0].phone };
  const B = { amberId: String(rows[1].amber_id), phone: rows[1].phone };
  console.log(`   A=${A.amberId}  B=${B.amberId} (phone ${B.phone})`);

  // 1) A resolves B by B's phone → B's amber_id + an allowed status.
  const hit = await resolveContactAmberUser(A.amberId, [B.phone]);
  check(
    "resolve B by phone returns B's amber_id",
    hit && hit.amberId === B.amberId,
    `got ${JSON.stringify(hit)}`,
  );
  check(
    "status is in the allowed set",
    hit && ALLOWED_STATUS.includes(hit.status),
    `status=${hit?.status}`,
  );

  // 2) A resolving their OWN phone → null (never matches self).
  const self = await resolveContactAmberUser(A.amberId, [A.phone]);
  check("resolving own phone returns null (self excluded)", self === null, `got ${JSON.stringify(self)}`);
} catch (e) {
  console.log(`❌ unexpected error: ${e?.stack || e?.message || e}`);
  failed = true;
}

console.log(failed ? "\n❌ SMOKE FAILED" : "\n✅ SMOKE PASSED");
process.exit(failed ? 1 : 0);
