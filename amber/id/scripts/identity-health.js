// READ-ONLY identity-health diagnostic.
//
// Confirms (or rules out) the phone-format identity bug: resolveAmberIdByPhone
// (src/db/store.js) matches `WHERE phone = $1` with NO normalization, while a
// normalizePhone() helper exists (src/lib/privy.js). If a user's stored phone
// and their login-token phone differ only by formatting, exact match misses and
// a fresh EMPTY account is minted — so the user sees "no data".
//
// This script imports the REAL normalizePhone so its logic matches production
// exactly, then reports, with NO writes:
//   1. users whose stored phone != its own normalized form (format drift)
//   2. normalized-phone COLLISIONS: one normalized number mapping to >1 amber_id
//      (a split identity — the classic "my data is on the other row" case),
//      with each row's contact count so an empty duplicate is obvious
//   3. active users with 0 contacts (candidate self-healed empty rows)
// Optional arg: a phone to trace — shows exact-match vs normalized-match result
// and the contact count each would land on, demonstrating the bug for a tester.
//
// Run: railway run node scripts/identity-health.js
//      railway run node scripts/identity-health.js "+16305551234"

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-identity-health.json");
  fs.writeFileSync(tmp, credsJson);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { query } = await import("../src/db/sql.js");
const { normalizePhone } = await import("../src/lib/auth-session.js");

const arg = (process.argv[2] || "").trim();

// Contact counts per owner (active contacts only), as a lookup.
async function contactCounts() {
  const { rows } = await query(
    `SELECT owner_id, count(*)::int AS n
       FROM contacts
      WHERE deleted_at IS NULL
      GROUP BY owner_id`,
  );
  const m = new Map();
  for (const r of rows) m.set(String(r.owner_id), r.n);
  return m;
}

async function main() {
  // Full user roster (not soft-deleted). Small enough to normalize in JS so the
  // logic is byte-identical to production's normalizePhone.
  const { rows: users } = await query(
    `SELECT amber_id, phone, status, person_id
       FROM users
      WHERE deleted_at IS NULL`,
  );
  const counts = await contactCounts();
  const nContacts = (amberId) => counts.get(String(amberId)) ?? 0;

  console.log(`total active users: ${users.length}`);

  // ---- Single-phone trace mode -------------------------------------------
  if (arg) {
    const norm = normalizePhone(arg);
    console.log(`\n──── trace "${arg}"  (normalized: ${norm}) ────`);
    const exact = users.filter((u) => u.phone === arg);
    const normed = users.filter((u) => normalizePhone(u.phone) === norm);
    const fmt = (u) => `amber_id=${u.amber_id} phone="${u.phone}" contacts=${nContacts(u.amber_id)} status=${u.status}`;
    console.log(`exact-match rows (what resolveAmberIdByPhone uses): ${exact.length}`);
    for (const u of exact) console.log(`   · ${fmt(u)}`);
    console.log(`normalized-match rows (what it SHOULD match): ${normed.length}`);
    for (const u of normed) console.log(`   · ${fmt(u)}`);
    if (normed.length > exact.length) {
      console.log(`\n⚠️  ${normed.length - exact.length} row(s) would be MISSED by exact match — the bug is live for this number.`);
    }
    process.exit(0);
  }

  // ---- 1. Format drift: stored phone != its normalized form --------------
  const drift = users.filter((u) => u.phone && normalizePhone(u.phone) !== u.phone);
  console.log(`\n1) stored phones not in normalized form: ${drift.length}`);
  for (const u of drift.slice(0, 25)) {
    console.log(`   · "${u.phone}"  →  "${normalizePhone(u.phone)}"   (amber_id=${u.amber_id}, contacts=${nContacts(u.amber_id)})`);
  }
  if (drift.length > 25) console.log(`   … +${drift.length - 25} more`);

  // ---- 2. Normalized collisions: one number, many amber_ids --------------
  const byNorm = new Map();
  for (const u of users) {
    const k = normalizePhone(u.phone);
    if (!k) continue;
    if (!byNorm.has(k)) byNorm.set(k, []);
    byNorm.get(k).push(u);
  }
  const collisions = [...byNorm.entries()].filter(([, rows]) => rows.length > 1);
  console.log(`\n2) normalized-phone collisions (split identities): ${collisions.length}`);
  for (const [norm, rows] of collisions.slice(0, 25)) {
    const parts = rows
      .map((u) => `${u.phone}→${nContacts(u.amber_id)}c`)
      .join("  |  ");
    const withData = rows.filter((u) => nContacts(u.amber_id) > 0).length;
    const empty = rows.length - withData;
    console.log(`   · ${norm}: ${rows.length} rows (${withData} with data, ${empty} empty) — ${parts}`);
  }
  if (collisions.length > 25) console.log(`   … +${collisions.length - 25} more`);

  // ---- 3. Empty active users --------------------------------------------
  const empty = users.filter((u) => u.status === "active" && nContacts(u.amber_id) === 0);
  console.log(`\n3) active users with 0 contacts: ${empty.length} / ${users.length}`);

  console.log(
    `\nread: collisions>0 confirms the phone-format bug is splitting real users; ` +
    `high "format drift" is the mechanism; empty users are the visible "no data" victims.`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(`identity-health failed: ${e?.stack || e?.message || e}`);
  process.exit(1);
});
