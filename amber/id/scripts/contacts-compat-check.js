/**
 * Contact-sync check: payload compatibility + write-path cost.
 *
 * Runs the real POST /v1/me/contacts normalization (normalizeIncomingContact)
 * into the real upsertContactsForOwner, with src/db/sql.js swapped for the
 * in-memory fake (src/db/sql-fake-harness.js) — no Cloud SQL credentials
 * needed, and every statement is recorded.
 *
 * Proves:
 *   A. an OLD device-shape contact ({ id, phones, organization }) persists
 *      external_id / phone_primary / company (all three were NULL before the
 *      normalizer landed)
 *   B. a 1,000-contact sync issues a small bounded number of statements — with
 *      the pre-batch per-contact loop replayed as the baseline for comparison
 *   C. re-syncing the same 1,000 contacts updates in place: same row count,
 *      same row ids, no duplicates
 *
 * Run with:  node scripts/contacts-compat-check.js
 */

import assert from "node:assert/strict";

import { installFakeSql } from "../src/db/sql-fake-harness.js";

const sql = await installFakeSql();
const { normalizeIncomingContact } = await import("../src/routes/profile.js");
const { upsertContactsForOwner } = await import("../src/db/store.js");

const OWNER = "amber_test_owner";
const OWNER_PHONE = "+13105559999";

const sync = (contacts) =>
  upsertContactsForOwner({ ownerId: OWNER, ownerPhone: OWNER_PHONE, contacts });

// ── A. old device shape still lands the columns that used to come out NULL ────

const OLD_DEVICE_SHAPE = {
  id: "ABCD-1234-EFGH",
  name: "Maggie Smith",
  phones: ["+13105550100", "+13105550101"],
  organization: "Acme Corp",
};

sql.resetFakeSql();
const valid = [OLD_DEVICE_SHAPE, { name: "No Phone Nancy" }, { id: "no-name" }]
  .map(normalizeIncomingContact)
  .filter(Boolean);
assert.equal(valid.length, 2, "name-only contact must survive, nameless must not");

const a = await sync(valid);
// The return shape gained dedup counters (inserted/merged/updated/deduped/
// reviewLinked); the two fields the route reads are asserted exactly.
assert.equal(a.upserted, 2);
assert.equal(a.failed, 0);

// Column order: owner_id, owner_phone, external_id, full_name, first_name,
// last_name, phone_primary, phones_all, emails, company, source,
// phone_primary_normalized
const maggie = sql.state.contacts.get(`${OWNER}|ABCD-1234-EFGH`)?.row;
assert.ok(maggie, "Maggie Smith was not written");
console.log("A. device-shape row:", JSON.stringify(maggie));
assert.equal(maggie[2], "ABCD-1234-EFGH", "external_id must come from device `id`");
assert.equal(maggie[6], "+13105550100", "phone_primary must come from device `phones[0]`");
assert.equal(maggie[7], "+13105550100, +13105550101", "phones_all must carry every phone");
assert.equal(maggie[9], "Acme Corp", "company must come from device `organization`");
assert.equal(maggie[10], "apple", "source must default to apple");
assert.equal(maggie[11], "13105550100", "phone_primary_normalized must be derived");
// Both rows get provenance now: the name-only contact carries a SYNTHESIZED
// external_id (see synthesizeExternalId), so it is no longer id-less. This
// assertion said 1 and had been failing on main since that change landed.
assert.equal(sql.state.contactSources.size, 2, "provenance rows must be written");

// Name-only contact still lands, keyed by its synthesized id.
assert.equal(sql.state.contactsNoExternalId.length, 0, "synthesized id → keyed row");
assert.equal(sql.state.contacts.size, 2, "name-only contact must upsert");

// Control: the same payload WITHOUT normalization — the pre-normalizer path,
// where external_id / phone_primary / company all came out NULL.
sql.resetFakeSql();
await sync([{ ...OLD_DEVICE_SHAPE, source: "apple" }]);
const unnormalized = sql.state.contactsNoExternalId[0];
console.log("A. same payload un-normalized:", JSON.stringify(unnormalized));
assert.equal(sql.state.contacts.size, 0, "no external_id was resolvable before the fix");
// Rows are reported in the 12-column upsert order (one INSERT shape now).
assert.equal(unnormalized[6], null, "phone_primary was NULL before the fix");
assert.equal(unnormalized[9], null, "company was NULL before the fix");

// ── B. write-path cost: pre-batch baseline vs batched ────────────────────────

const N = 1000;
const bulk = Array.from({ length: N }, (_, i) =>
  normalizeIncomingContact({
    id: `ext-${i}`,
    name: `Person ${i}`,
    phones: [`+1310555${String(i).padStart(4, "0")}`],
    emails: [`person${i}@example.com`],
    organization: "Acme Corp",
  }),
);

/**
 * The pre-batch write path, replayed verbatim in shape: one awaited upsert per
 * contact plus one awaited provenance upsert. Frozen here purely as the
 * baseline the batched path is measured against — it is NOT the production
 * path (see upsertContactsForOwner in src/db/store.js).
 */
async function baselinePerContactLoop(contacts) {
  for (const contact of contacts) {
    const phonePrimary = contact.phoneNumbers?.[0] ?? null;
    const { rows } = await sql.query(
      `INSERT INTO contacts
         (owner_id, owner_phone, external_id, full_name, first_name, last_name,
          phone_primary, phones_all, emails, company, source,
          phone_primary_normalized)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (owner_id, external_id)
         WHERE external_id IS NOT NULL AND deleted_at IS NULL
       DO UPDATE SET full_name = EXCLUDED.full_name
       RETURNING id, external_id`,
      [
        OWNER, OWNER_PHONE, contact.externalId,
        contact.name, contact.firstName ?? null, contact.lastName ?? null,
        phonePrimary, (contact.phoneNumbers || []).join(", ") || null,
        (contact.emails || []).join(", ") || null,
        contact.company ?? null, contact.source ?? "apple",
        phonePrimary ? phonePrimary.replace(/\D/g, "") : null,
      ],
    );
    if (rows[0]?.id) {
      await sql.query(
        `INSERT INTO contact_sources
           (owner_id, contact_id, source, external_id, raw_full_name, raw_emails, raw_phones, raw_company, raw)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
         ON CONFLICT (owner_id, source, external_id) WHERE deleted_at IS NULL
         DO UPDATE SET contact_id = EXCLUDED.contact_id`,
        [
          OWNER, rows[0].id, contact.source ?? "apple", contact.externalId,
          contact.name, (contact.emails || []).join(", ") || null,
          (contact.phoneNumbers || []).join(", ") || null,
          contact.company ?? null, JSON.stringify(contact),
        ],
      );
    }
  }
}

sql.resetFakeSql();
await baselinePerContactLoop(bulk);
const before = sql.statementCalls().length;
assert.equal(sql.state.contacts.size, N);

sql.resetFakeSql();
const b = await sync(bulk);
const afterStatements = sql.statementCalls();
const after = afterStatements.length;
const transactions = sql.state.calls.filter((c) => c.text === "BEGIN").length;
const commits = sql.state.calls.filter((c) => c.text === "COMMIT").length;

assert.equal(b.upserted, N);
assert.equal(b.failed, 0);
assert.equal(sql.state.contacts.size, N, "every contact must be written");
assert.equal(sql.state.contactSources.size, N, "every provenance row must be written");
for (const { row } of sql.state.contacts.values()) {
  assert.equal(row[0], OWNER, "every row must carry owner_id");
}
// Budget covers the 2-query index load and the batched identity-key claims on
// top of the insert + provenance chunks. Still O(n / 500), not O(n).
assert.ok(after <= 14, `expected a bounded statement count, got ${after}`);
assert.equal(commits, transactions, "every chunk must commit");

console.log(
  `\nB. ${N} contacts — statements BEFORE (per-contact loop): ${before}` +
    `   AFTER (batched): ${after}` +
    `   (${(before / after).toFixed(0)}× fewer round-trips, ${transactions} transactions, ${commits} commits)`,
);

// ── C. re-sync is idempotent: update in place, no duplicate rows ─────────────

const idsAfterFirst = new Map([...sql.state.contacts.entries()].map(([k, v]) => [k, v.id]));
const c = await sync(bulk);
const afterSecond = sql.statementCalls().length - after;

assert.equal(c.upserted, N);
assert.equal(c.failed, 0);
assert.equal(c.inserted, 0, "re-sync inserts nothing");
assert.equal(c.updated, N, "every row resolved on its own source key");
assert.equal(sql.state.contacts.size, N, "re-sync must not add rows");
assert.equal(sql.state.contactSources.size, N, "re-sync must not add provenance rows");
assert.equal(sql.state.contactsNoExternalId.length, 0);
for (const [key, { id }] of sql.state.contacts.entries()) {
  assert.equal(id, idsAfterFirst.get(key), `row ${key} was replaced instead of updated`);
}
for (const call of afterStatements) {
  if (!/INSERT INTO contacts\b/.test(call.text)) continue;
  assert.match(call.text, /ON CONFLICT \(owner_id, external_id\)/);
  assert.match(call.text, /DO UPDATE SET/);
}

console.log(
  `C. re-sync of the same ${N}: ${afterSecond} statements, rows ${sql.state.contacts.size} ` +
    `(unchanged), all ${N} ids stable → updated in place`,
);

console.log(
  "\nPASS — device shape persists external_id + phone_primary; " +
    `${N}-contact sync costs ${after} statements instead of ${before}; re-sync is idempotent.`,
);
