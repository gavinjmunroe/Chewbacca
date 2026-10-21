/**
 * SMOKE TEST — merging two contact cards, and deleting one.
 *
 *     SMOKE_DATABASE_URL=postgres://postgres@127.0.0.1:5432/scratch \
 *       node scripts/collapse-smoke.mjs
 *
 * TWO FUNCTIONS THAT BOTH CLAIMED TO HANDLE "EVERYTHING THAT HANGS OFF A
 * CONTACT", AND NEITHER DID.
 *
 * deleteContactCascade listed eighteen child tables and deleted them one by one
 * inside a transaction, with a per-statement try/catch. The first statement was
 * against observation_dimensions, which has no owner_id and no contact_id, so it
 * raised 42703 -- and a caught error does not un-abort a Postgres transaction.
 * Every later statement failed 25P02, the final DELETE FROM contacts raised 25P02
 * outside the try, and the whole thing rolled back. Deleting a contact 500'd and
 * removed nothing. Nothing tested it.
 *
 * collapseContactGroup repointed two of those children. The other fifteen stayed
 * pointed at the absorbed card, which was then soft-deleted, so a merge silently
 * took away that card's observations, favorites, circle memberships and name
 * memories while returning ok. It runs on the SIGNUP path.
 *
 * So the assertions that matter here are the boring ones: after a merge, COUNT
 * the survivor's children and find everything; after a delete, count anything at
 * all and find nothing. Both were true-looking and false before.
 */
process.env.IDENTITY_KEY_PEPPER ||= "smoke-only-pepper-not-a-real-secret-0123456789";

import { pool, query, closePool } from "./smoke-db.mjs";
import { __injectPoolForSmokeTests } from "../src/db/sql.js";
import { collapseContactGroup } from "../src/db/store.js";
import { deleteContactCascade } from "../src/db/contact-delete.js";

__injectPoolForSmokeTests(pool);

let pass = 0, fail = 0;
const ok = (c, m, d = "") => {
  if (c) { pass++; console.log("  ✓ " + m); }
  else { fail++; console.log("  ✗ " + m + (d ? "   " + d : "")); }
};

const O = "aaaaaaaa-0000-4000-8000-00000000c001";
const S = "cccccccc-0000-4000-8000-00000000c001"; // survivor, oldest
const L = "cccccccc-0000-4000-8000-00000000c002"; // absorbed
const L2 = "cccccccc-0000-4000-8000-00000000c003"; // second absorbed
const CIRCLE = "dddddddd-0000-4000-8000-00000000c001";
const OBS_SHARED = "eeeeeeee-0000-4000-8000-00000000c001";
const OBS_LOSER = "eeeeeeee-0000-4000-8000-00000000c002";

const n = async (sql, params = [O]) => Number((await query(sql, params)).rows[0].n);
const childrenOf = (id) => n(
  `SELECT (SELECT count(*) FROM observations           WHERE owner_id=$1 AND contact_id=$2)
        + (SELECT count(*) FROM observation_participants WHERE owner_id=$1 AND contact_id=$2)
        + (SELECT count(*) FROM contact_favorites      WHERE owner_id=$1 AND contact_id=$2)
        + (SELECT count(*) FROM circle_members         WHERE owner_id=$1 AND contact_id=$2)
        + (SELECT count(*) FROM contact_name_memory    WHERE owner_id=$1 AND contact_id=$2)
        + (SELECT count(*) FROM voice_vocabulary       WHERE owner_id=$1 AND contact_id=$2)
        + (SELECT count(*) FROM contact_sources        WHERE owner_id=$1 AND contact_id=$2)
        + (SELECT count(*) FROM contact_identity_keys  WHERE owner_id=$1 AND contact_id=$2)
        + (SELECT count(*) FROM intro_requests         WHERE owner_id=$1 AND contact_id=$2)
        AS n`, [O, id]);

async function seed() {
  await query(`TRUNCATE users, contacts, circles, observations, shares,
                        contact_review_candidates RESTART IDENTITY CASCADE`);
  await query(`INSERT INTO users (amber_id, phone, full_name) VALUES
    ($1,'+14155558001','Merge Owner'),
    ('aaaaaaaa-0000-4000-8000-00000000c0ff','+14155558099','Requester')`, [O]);
  await query(
    `INSERT INTO contacts (id, owner_id, owner_phone, full_name, first_name,
                           company, phone_primary, phones_all, emails, created_at)
     VALUES ($2,$1,'+14155558001','Maggie Chen',NULL,NULL,'+14155559001','+14155559001','maggie@a.com', now() - interval '3 days'),
            ($3,$1,'+14155558001',NULL,'Maggie','Acme','+14155559002','+14155559002','maggie@b.com', now() - interval '2 days'),
            ($4,$1,'+14155558001',NULL,NULL,NULL,NULL,NULL,'maggie@c.com', now() - interval '1 days')`,
    [O, S, L, L2]);
  await query(`INSERT INTO circles (id, owner_id, name) VALUES ($1,$2,'Book Club')`, [CIRCLE, O]);

  // children on the ABSORBED cards -- every one of these must survive the merge
  await query(`INSERT INTO observations (observation_id, owner_id, contact_id, kind, body)
               VALUES ($1,$2,$3,'fact','loser card observation'),
                      ($4,$2,$5,'fact','shared observation')`,
              [OBS_LOSER, O, L, OBS_SHARED, S]);
  // both cards participate in ONE observation -- the collision case
  await query(`INSERT INTO observation_participants (observation_id, owner_id, contact_id, role)
               VALUES ($1,$2,$3,'subject'), ($1,$2,$4,'subject')`, [OBS_SHARED, O, S, L]);
  // both cards in the SAME circle -- the other collision case
  await query(`INSERT INTO circle_members (circle_id, owner_id, contact_id)
               VALUES ($1,$2,$3), ($1,$2,$4)`, [CIRCLE, O, S, L]);
  // favorites on both, with different tags -- must UNION
  await query(`INSERT INTO contact_favorites (owner_id, contact_id, tags, position)
               VALUES ($1,$2,ARRAY['work'],2), ($1,$3,ARRAY['climbing','work'],5)`, [O, S, L]);
  await query(`INSERT INTO contact_name_memory (owner_id, name_key, contact_id, stable_streak)
               VALUES ($1,'maggie',$2,3)`, [O, L]);
  await query(`INSERT INTO voice_vocabulary (owner_id, heard, corrected_to, contact_id)
               VALUES ($1,'maggy','Maggie',$2)`, [O, L]);
  await query(`INSERT INTO contact_sources (owner_id, contact_id, source, external_id)
               VALUES ($1,$2,'google','g-loser')`, [O, L]);
  await query(`INSERT INTO contact_identity_keys (owner_id, contact_id, key_type, key_hash)
               VALUES ($1,$2,1,decode('11111111111111111111111111111111','hex'))`, [O, L]);
  await query(`INSERT INTO intro_requests (requester_amber_id, owner_id, contact_id, status)
               VALUES ('aaaaaaaa-0000-4000-8000-00000000c0ff',$1,$2,'pending')`, [O, L]);
  await query(`INSERT INTO shares (owner_id, item_type, item_id, scope_type, scope_ref)
               VALUES ($1,'observation',$3,'contact',$2::uuid)`, [O, L, OBS_LOSER]);
  await query(`INSERT INTO contact_scores (owner_id, contact_id, base_score) VALUES ($1,$2,0.9)`, [O, L]);
  await query(`INSERT INTO contact_review_candidates (owner_id, contact_id, candidate_contact_id, reason)
               VALUES ($1,$2,$3,'same_name')`, [O, S, L]);
}

// ── the merge ────────────────────────────────────────────────────────────────
console.log("\n── merging two cards for one person ──");
await seed();
const before = { survivor: await childrenOf(S), loser: await childrenOf(L) };
ok(before.loser === 9, "the absorbed card starts with 9 child rows", String(before.loser));

const res = await collapseContactGroup(O, S, [L, L2]);
ok(res.ok === true, "the collapse reports success", JSON.stringify(res.reason ?? ""));
ok(res.collapsed === 2, "both absorbed cards are soft-deleted", String(res.collapsed));

ok(await childrenOf(L) === 0,
   "NOTHING is left pointing at the absorbed card — this was 7 before the fix",
   String(await childrenOf(L)));

console.log("\n── every child followed the merge ──");
ok(await n(`SELECT count(*)::int n FROM observations WHERE owner_id=$1 AND contact_id=$2`, [O, S]) === 2,
   "both observations are on the survivor");
ok(await n(`SELECT count(*)::int n FROM contact_name_memory WHERE owner_id=$1 AND contact_id=$2`, [O, S]) === 1,
   "the name memory moved — 'maggie' still resolves to a live card");
ok(await n(`SELECT count(*)::int n FROM voice_vocabulary WHERE owner_id=$1 AND contact_id=$2`, [O, S]) === 1,
   "the voice correction moved");
ok(await n(`SELECT count(*)::int n FROM contact_sources WHERE owner_id=$1 AND contact_id=$2`, [O, S]) === 1,
   "provenance moved");
ok(await n(`SELECT count(*)::int n FROM contact_identity_keys WHERE owner_id=$1 AND contact_id=$2`, [O, S]) === 1,
   "the identity key moved — inside the same transaction");
ok(await n(`SELECT count(*)::int n FROM intro_requests WHERE owner_id=$1 AND contact_id=$2`, [O, S]) === 1,
   "the pending intro request moved");
ok(await n(`SELECT count(*)::int n FROM shares
             WHERE owner_id=$1 AND scope_type='contact' AND scope_ref=$2::uuid`, [O, S]) === 1,
   "a note shared TO the absorbed card now reaches the survivor");

console.log("\n── the collisions that would have raised 23505 ──");
ok(await n(`SELECT count(*)::int n FROM observation_participants
             WHERE owner_id=$1 AND observation_id=$2`, [O, OBS_SHARED]) === 1,
   "one participant row on the shared observation, not two — a person cannot be "
   + "two participants, and moving the second would have violated the primary key");
ok(await n(`SELECT count(*)::int n FROM observation_participants
             WHERE owner_id=$1 AND contact_id=$2`, [O, S]) === 1,
   "and the survivor is the one that remains");
ok(await n(`SELECT count(*)::int n FROM circle_members WHERE owner_id=$1 AND circle_id=$2`,
           [O, CIRCLE]) === 1, "one circle membership, not two");
ok(await n(`SELECT count(*)::int n FROM circle_members
             WHERE owner_id=$1 AND circle_id=$2 AND contact_id=$3`, [O, CIRCLE, S]) === 1,
   "and it belongs to the survivor");

console.log("\n── favorites are merged, not picked ──");
const fav = (await query(
  `SELECT tags, position FROM contact_favorites WHERE owner_id=$1 AND contact_id=$2`, [O, S])).rows;
ok(fav.length === 1, "exactly one favorite row survives", String(fav.length));
ok(["climbing", "work"].every((t) => fav[0]?.tags?.includes(t)) && fav[0]?.tags?.length === 2,
   "holding the UNION of both cards' tags — dropping the absorbed card's tags would "
   + "be losing something the user typed", JSON.stringify(fav[0]?.tags));
ok(fav[0]?.position === 2, "and the earliest position", String(fav[0]?.position));

console.log("\n── the survivor's own fields ──");
const sc = (await query(`SELECT * FROM contacts WHERE id=$1`, [S])).rows[0];
ok(sc.full_name === "Maggie Chen", "a non-null survivor field is never overwritten");
ok(sc.first_name === "Maggie", "a blank one is filled from the absorbed card");
ok(sc.company === "Acme", "and so is company");
ok(sc.emails.includes("maggie@a.com") && sc.emails.includes("maggie@b.com")
   && sc.emails.includes("maggie@c.com"),
   "every email from all three cards is kept", sc.emails);
ok(sc.deleted_at === null, "and the survivor is still live");

console.log("\n── derived rows are dropped so they recompute, not merged ──");
ok(await n(`SELECT count(*)::int n FROM contact_scores WHERE owner_id=$1 AND contact_id=$2`, [O, L]) === 0,
   "the absorbed card's score is gone — inventing a merged score would be inventing a number");
ok(await n(`SELECT count(*)::int n FROM contact_review_candidates WHERE owner_id=$1`, [O]) === 0,
   "the review candidate is gone — merging the pair IS the answer to 'are these the same person'");

console.log("\n── refusals and idempotency ──");
ok((await collapseContactGroup(O, S, [S])).reason === "survivor_only",
   "a group naming only the survivor is refused — it would soft-delete the row "
   + "everything was just repointed onto");
ok((await collapseContactGroup(O, S, [])).reason === "missing_args", "an empty group is refused");
const again = await collapseContactGroup(O, S, [L]);
ok(again.ok === true, "re-running over an already-absorbed card is harmless", JSON.stringify(again.reason ?? ""));
ok(await childrenOf(S) >= 9, "and the survivor still holds everything", String(await childrenOf(S)));

// ── the delete ───────────────────────────────────────────────────────────────
console.log("\n── deleting a contact, which used to throw and delete nothing ──");
await seed();
let threw = null, del;
try { del = await deleteContactCascade(O, L); } catch (e) { threw = e; }
ok(threw === null,
   "it does not throw — it used to raise 25P02 because a caught error inside a "
   + "transaction does not un-abort it", threw ? `${threw.code} ${threw.message}` : "");
ok(del?.ok === true, "and reports success", JSON.stringify(del?.reason ?? ""));
ok(await n(`SELECT count(*)::int n FROM contacts WHERE owner_id=$1 AND id=$2`, [O, L]) === 0,
   "the contact row is gone — before the fix it was still there");
ok(await childrenOf(L) === 0, "and every child went with it, by cascade");
ok(del?.deleted?.contacts === 1, "the count reported to the caller is real", JSON.stringify(del?.deleted));
ok((del?.deleted?.observations ?? 0) >= 1,
   "and names the children it took", JSON.stringify(del?.deleted));
ok(await n(`SELECT count(*)::int n FROM shares
             WHERE owner_id=$1 AND scope_type='contact' AND scope_ref=$2::uuid`, [O, L]) === 0,
   "a share targeted at them is gone too — shares have no FK, so this one is explicit");
ok(await n(`SELECT count(*)::int n FROM contacts
             WHERE owner_id=$1 AND id=$2 AND deleted_at IS NULL`, [O, S]) === 1,
   "the OTHER contact is untouched");

const notFound = await deleteContactCascade(O, "cccccccc-0000-4000-8000-0000000000ff");
ok(notFound.ok === false && notFound.reason === "not_found",
   "an unknown id is a clean not_found, not a silent success");
const wrongOwner = await deleteContactCascade("aaaaaaaa-0000-4000-8000-00000000c0ff", S);
ok(wrongOwner.ok === false && wrongOwner.reason === "not_found",
   "and another owner cannot delete this contact");
ok(await n(`SELECT count(*)::int n FROM contacts
             WHERE owner_id=$1 AND id=$2 AND deleted_at IS NULL`, [O, S]) === 1,
   "which is still there afterwards");

console.log(`\n  ${pass} passed, ${fail} failed\n`);
await closePool();
process.exit(fail ? 1 : 0);
