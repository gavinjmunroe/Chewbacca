/**
 * SMOKE TEST — write-time contact dedup on hashed identity keys.
 *
 * This is the module that stopped one address book going 2,245 -> 4,162 rows
 * across two syncs, and moving it onto hashed keys touched every query in it. The
 * assertions below are the invariants from lib/contact-identity.js, checked
 * against a real Postgres holding the real table:
 *
 *   I1  two records that both carry phones and share none NEVER merge
 *   I2  a phone match with incompatible names does not merge; the pair is
 *       recorded as a same_phone_as review link
 *   claim  one owner, one key, one contact -- and the loser is TOLD who won
 *
 *     SMOKE_DATABASE_URL=postgres://amber:amber@127.0.0.1:5432/scratch \
 *       node scripts/identity-smoke.mjs
 */
process.env.IDENTITY_KEY_PEPPER ||= "smoke-only-pepper-not-a-real-secret-0123456789";

import { pool, query, closePool } from "./smoke-db.mjs";
import { __injectPoolForSmokeTests } from "../src/db/sql.js";
import {
  loadIdentityIndex,
  resolveContactIdentity,
  claimIdentityKeys,
  claimsForRecord,
  repointIdentityKeys,
  identityTablesReady,
} from "../src/db/contact-identity.js";
import { phoneHash, emailHash, identityToken, KEY_TYPE } from "../src/lib/identity-keys.js";
import * as DK from "../src/db/discovery-store.js";

__injectPoolForSmokeTests(pool);

let pass = 0, fail = 0;
const ok = (c, m, d = "") => {
  if (c) { pass++; console.log("  ✓ " + m); }
  else { fail++; console.log("  ✗ " + m + (d ? "   " + d : "")); }
};

const K = "aaaaaaaa-0000-4000-8000-000000000001";
const C_MAGGIE = "11111111-0000-4000-8000-00000000000a";
const C_MOM    = "11111111-0000-4000-8000-00000000000b";
const C_DAD    = "11111111-0000-4000-8000-00000000000c";
const C_DUPE   = "11111111-0000-4000-8000-00000000000d";

await query(`TRUNCATE contact_review_candidates, contact_identity_keys, discovery_keys,
             contacts, users RESTART IDENTITY CASCADE`);
await query(`INSERT INTO users (amber_id, phone, full_name) VALUES ($1,'+14150000001','Karthik')`, [K]);
await query(
  `INSERT INTO contacts (id, owner_id, full_name, phone_primary, phones_all, emails, source, external_id)
   VALUES ($1,$5,'Maggie Chen','+1 415 555 0100','+1 415 555 0100','maggie@example.com','google','people/c1'),
          ($2,$5,'Mom','+1 415 555 0200','+1 415 555 0200',NULL,'apple','ab-mom'),
          ($3,$5,'Dad','+1 415 555 0200','+1 415 555 0200',NULL,'apple','ab-dad'),
          ($4,$5,'Maggie Chen','+1 415 555 0100','+1 415 555 0100',NULL,'apple','ab-maggie')`,
  [C_MAGGIE, C_MOM, C_DAD, C_DUPE, K],
);

console.log("\n── the table is there ──");
ok(identityTablesReady() === true, "degraded mode is not latched");

console.log("\n── claiming ──");
const claimed = await claimIdentityKeys(K, claimsForRecord(C_MAGGIE, {
  full_name: "Maggie Chen", phone_primary: "+1 415 555 0100",
  emails: "maggie@example.com", source: "google", external_id: "people/c1",
}));
ok(claimed.claimed === 3, "phone + email + source all claim, as three keys", JSON.stringify(claimed.claimed));
ok(claimed.conflicts.length === 0, "nothing conflicts on a first claim");

const stored = await query(
  `SELECT key_type, key_hash FROM contact_identity_keys WHERE owner_id=$1 ORDER BY key_type`, [K]);
ok(stored.rows.length === 3 && stored.rows.every((r) => r.key_hash.length === 16),
   "three rows, every hash exactly 16 bytes");
ok(stored.rows.map((r) => r.key_type).join(",") === "1,2,3", "phone=1 email=2 source=3",
   stored.rows.map((r) => r.key_type).join(","));
ok(stored.rows[0].key_hash.equals(phoneHash("4155550100")),
   "the stored phone hash is the one the tokenizer produces");
const raw = await query(
  `SELECT count(*)::int n FROM contact_identity_keys
    WHERE encode(key_hash,'escape') LIKE '%4155550100%'`, [] );
ok(raw.rows[0].n === 0, "and the number itself appears NOWHERE in the table");

console.log("\n── one owner, one key, one contact ──");
const second = await claimIdentityKeys(K, claimsForRecord(C_DUPE, {
  full_name: "Maggie Chen", phone_primary: "+1 (415) 555-0100", source: "apple", external_id: "ab-maggie",
}));
ok(second.claimed === 1, "only the new source key claims; the phone is taken", String(second.claimed));
ok(second.conflicts.length === 1, "the loss is REPORTED, not swallowed", JSON.stringify(second.conflicts));
ok(second.conflicts[0].winnerContactId === C_MAGGIE, "and it names the winner");
// "14155550100", not "4155550100": phoneKey keeps the country code now, because
// throwing it away made a French and a US number the same person.
ok(second.conflicts[0].keyValue === "14155550100",
   "the conflict is readable -- plaintext survives in memory, never on disk",
   JSON.stringify(second.conflicts[0]));

console.log("\n── the index resolves through hashes ──");
const { index } = await loadIdentityIndex(K, { fresh: true });
ok(index.keyOf === identityToken, "the index carries the tokenizer it was built with");
ok(index.byKey.has(identityToken("phone", "14155550100")), "a stored key is findable by token");

const r1 = await resolveContactIdentity(K, {
  full_name: "Maggie Chen", phone_primary: "+1-415-555-0100",
}, { index });
ok(r1.contactId === C_MAGGIE && r1.rule === "phone",
   "a re-sync of Maggie resolves to the SAME row, by phone", JSON.stringify([r1.contactId, r1.rule]));

const r2 = await resolveContactIdentity(K, {
  full_name: "Maggie Chen", emails: "maggie@example.com",
}, { index });
ok(r2.contactId === C_MAGGIE && r2.rule === "email", "and by email", r2.rule);

const r3 = await resolveContactIdentity(K, {
  full_name: "Someone Else", phone_primary: "+1 415 555 9999",
}, { index });
ok(r3.contactId === null && r3.action === "insert", "an unknown person is an insert, not a merge");

console.log("\n── I1: shared no phone, never merge ──");
const i1 = await resolveContactIdentity(K, {
  full_name: "Maggie Chen", phone_primary: "+1 415 555 7777",
}, { index });
ok(i1.contactId === null,
   "a different Maggie Chen with a different number stays a different person",
   JSON.stringify([i1.contactId, i1.rule]));

console.log("\n── I2: the household line ──");
const i2 = await resolveContactIdentity(K, {
  full_name: "Dad", phone_primary: "+1 415 555 0200",
}, { index });
ok(i2.contactId === C_DAD, "Dad resolves to Dad on the shared line", String(i2.contactId));
const i2b = await resolveContactIdentity(K, {
  full_name: "Grandma", phone_primary: "+1 415 555 0200",
}, { index });
ok(i2b.contactId === null && i2b.reviewLinks.length > 0,
   "a third name on the same line does not merge, and the pair is logged for review",
   JSON.stringify([i2b.contactId, i2b.reviewLinks.length]));
ok(i2b.reviewLinks.every((l) => l.reason === "same_phone_as"), "logged with the right reason");

console.log("\n── repointing on a merge ──");
await claimIdentityKeys(K, claimsForRecord(C_MOM, {
  full_name: "Mom", phone_primary: "+1 415 555 0200", source: "apple", external_id: "ab-mom",
}));
const before = await query(
  `SELECT count(*)::int n FROM contact_identity_keys WHERE owner_id=$1 AND contact_id=$2`, [K, C_MOM]);
ok(before.rows[0].n > 0, "Mom holds keys before the merge");
const moved = await repointIdentityKeys(K, C_DAD, [C_MOM]);
ok(moved.repointed.length + moved.dropped.length === before.rows[0].n,
   "every one of Mom's keys is accounted for -- moved or dropped",
   JSON.stringify([moved.repointed.length, moved.dropped.length, before.rows[0].n]));
ok(moved.repointed.every((r) => typeof r.keyType === "string" && r.keyHash.length === 32),
   "the manifest names the key KIND and its hash, because the value was never stored",
   JSON.stringify(moved.repointed[0]));
const after = await query(
  `SELECT count(*)::int n FROM contact_identity_keys WHERE owner_id=$1 AND contact_id=$2`, [K, C_MOM]);
ok(after.rows[0].n === 0, "and Mom holds none afterwards");
const dupCheck = await query(
  `SELECT key_type, key_hash, count(*)::int n FROM contact_identity_keys
    WHERE owner_id=$1 GROUP BY 1,2 HAVING count(*) > 1`, [K]);
ok(dupCheck.rows.length === 0, "the primary key held: no key is claimed twice");

console.log("\n── the signup sweep is an index lookup, not a scan ──");
const plan = await query(
  `EXPLAIN (FORMAT JSON)
   UPDATE contacts c SET linked_amber_id = $1
    WHERE c.deleted_at IS NULL AND c.owner_id <> $1
      AND EXISTS (SELECT 1 FROM contact_identity_keys k
                   WHERE k.owner_id = c.owner_id AND k.contact_id = c.id
                     AND k.key_type = 1 AND k.key_hash = $2)`,
  [K, phoneHash("4155550100")],
);
const planText = JSON.stringify(plan.rows[0]["QUERY PLAN"]);
ok(planText.includes("cik_hash_idx") || planText.includes("Index"),
   "the planner reaches for an index on contact_identity_keys", planText.slice(0, 160));


// ── A SIGNUP MUST NOT BE ABLE TO TAKE SOMEBODY ELSE'S IDENTITY ───────────────
// discovery_keys is PRIMARY KEY (key_hash) and setDiscoveryKeys used to say
// ON CONFLICT DO UPDATE SET amber_id, so the second account to claim a hash took
// it from the first. With phoneKey normalizing to the last ten digits, two real
// numbers collide -- and the displaced user silently stops being findable, loses
// the circles they were in, and stops seeing notes shared to them.
console.log("\n── discovery keys: first claim wins ──");
const A_ID = "aaaaaaaa-0000-4000-8000-0000000dd001";
const B_ID = "aaaaaaaa-0000-4000-8000-0000000dd002";
const A_PHONE = "+33612345678";   // French 06
const B_PHONE = "+13612345678";   // US area code 361 — same last ten digits
await query(`INSERT INTO users (amber_id, phone, full_name) VALUES ($1,$3,'A'),($2,$4,'B')`,
            [A_ID, B_ID, A_PHONE, B_PHONE]);

const dkFirst = await DK.setDiscoveryKeys(A_ID, { phones: [A_PHONE] });
ok(dkFirst.held === 1 && dkFirst.conflicts.length === 0,
   "the first account claims its key cleanly", JSON.stringify(dkFirst));

// A GENUINELY DUPLICATE CLAIM, which is the case that survives good
// normalization: the same number, claimed by a second account. A recycled
// number, or somebody trying to take one.
const dkSecond = await DK.setDiscoveryKeys(B_ID, { phones: [A_PHONE] });
ok(dkSecond.conflicts.length === 1,
   "a second account claiming the SAME number is REFUSED and told which key",
   JSON.stringify(dkSecond));
ok(dkSecond.held === 0, "and holds nothing as a result", String(dkSecond.held));

// And B's own number is a different key, so it claims that cleanly.
const dkOwn = await DK.setDiscoveryKeys(B_ID, { phones: [B_PHONE] });
ok(dkOwn.held === 1 && dkOwn.conflicts.length === 0,
   "while its own number, which used to collide with A's, claims normally",
   JSON.stringify(dkOwn));

const stillA = await query(
  `SELECT amber_id FROM discovery_keys WHERE key_hash = $1`, [phoneHash(A_PHONE)]);
ok(stillA.rows[0]?.amber_id === A_ID,
   "the key still belongs to the account that claimed it first",
   JSON.stringify(stillA.rows[0]));

const dkRepeat = await DK.setDiscoveryKeys(A_ID, { phones: [A_PHONE] });
ok(dkRepeat.held === 1 && dkRepeat.conflicts.length === 0,
   "re-claiming your own key is not a conflict — the call stays idempotent",
   JSON.stringify(dkRepeat));

// A recycled number is a real thing, and it now needs somebody to mean it.
console.log("\n── and a real transfer is deliberate and written down ──");
const dkMoved = await DK.reassignDiscoveryKey(B_ID, KEY_TYPE.PHONE, phoneHash(A_PHONE),
                                            { actorAmberId: A_ID, reason: "smoke" });
ok(dkMoved === true, "reassignDiscoveryKey moves it");
const nowB = await query(
  `SELECT amber_id FROM discovery_keys WHERE key_hash = $1`, [phoneHash(A_PHONE)]);
ok(nowB.rows[0]?.amber_id === B_ID, "to the new holder");
const dkAudit = await query(
  `SELECT action, detail FROM audit_log WHERE action = 'discovery_key.reassign'`);
ok(dkAudit.rows.length === 1, "and leaves exactly one audit row");
ok(dkAudit.rows[0]?.detail?.from === A_ID && dkAudit.rows[0]?.detail?.to === B_ID,
   "naming who lost it and who gained it", JSON.stringify(dkAudit.rows[0]?.detail));
ok(!JSON.stringify(dkAudit.rows[0]?.detail).includes(A_PHONE.replace(/\D/g, "")),
   "and NOT the phone number — an audit row holding it would undo the hashing");

// The collision itself is still open, and this is the assertion that will change
// when phoneKey moves to E.164. Reported, not silently tolerated.
// THE COLLISION ITSELF. phoneKey now keeps the country code, so these two real
// numbers are two different keys. Before, they were one, and the whole
// first-claim-wins mechanism above was papering over that.
console.log("\n── and the numbers no longer collide ──");
ok(!phoneHash(A_PHONE).equals(phoneHash(B_PHONE)),
   "a French 06 number and a US 361 number hash differently",
   JSON.stringify({ a: phoneHash(A_PHONE).toString("hex").slice(0, 12),
                    b: phoneHash(B_PHONE).toString("hex").slice(0, 12) }));
ok(phoneHash("+13105550100").equals(phoneHash("3105550100")) &&
   phoneHash("3105550100").equals(phoneHash("13105550100")),
   "while the three ways of writing one US number are still one key");

console.log(`\n  ${pass} passed, ${fail} failed\n`);
await closePool();
process.exit(fail ? 1 : 0);
