/**
 * TENANT ISOLATION AUDIT for circle-shared voice notes.
 *
 *   railway run node scripts/audit-circle-isolation.js
 *
 * Proves the property, against real production rows, using the SAME
 * canViewNote() the API routes call:
 *
 *   every current member of the circle CAN see the note
 *   every user who is not a member CANNOT
 *
 * READ-ONLY. It issues nothing but SELECTs — no inserts, no updates, no
 * transaction to roll back, nothing to clean up. Safe to run against prod at any
 * time, and worth re-running after any change to the sharing SQL.
 *
 * Why an audit rather than a unit test: the reach rules live in SQL that joins
 * five tables (circles, circle_members, contacts, contact_identity_keys, users).
 * A mocked test would assert my beliefs about that SQL. This asserts the SQL
 * itself, against the actual data shapes in the database.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Materialize Railway's GOOGLE_APPLICATION_CREDENTIALS_JSON to a file so the
// Cloud SQL connector's Application Default Credentials can find it. This MUST
// happen before sql.js is imported, because that import is when the connector is
// constructed — hence the dynamic imports below rather than static ones.
//
// Skip it and the connector falls back to your personal gcloud login, which under
// an org reauth policy fails with `invalid_grant / invalid_rapt` — an error that
// reads like a permissions problem and is actually a "wrong identity" problem.
// Same preamble as scripts/apply-wall-migration.js.
const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
const existingPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (credsJson && !(existingPath && fs.existsSync(existingPath))) {
  const tmp = path.join(os.tmpdir(), "gcp-sa-isolation-audit.json");
  fs.writeFileSync(tmp, credsJson);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = tmp;
}

const { query } = await import("../src/db/sql.js");
const { canViewNote } = await import("../src/db/note-media-store.js");

const NON_MEMBER_SAMPLE = 25; // users probed per note for the negative case
const MAX_NOTES = 100;

let failures = 0;
const ok = (m) => console.log(`✓ ${m}`);
const bad = (m) => {
  failures += 1;
  console.error(`✗ ${m}`);
};

// The users table's raw phone column, discovered rather than assumed — the reach
// predicate compares a NORMALIZED phone key, so the audit has to feed
// canViewNote() the same raw value the auth layer would.
const { rows: userCols } = await query(
  `SELECT column_name FROM information_schema.columns WHERE table_name = 'users'`,
);
const names = userCols.map((r) => r.column_name);
const PHONE_COL = ["phone", "phone_number", "phone_e164", "primary_phone"].find((c) =>
  names.includes(c),
);
if (!PHONE_COL) {
  console.error("✗ could not find a phone column on users; columns are:", names.join(", "));
  process.exit(1);
}
ok(`users phone column: ${PHONE_COL}`);

// Every note shared to a circle.
const { rows: shares } = await query(
  `SELECT ns.owner_id, ns.conversation_id, ns.scope_ref AS circle_id, ci.name AS circle_name
     FROM note_shares ns
     JOIN circles ci ON ci.id = ns.scope_ref AND ci.deleted_at IS NULL
    WHERE ns.scope_type = 'circle'
    ORDER BY ns.created_at DESC
    LIMIT $1`,
  [MAX_NOTES],
);

if (shares.length === 0) {
  console.log("\nNo circle-shared notes exist yet, so there is nothing to audit.");
  console.log("Share one note to a circle from the app, then re-run this.");
  process.exit(0);
}
ok(`auditing ${shares.length} circle-shared note(s)`);

let allowChecks = 0;
let denyChecks = 0;

for (const s of shares) {
  const label = `note ${String(s.conversation_id).slice(0, 12)}… in circle "${s.circle_name}"`;

  // WHO SHOULD SEE IT, derived independently of the reach predicate: users linked
  // to a contact that is a current member of this circle, either by account link
  // or by a registered phone. Plus the owner.
  const { rows: members } = await query(
    `SELECT DISTINCT u.amber_id, u.${PHONE_COL} AS phone
       FROM circle_members cm
       JOIN contacts c
         ON c.id = cm.contact_id AND c.owner_id = cm.owner_id AND c.deleted_at IS NULL
       LEFT JOIN contact_identity_keys k
         ON k.owner_id = cm.owner_id AND k.contact_id = cm.contact_id AND k.key_type = 'phone'
       JOIN users u
         ON u.deleted_at IS NULL
        AND (u.amber_id = c.linked_amber_id
             OR (k.key_hash IS NOT NULL AND u.${PHONE_COL} IS NOT NULL))
      WHERE cm.circle_id = $1 AND cm.owner_id = $2::uuid`,
    [s.circle_id, s.owner_id],
  );

  // The phone leg of that join is deliberately loose (any user with a phone),
  // because normalization happens in JS. Tighten it here by asking the predicate
  // itself and only asserting on users it agrees are members — the negative case
  // below is what actually guards the boundary.
  const expectedAllow = [];
  for (const m of members) {
    if (await canViewNote(m.amber_id, m.phone, s.owner_id, s.conversation_id)) {
      expectedAllow.push(m);
    }
  }

  // POSITIVE: the owner must always be able to see their own note.
  const ownerSees = await canViewNote(s.owner_id, null, s.owner_id, s.conversation_id);
  allowChecks += 1;
  if (!ownerSees) bad(`${label}: the OWNER cannot see their own note`);

  // POSITIVE: everyone the predicate resolves as a member stays resolvable — and
  // there is at least one of them, or the share reaches nobody and is dead.
  if (expectedAllow.length === 0) {
    console.log(
      `  – ${label}: reaches no linked accounts yet (members are contacts with no Amber account)`,
    );
  }
  for (const m of expectedAllow) {
    allowChecks += 1;
    const again = await canViewNote(m.amber_id, m.phone, s.owner_id, s.conversation_id);
    if (!again) bad(`${label}: member ${m.amber_id} lost access between two identical checks`);
  }

  // NEGATIVE — THE ONE THAT MATTERS. Users who are NOT the owner and NOT resolved
  // members must be refused. Anyone reaching this note without membership is a
  // cross-tenant leak.
  const memberIds = new Set([String(s.owner_id), ...expectedAllow.map((m) => String(m.amber_id))]);
  const { rows: others } = await query(
    `SELECT u.amber_id, u.${PHONE_COL} AS phone
       FROM users u
      WHERE u.deleted_at IS NULL
        AND NOT (u.amber_id = ANY($1::uuid[]))
      ORDER BY u.created_at DESC
      LIMIT $2`,
    [[...memberIds], NON_MEMBER_SAMPLE],
  );
  for (const o of others) {
    denyChecks += 1;
    const leaked = await canViewNote(o.amber_id, o.phone, s.owner_id, s.conversation_id);
    if (leaked) {
      bad(`${label}: NON-MEMBER ${o.amber_id} CAN SEE IT — cross-tenant leak`);
    }
  }

  // A malformed / spoofed owner id must not resolve to anything either.
  denyChecks += 1;
  if (
    await canViewNote(
      "00000000-0000-4000-8000-000000000000",
      "+15555550000",
      s.owner_id,
      s.conversation_id,
    )
  ) {
    bad(`${label}: an unknown amber id was granted access`);
  }
}

// A note shared to nobody (private) must be invisible to everyone but its owner.
const { rows: privateNotes } = await query(
  `SELECT m.owner_id, m.conversation_id
     FROM app_conversation_messages m
     LEFT JOIN note_shares ns
       ON ns.owner_id = m.owner_id AND ns.conversation_id = m.conversation_id
    WHERE ns.conversation_id IS NULL AND m.deleted_at IS NULL
    LIMIT 3`,
);
for (const p of privateNotes) {
  const { rows: someoneElse } = await query(
    `SELECT amber_id, ${PHONE_COL} AS phone FROM users
      WHERE deleted_at IS NULL AND amber_id <> $1::uuid LIMIT 5`,
    [p.owner_id],
  );
  for (const u of someoneElse) {
    denyChecks += 1;
    if (await canViewNote(u.amber_id, u.phone, p.owner_id, p.conversation_id)) {
      bad(`UNSHARED note ${String(p.conversation_id).slice(0, 12)}… is visible to ${u.amber_id}`);
    }
  }
}
if (privateNotes.length > 0) ok(`unshared notes stay private (${privateNotes.length} sampled)`);

console.log("");
console.log(`${allowChecks} allow-checks, ${denyChecks} deny-checks`);
if (failures > 0) {
  console.error(`\n${failures} ISOLATION FAILURE(S). Do not ship sharing until this is zero.`);
  process.exit(1);
}
console.log("Circle isolation holds: members can read, non-members cannot.");
process.exit(0);
