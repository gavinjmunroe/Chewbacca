/**
 * DOES UNDO ACTUALLY PUT THINGS BACK? A REAL-DATABASE CHECK.
 *
 * The unit suite cannot answer this. The in-memory SQL fake has no to_jsonb, no
 * jsonb_populate_recordset and no pg_index, so captureMergeSnapshot degrades to a
 * no-op under `npm test` and every undo assertion would pass against nothing.
 * That is the most dangerous shape a test can have: green, and testing air.
 *
 * So this runs against a real database and proves the four things that matter:
 *
 *   1. a merge writes a snapshot, and the merge is reported as undoable
 *   2. the absorbed card comes BACK, live, with its own fields
 *   3. the survivor's overwritten fields are restored to what they were
 *   4. rows created AFTER the merge stay on the survivor and are not lost
 *
 * Point 4 is the one people get wrong. A naive undo clears everything pointing at
 * the survivor and replays the photograph, which silently destroys the note
 * somebody wrote in between.
 *
 * ── IT CLEANS UP AFTER ITSELF ────────────────────────────────────────────────
 *
 * It creates its own throwaway owner and only ever touches rows it created, then
 * hard-deletes them. It never reads, writes or merges anything that was already
 * there, so it is safe against production -- but it does WRITE, so it is a script
 * you run deliberately, not part of `npm test`.
 *
 *   railway run node scripts/merge-undo-smoke.mjs
 */

import { randomUUID } from "node:crypto";
import { query, closePool } from "../src/db/sql.js";

// ── THE GATE ────────────────────────────────────────────────────────────────
//
// This script WRITES, and it DELETEs what it wrote. It only ever touches the
// throwaway owner it creates a moment earlier, so it cannot reach anybody's real
// contacts -- but "cannot" is a claim about code that is one edit away from
// being false, and the database it is pointed at is production.
//
// So it refuses to run without --confirm. scripts/script-hygiene-audit.mjs
// enforces exactly this for anything whose SQL contains a DELETE, which is how
// this requirement got here rather than being remembered.
if (!process.argv.includes("--confirm")) {
  console.error(
    "\n  merge-undo-smoke writes to the database it is pointed at.\n\n" +
      "  It creates a throwaway user and two fake contacts, merges them, undoes\n" +
      "  the merge, checks the result, and hard-deletes everything it made. It\n" +
      "  never touches a row it did not create.\n\n" +
      "  Re-run with --confirm when you mean it:\n\n" +
      "    railway run npm run smoke:merge-undo -- --confirm\n",
  );
  process.exit(2);
}

// Named so the credentials check in script-hygiene-audit.mjs can see that this
// script knows where its authentication comes from: `railway run` injects
// GOOGLE_APPLICATION_CREDENTIALS_JSON along with the AMBER_SQL_* variables, and
// src/db/sql.js turns it into a key file through lib/gcp-credentials.js.
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error(
    "\n  No GCP credentials in the environment. Run this through `railway run`,\n" +
      "  which injects them alongside the AMBER_SQL_* variables.\n",
  );
  process.exit(2);
}
import { mergeContacts } from "../src/db/contact-merge.js";
import { undoContactMerge, listUndoableMerges } from "../src/db/contact-merge-undo.js";

const OWNER = randomUUID();
const PHONE = `+1999${String(Date.now()).slice(-7)}`;
let failures = 0;

function check(label, ok, detail = "") {
  if (ok) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ""}`);
  }
}

async function setup() {
  await query(
    `INSERT INTO users (amber_id, phone) VALUES ($1::uuid, $2)
     ON CONFLICT DO NOTHING`,
    [OWNER, PHONE],
  );
  const mk = async (name, company, phone) => {
    const { rows } = await query(
      `INSERT INTO contacts (owner_id, full_name, company, phone_primary, source, source_tier)
       VALUES ($1::uuid, $2, $3, $4, 'manual', 3) RETURNING id`,
      [OWNER, name, company, phone],
    );
    return String(rows[0].id);
  };
  const keep = await mk("Smoke Keeper", null, "+15550001111");
  const drop = await mk("Smoke Loser", "Absorbed Co", "+15550002222");
  return { keep, drop };
}

async function teardown() {
  // Only ids belonging to the throwaway owner. Ordered so children go first.
  for (const t of ["observations", "contact_sources", "contact_merges", "contact_identity_keys", "contacts"]) {
    await query(`DELETE FROM ${t} WHERE owner_id = $1::uuid`, [OWNER]).catch(() => {});
  }
  await query(`DELETE FROM users WHERE amber_id = $1::uuid`, [OWNER]).catch(() => {});
}

async function main() {
  console.log(`\n  merge-undo smoke — throwaway owner ${OWNER}\n`);
  const { keep, drop } = await setup();

  const res = await mergeContacts(OWNER, keep, drop, { origin: "user", rule: "smoke" });
  check("the merge succeeded", res.ok, JSON.stringify(res));
  check("it reports itself undoable", res.undoable === true && res.mergeId != null,
    `undoable=${res.undoable} mergeId=${res.mergeId}`);

  const { rows: afterMerge } = await query(
    `SELECT id, full_name, company, deleted_at FROM contacts
      WHERE owner_id = $1::uuid ORDER BY full_name`,
    [OWNER],
  );
  const loserGone = afterMerge.find((r) => String(r.id) === drop)?.deleted_at != null;
  const keeperFilled = afterMerge.find((r) => String(r.id) === keep)?.company === "Absorbed Co";
  check("the absorbed card is soft-deleted", loserGone);
  check("the survivor filled its blank company from it", keeperFilled);

  const undoable = await listUndoableMerges(OWNER);
  check("the merge is listed as undoable", undoable.length === 1,
    `got ${undoable.length}`);

  // A note written AFTER the merge. Undo must not take this with it.
  const laterId = randomUUID();
  await query(
    `INSERT INTO observations (observation_id, owner_id, contact_id, body, kind)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'written after the merge', 'note')`,
    [laterId, OWNER, keep],
  ).catch((e) => console.log(`      (skipped post-merge note: ${e.code || e.message})`));

  const undone = await undoContactMerge(OWNER, res.mergeId);
  check("the undo succeeded", undone.ok, JSON.stringify(undone));

  const { rows: afterUndo } = await query(
    `SELECT id, full_name, company, deleted_at FROM contacts
      WHERE owner_id = $1::uuid ORDER BY full_name`,
    [OWNER],
  );
  const loserBack = afterUndo.find((r) => String(r.id) === drop);
  const keeper = afterUndo.find((r) => String(r.id) === keep);
  check("the absorbed card is live again", loserBack && loserBack.deleted_at == null);
  check("it kept its own fields", loserBack?.company === "Absorbed Co",
    `company=${loserBack?.company}`);
  check("the survivor's company is blank again", keeper?.company == null,
    `company=${keeper?.company}`);

  const { rows: survivingNote } = await query(
    `SELECT observation_id FROM observations
      WHERE owner_id = $1::uuid AND observation_id = $2::uuid`,
    [OWNER, laterId],
  );
  check("a note written AFTER the merge survived the undo", survivingNote.length === 1);

  const stillUndoable = await listUndoableMerges(OWNER);
  check("an undone merge is no longer offered", stillUndoable.length === 0,
    `got ${stillUndoable.length}`);

  const second = await undoContactMerge(OWNER, res.mergeId);
  check("undoing twice is refused, not replayed", !second.ok && second.reason === "already_undone",
    JSON.stringify(second));
}

main()
  .catch((e) => {
    failures += 1;
    console.error(`\n  FAILED: ${e?.stack || e?.message || e}`);
  })
  .finally(async () => {
    await teardown();
    await closePool();
    console.log(failures === 0 ? "\n  all checks passed\n" : `\n  ${failures} check(s) failed\n`);
    process.exit(failures === 0 ? 0 : 1);
  });
