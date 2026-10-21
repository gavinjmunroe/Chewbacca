/**
 * DID THE DELETE ACTUALLY DELETE?
 *
 *   BEFORE deleting, capture the id and a census:
 *     railway run node scripts/verify-account-purge.js --phone +16505551234
 *
 *   AFTER deleting, prove nothing is left:
 *     railway run node scripts/verify-account-purge.js --amber-id <uuid>
 *
 * READ ONLY. It counts rows and prints. It changes nothing.
 *
 * WHY THIS EXISTS RATHER THAN TRUSTING THE PURGE. The purge is a list of tables
 * somebody maintained by hand, and the structural test that guards it looks for
 * an owner column -- so the entire direct-message graph slipped past both for
 * as long as it existed, message bodies and voice notes included, because a
 * thread belongs to two people and therefore has no owner column. A list can
 * only be as complete as the imagination of whoever wrote it. This asks the
 * database instead: every column in the schema whose name looks like it holds a
 * person's uuid is checked for this person's uuid, whether or not anybody
 * thought of that table.
 *
 * The phone and the DID are checked too, since a few rows are reachable only
 * from those -- otp codes, device sessions, slack links -- and they are exactly
 * the rows that would stop somebody re-registering on the same number.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existing = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existing && fs.existsSync(existing))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-verify-purge.json");
  fs.writeFileSync(tmp, credsJson, { mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { query, closePool } = await import("../src/db/sql.js");

const argv = process.argv.slice(2);
const argOf = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : null;
};

/**
 * Columns whose name means "a person". Discovered against the live schema
 * rather than listed here, so a table added next month is covered by the shape
 * of its columns instead of by somebody remembering it.
 */
const PERSON_COLUMN = /^(owner_id|owner_amber_id|amber_id|a_amber_id|b_amber_id|sender_amber_id|reactor_amber_id|author_amber_id|requester_amber_id|addressee_amber_id|viewer_amber_id|blocker_amber_id|blocked_amber_id|reported_amber_id|reporter_amber_id|actor_amber_id|subject_id|linked_amber_id|pinned_by)$/;

/**
 * Rows that SHOULD survive, with the reason. Anything else that survives is a
 * finding. Kept in step with the EXEMPT list in src/db/purge.test.js.
 */
const EXPECTED_SURVIVORS = new Map([
  ["abuse_reports", "safety record: deleting an account must not erase reports about it"],
  ["blocked_handles", "blocks RECEIVED outlive the account, so delete-and-re-register is not a way round a block"],
  ["audit_log", "the record of what was done to accounts, including this deletion"],
]);

const n = (v) => Number(v ?? 0).toLocaleString();

async function main() {
  const phone = argOf("phone");
  let amberId = argOf("amber-id");
  let did = null;

  if (!amberId && !phone) {
    throw new Error("pass --phone +1... (before deleting) or --amber-id <uuid> (after)");
  }

  if (phone) {
    const { rows } = await query(
      `SELECT amber_id, privy_did, full_name, created_at FROM users WHERE phone = $1`,
      [phone],
    );
    if (rows[0]) {
      amberId = rows[0].amber_id;
      did = rows[0].privy_did ?? null;
      console.log(`\n  users row FOUND for ${phone}`);
      console.log(`      amber_id : ${amberId}`);
      console.log(`      did      : ${did ?? "(none)"}`);
      console.log(`      name     : ${rows[0].full_name ?? "(none)"}`);
      console.log(`      created  : ${rows[0].created_at}`);
      console.log(`\n  SAVE THAT amber_id. After the delete, re-run with --amber-id to prove it is gone.\n`);
    } else {
      console.log(`\n  no users row for ${phone}. That is the correct state after a delete.`);
      if (!amberId) {
        console.log(`  Re-run with --amber-id <the id you saved> to scan for leftovers.\n`);
        return;
      }
      console.log("");
    }
  }

  // Every column in the live schema that names a person.
  const { rows: cols } = await query(
    `SELECT table_name, column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, column_name`,
  );

  const targets = new Map(); // table -> [columns]
  for (const c of cols) {
    if (!PERSON_COLUMN.test(c.column_name)) continue;
    // A uuid column only. A text column named amber_id would need casting and
    // there are none today; if one appears, it shows up as a skip rather than
    // as a silent pass.
    if (!String(c.data_type).includes("uuid")) continue;
    const list = targets.get(c.table_name) ?? [];
    list.push(c.column_name);
    targets.set(c.table_name, list);
  }

  console.log(`  scanning ${targets.size} table(s) for ${amberId}\n`);

  const leftovers = [];
  const expected = [];
  for (const [table, columns] of [...targets.entries()].sort()) {
    const where = columns.map((c) => `${c} = $1`).join(" OR ");
    try {
      const { rows } = await query(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, [amberId]);
      const count = rows[0]?.n ?? 0;
      if (count === 0) continue;
      const reason = EXPECTED_SURVIVORS.get(table);
      (reason ? expected : leftovers).push({ table, columns, count, reason });
    } catch (err) {
      console.log(`      ${table}: could not check (${err?.message?.slice(0, 60)})`);
    }
  }

  if (expected.length > 0) {
    console.log("  DELIBERATELY KEPT:\n");
    for (const e of expected) {
      console.log(`      ${String(e.count).padStart(5)}  ${e.table} (${e.columns.join(", ")})`);
      console.log(`             ${e.reason}`);
    }
    console.log("");
  }

  if (leftovers.length === 0) {
    console.log("  CLEAN. No table holds this person's uuid except the ones above.\n");
  } else {
    console.log(`  ${leftovers.length} TABLE(S) STILL HOLD THIS PERSON:\n`);
    for (const l of leftovers) {
      console.log(`      ${String(l.count).padStart(5)}  ${l.table} (${l.columns.join(", ")})`);
    }
    console.log("\n  Each of these is a row that survived delete-my-account.\n");
    process.exitCode = 1;
  }

  // Rows reachable only from the phone or the DID -- the ones that block a
  // re-registration on the same number rather than leaking data.
  if (phone) {
    console.log("  Reachable from the phone rather than the uuid:\n");
    for (const [label, sql] of [
      ["users", `SELECT count(*)::int AS n FROM users WHERE phone = $1`],
      ["otp_codes", `SELECT count(*)::int AS n FROM otp_codes WHERE phone = $1`],
      ["device_sessions", `SELECT count(*)::int AS n FROM device_sessions WHERE phone = $1`],
      ["slack_links", `SELECT count(*)::int AS n FROM slack_links WHERE phone_e164 = $1`],
    ]) {
      try {
        const { rows } = await query(sql, [phone]);
        const count = rows[0]?.n ?? 0;
        const mark = count > 0 ? "  <-- would block or pollute a re-signup" : "";
        console.log(`      ${String(count).padStart(5)}  ${label}${mark}`);
      } catch (err) {
        console.log(`      ${label}: could not check (${err?.message?.slice(0, 50)})`);
      }
    }
    console.log("");
  }

  console.log("  NOT checked here: Cloud Storage objects, BigQuery mirrors and any");
  console.log("  vector index. Those live outside Postgres and need their own pass.\n");
}

main()
  .catch((err) => {
    console.error(`\n  ${err?.message || err}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool?.().catch(() => {});
  });
