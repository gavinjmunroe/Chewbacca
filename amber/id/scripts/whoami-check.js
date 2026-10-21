/**
 * WHY IS THE APP EMPTY? Traces the identity chain the app walks on every request.
 *
 *   railway run node scripts/whoami-check.js
 *   railway run node scripts/whoami-check.js --phone=+13105550100
 *
 * Read-only. No writes, no API calls.
 *
 * THE PROBLEM THIS EXISTS FOR. The pipeline health check proves the DATA is
 * there — 5,249 contacts, 243 facts, 10 users in the live database. An app that
 * shows no name, no contacts and "Try again" on every input is therefore not
 * missing data; it cannot RESOLVE the caller to the owner that holds it. Those
 * are completely different failures and they look identical from the outside.
 *
 * The chain every authenticated request walks:
 *
 *   JWT  ->  phone  ->  resolveAmberIdByPhone()  ->  amber_id  ->  contacts
 *
 * Any link can break silently. A phone stored in a different format than the
 * token presents, a user row the cutover gave a new amber_id while the contacts
 * kept the old one, a soft-deleted user — each yields owner_id = null, and every
 * owner-scoped query then correctly returns nothing.
 *
 * With no --phone it lists every user and what they own, so a mismatch between
 * "the account you log in as" and "the account holding 2,266 contacts" is
 * visible at a glance. Phone numbers are printed as last-4 only.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existing = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existing && fs.existsSync(existing))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-whoami.json");
  fs.writeFileSync(tmp, credsJson, { mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { query, closePool } = await import("../src/db/sql.js");
const { resolveAmberIdByPhone } = await import("../src/db/store.js");
const { normalizePhone } = await import("../src/lib/auth-session.js");

const arg = (name) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : null;
};
const PHONE = arg("phone");
const n = (v) => Number(v ?? 0).toLocaleString();
const last4 = (p) => (typeof p === "string" && p.length >= 4 ? `…${p.slice(-4)}` : "—");

async function all(sql, params = []) {
  const { rows } = await query(sql, params);
  return rows;
}

async function main() {
  // ── WHICH DATABASE. If this is not the database the app is pointed at, nothing
  //    below means anything. The cutover renamed amber -> amber_pre_cutover and
  //    amber_next -> amber, so a stale AMBER_SQL_DB is a live possibility.
  const [{ db, usr }] = await all(
    `SELECT current_database() AS db, current_user AS usr`,
  );
  console.log(`\n  connected to database "${db}" as "${usr}"`);
  console.log(`  AMBER_SQL_DB env = ${process.env.AMBER_SQL_DB ?? "(unset)"}`);
  if (process.env.AMBER_SQL_DB && process.env.AMBER_SQL_DB !== db) {
    console.log(`  !! env says ${process.env.AMBER_SQL_DB} but the connection landed on ${db}`);
  }
  const stale = await all(
    `SELECT datname FROM pg_database WHERE datname LIKE 'amber%' ORDER BY datname`,
  );
  console.log(`  databases present: ${stale.map((r) => r.datname).join(", ")}`);

  // ── EVERY USER AND WHAT THEY OWN. The mismatch, if there is one, shows here.
  console.log("\n  ── users, and what each one owns ────────────────────────────────");
  const users = await all(
    `SELECT u.amber_id, u.phone, u.deleted_at,
            (SELECT count(*)::int FROM contacts c
              WHERE c.owner_id = u.amber_id AND c.deleted_at IS NULL) AS contacts,
            (SELECT count(*)::int FROM observations o
              WHERE o.owner_id = u.amber_id AND o.deleted_at IS NULL) AS facts,
            (SELECT count(*)::int FROM contact_dimension_state s
              WHERE s.owner_id = u.amber_id) AS dim_rows
       FROM users u
      ORDER BY contacts DESC`,
  );
  if (users.length === 0) console.log("    !! NO USER ROWS AT ALL. Nobody can log in.");
  for (const u of users) {
    const flag = u.deleted_at ? "  DELETED" : "";
    console.log(
      `    ${u.amber_id}  phone ${last4(u.phone)}  ` +
        `contacts ${String(n(u.contacts)).padStart(6)}  facts ${String(n(u.facts)).padStart(5)}  ` +
        `dim ${String(n(u.dim_rows)).padStart(4)}${flag}`,
    );
  }

  // ── ORPHANED CONTACTS. owner_ids in contacts with no matching user row would
  //    explain data that exists and is unreachable by anyone.
  const orphans = await all(
    `SELECT c.owner_id, count(*)::int AS contacts
       FROM contacts c
      WHERE c.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM users u WHERE u.amber_id = c.owner_id)
      GROUP BY c.owner_id ORDER BY contacts DESC LIMIT 10`,
  );
  if (orphans.length > 0) {
    console.log("\n  !! CONTACTS OWNED BY AN owner_id WITH NO USER ROW:");
    for (const o of orphans) console.log(`    ${o.owner_id}  ${n(o.contacts)} contact(s)`);
    console.log("    Nobody can authenticate as these owners, so this data is unreachable.");
  }

  // ── THE ACTUAL RESOLUTION, run through the same function the app uses.
  if (PHONE) {
    console.log(`\n  ── resolving ${last4(PHONE)} the way the app does ───────────────`);
    const norm = normalizePhone(PHONE);
    console.log(`    normalizePhone() -> ${last4(norm)}  (raw ${last4(PHONE)})`);
    if (norm !== PHONE) {
      console.log("    NOTE: normalisation changed it. A row stored in the raw form will not match.");
    }
    const direct = await all(`SELECT amber_id, phone, deleted_at FROM users WHERE phone = $1`, [norm]);
    console.log(`    users WHERE phone = normalized: ${direct.length} row(s)`);
    const rawRows = await all(`SELECT amber_id FROM users WHERE phone = $1`, [PHONE]);
    if (rawRows.length > 0 && direct.length === 0) {
      console.log("    !! the row exists under the RAW phone but not the normalized one.");
    }
    const resolved = await resolveAmberIdByPhone(norm).catch((e) => {
      console.log(`    resolveAmberIdByPhone THREW: ${e?.message || e}`);
      return null;
    });
    console.log(`    resolveAmberIdByPhone() -> ${resolved ?? "null  <-- THIS IS THE FAILURE"}`);
    if (resolved) {
      const [own] = await all(
        `SELECT (SELECT count(*)::int FROM contacts WHERE owner_id = $1 AND deleted_at IS NULL) AS contacts,
                (SELECT count(*)::int FROM observations WHERE owner_id = $1 AND deleted_at IS NULL) AS facts`,
        [resolved],
      );
      console.log(`    that owner holds ${n(own.contacts)} contact(s) and ${n(own.facts)} fact(s)`);
      if (own.contacts === 0) {
        console.log("    !! resolves fine but owns nothing — the contacts are under a DIFFERENT owner_id.");
      }
    }
  } else {
    console.log(
      "\n  Pass --phone=+1... (the number you log in with) to trace resolution end to end.",
    );
  }
  console.log("");
}

try {
  await main();
} catch (err) {
  console.error(`  FAILED: ${err?.message || err}`);
  process.exitCode = 1;
} finally {
  await closePool();
}
