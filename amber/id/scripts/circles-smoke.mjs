/**
 * SMOKE TEST — inbound circle membership, which is an authorization boundary.
 *
 *     SMOKE_DATABASE_URL=postgres://postgres@127.0.0.1:5432/scratch \
 *       node scripts/circles-smoke.mjs
 *
 * Three functions in circles-store.js share one predicate that answers "is this
 * viewer a member of someone else's circle". It had two faults at once, and the
 * combination is why neither was noticed:
 *
 *   it referenced contact_identity_keys.key_value, a column dropped in migration
 *   003, so every one of those queries THREW -- and every function catches and
 *   returns [] / null / 0, so the symptom was circles being empty rather than an
 *   error anybody could see. This file's first assertion is that a member can see
 *   the circle at all, because that is the assertion that was failing silently.
 *
 *   it took the viewer's phone as a bind parameter and compared the last ten
 *   digits of it, so +33612345678 and +13612345678 -- both allocatable numbers --
 *   were the same person, and a caller who passed a client-supplied number would
 *   have handed over somebody else's circle.
 *
 * So the tests here are about who can and cannot reach a circle, not about the
 * shape of the rows.
 */
process.env.IDENTITY_KEY_PEPPER ||= "smoke-only-pepper-not-a-real-secret-0123456789";

import { pool, query, closePool } from "./smoke-db.mjs";
import { __injectPoolForSmokeTests } from "../src/db/sql.js";
import * as C from "../src/db/circles-store.js";
import * as D from "../src/db/discovery-store.js";
import { KEY_TYPE, phoneHash } from "../src/lib/identity-keys.js";

__injectPoolForSmokeTests(pool);

let pass = 0, fail = 0;
const ok = (c, m, d = "") => {
  if (c) { pass++; console.log("  ✓ " + m); }
  else { fail++; console.log("  ✗ " + m + (d ? "   " + d : "")); }
};

const OWNER   = "aaaaaaaa-0000-4000-8000-00000000c001"; // owns the circle
const MEMBER  = "aaaaaaaa-0000-4000-8000-00000000c002"; // in it, by phone key
const LINKED  = "aaaaaaaa-0000-4000-8000-00000000c003"; // in it, by linked account
const OUTSIDE = "aaaaaaaa-0000-4000-8000-00000000c004"; // not in it
const COLLIDE = "aaaaaaaa-0000-4000-8000-00000000c005"; // last-10 twin of MEMBER

const PHONE_MEMBER  = "+33612345678";  // French 06
const PHONE_COLLIDE = "+13612345678";  // US area code 361 — same last ten digits
const PHONE_LINKED  = "+14155550001";
const PHONE_OUT     = "+14155550002";

const C_MEMBER = "11111111-0000-4000-8000-00000000c101";
const C_LINKED = "11111111-0000-4000-8000-00000000c102";
const C_DUPE   = "11111111-0000-4000-8000-00000000c103"; // second row, same person
const C_OTHER  = "11111111-0000-4000-8000-00000000c104"; // a member who is nobody

await query(`TRUNCATE circle_member_seen, circle_members, circles, discovery_keys,
  contact_identity_keys, contacts, users RESTART IDENTITY CASCADE`);

await query(
  `INSERT INTO users (amber_id, phone, full_name) VALUES
     ($1,$5,'Owner'), ($2,$6,'Member'), ($3,$7,'Linked'), ($4,$8,'Outside'),
     ($9,$10,'Collide')`,
  [OWNER, MEMBER, LINKED, OUTSIDE, "+14155550000", PHONE_MEMBER, PHONE_LINKED,
   PHONE_OUT, COLLIDE, PHONE_COLLIDE]);

// The owner's address book. C_MEMBER carries the member's real number; C_DUPE is
// a second row for the same person, which is the case the old third leg existed
// for; C_LINKED is linked by account with no key at all.
await query(
  `INSERT INTO contacts (id, owner_id, full_name, phone_primary,
                         phone_primary_normalized, linked_amber_id) VALUES
     ($1,$2,'Member Person',$5,$5,NULL),
     ($3,$2,'Member Person (dupe)',$5,$5,NULL),
     ($4,$2,'Linked Person','+14155550001','+14155550001',$6),
     ($7,$2,'Random Person','+14155559999','+14155559999',NULL)`,
  [C_MEMBER, OWNER, C_DUPE, C_LINKED, PHONE_MEMBER, LINKED, C_OTHER]);

// The identity key lands on ONE of the two duplicate rows. That is the dedup PK
// doing its job, and it is what broke membership for the other row.
await query(
  `INSERT INTO contact_identity_keys (owner_id, contact_id, key_type, key_hash)
   VALUES ($1,$2,$3,$4)`,
  // phoneHash(), not hashIdentityKey(): the latter takes an ALREADY-NORMALIZED
  // value, so handing it a raw +33... number produces a hash nothing else in the
  // system will ever compute. My own test did exactly that and spent a run
  // looking like a code bug.
  [OWNER, C_MEMBER, KEY_TYPE.PHONE, phoneHash(PHONE_MEMBER)]);

// discovery_keys is what the predicate reads: the keys each ACCOUNT has proven.
for (const [amberId, phone] of [[MEMBER, PHONE_MEMBER], [COLLIDE, PHONE_COLLIDE],
                                [OUTSIDE, PHONE_OUT]]) {
  await D.setDiscoveryKeys(amberId, { phones: [phone] });
}

const { rows: cir } = await query(
  `INSERT INTO circles (owner_id, name) VALUES ($1,'Inner') RETURNING id`, [OWNER]);
// A UUID, NOT A NUMBER. circles-store used to coerce this with Number() and get
// NaN, which is the other half of why circles were unreachable.
const CIRCLE = cir[0].id;
for (const cid of [C_MEMBER, C_LINKED, C_OTHER]) {
  await query(
    `INSERT INTO circle_members (circle_id, owner_id, contact_id) VALUES ($1,$2,$3)`,
    [CIRCLE, OWNER, cid]);
}

const sees = async (amberId) =>
  (await C.getInboundCirclesForViewer(amberId, null)).map((x) => x.id);

// ── the silent breakage ───────────────────────────────────────────────────────
console.log("\n── a member can see the circle at all ──");
ok((await sees(MEMBER)).includes(CIRCLE),
   "resolved by a phone key registered at signup, hashed, never passed in",
   JSON.stringify(await sees(MEMBER)));
ok((await sees(LINKED)).includes(CIRCLE),
   "and resolved by a linked account with no identity key");

// ── who must NOT see it ──────────────────────────────────────────────────────
console.log("\n── and nobody else can ──");
ok((await sees(OUTSIDE)).length === 0,
   "someone with a registered phone who is not in the circle sees nothing",
   JSON.stringify(await sees(OUTSIDE)));
ok((await sees(OWNER)).length === 0,
   "the owner's own circle is not an INBOUND circle");

// ── the collision, and what first-claim-wins turned it into ─────────────────
// PHONE_COLLIDE and PHONE_MEMBER are both real, allocatable numbers whose last
// ten digits match, and phoneKey normalizes to exactly those ten digits, so they
// hash identically. That used to mean COLLIDE could take MEMBER's discovery key
// and inherit their circles. discovery-store now refuses a contested claim, so
// COLLIDE simply never gets a key -- which is why it sees nothing here.
//
// AND THE COLLISION IS NOW CLOSED TOO: phoneKey keeps the country code, so these
// are two different keys and COLLIDE is simply a different person who registers
// their own number normally. Both layers matter -- first-claim-wins is what stops
// a takeover if any future normalization ever collides again.
console.log("\n── a colliding number gets nothing ──");
ok((await sees(COLLIDE)).length === 0,
   "a different real number with the same last ten digits reaches no circle",
   JSON.stringify({ member: PHONE_MEMBER, collide: PHONE_COLLIDE }));
const collideHasKey = await query(
  `SELECT count(*)::int n FROM discovery_keys WHERE amber_id = $1`, [COLLIDE]);
ok(collideHasKey.rows[0].n === 1,
   "and it holds its OWN key -- the numbers hash differently now, so this is a "
   + "different person rather than a refused duplicate",
   String(collideHasKey.rows[0].n));

// ── spoofing is not expressible any more ─────────────────────────────────────
console.log("\n── the phone is no longer an input ──");
const spoofed = await C.getInboundCirclesForViewer(OUTSIDE, PHONE_MEMBER);
ok(spoofed.length === 0,
   "passing the member's phone as the viewerPhone argument changes nothing",
   JSON.stringify(spoofed.map((x) => x.id)));
const alsoSpoofed = await C.getInboundCircleMembers(OUTSIDE, PHONE_MEMBER, CIRCLE);
ok(alsoSpoofed === null,
   "and the member list still refuses -- the argument is accepted and ignored");

// ── the duplicate-contact case the old third leg covered ─────────────────────
console.log("\n── two contact rows for one person ──");
await query(`DELETE FROM circle_members WHERE circle_id = $1 AND contact_id = $2`,
            [CIRCLE, C_MEMBER]);
await query(`INSERT INTO circle_members (circle_id, owner_id, contact_id)
             VALUES ($1,$2,$3)`, [CIRCLE, OWNER, C_DUPE]);
ok((await sees(MEMBER)).includes(CIRCLE),
   "the key is on the OTHER row, and membership still resolves -- same owner, "
   + "identical normalized number, so the same person",
   JSON.stringify(await sees(MEMBER)));
// (the collision block above already reports on COLLIDE; the point here is only
// that the duplicate-row leg compares two of the OWNER's rows and introduces no
// new way in.)

// ── the member list and leaving ──────────────────────────────────────────────
console.log("\n── the other two functions use the same predicate ──");
const members = await C.getInboundCircleMembers(MEMBER, null, CIRCLE);
ok(Array.isArray(members) && members.length === 3,
   "a member can list the circle's members", JSON.stringify(members?.length));
ok((await C.getInboundCircleMembers(OUTSIDE, null, CIRCLE)) === null,
   "a non-member gets null, not a list");
ok((await C.leaveInboundCircle(OUTSIDE, null, CIRCLE)) === 0,
   "a non-member cannot remove anybody");
const left = await C.leaveInboundCircle(MEMBER, null, CIRCLE);
ok(left === 1, "a member can leave, exactly one row", String(left));
ok((await sees(MEMBER)).length === 0, "and afterwards sees nothing");

// ── fails closed ─────────────────────────────────────────────────────────────
console.log("\n── an empty discovery_keys fails CLOSED ──");
await query(`INSERT INTO circle_members (circle_id, owner_id, contact_id)
             VALUES ($1,$2,$3)`, [CIRCLE, OWNER, C_MEMBER]);
ok((await sees(MEMBER)).includes(CIRCLE), "sanity: the member is back in");
await query(`DELETE FROM discovery_keys WHERE amber_id = $1`, [MEMBER]);
ok((await sees(MEMBER)).length === 0,
   "with no registered key the member is refused rather than admitted -- the "
   + "safe direction to be wrong in, and the reason the backfill matters");

console.log(`\n  ${pass} passed, ${fail} failed\n`);
await closePool();
process.exit(fail ? 1 : 0);
