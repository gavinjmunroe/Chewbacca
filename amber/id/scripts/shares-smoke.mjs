/**
 * SMOKE TEST — the sharing engine on the new schema.
 *
 *     SMOKE_DATABASE_URL=postgres://amber:amber@127.0.0.1:5432/scratch \
 *       node scripts/shares-smoke.mjs
 *
 * This file existed in a state where every one of its writes would have returned
 * null (uuid ids through an integer validator) and its network leg would have
 * matched nothing (a viewer-reach copy that still named columns the connections
 * table dropped). Both are asserted below.
 */
process.env.IDENTITY_KEY_PEPPER ||= "smoke-only-pepper-not-a-real-secret-0123456789";

import { pool, query, closePool } from "./smoke-db.mjs";
import { __injectPoolForSmokeTests } from "../src/db/sql.js";
import * as S from "../src/db/shares-store.js";
import * as Disc from "../src/db/discovery-store.js";
import { phoneHash, KEY_TYPE } from "../src/lib/identity-keys.js";

__injectPoolForSmokeTests(pool);

let pass = 0, fail = 0;
const ok = (c, m, d = "") => {
  if (c) { pass++; console.log("  ✓ " + m); }
  else { fail++; console.log("  ✗ " + m + (d ? "   " + d : "")); }
};

const K = "aaaaaaaa-0000-4000-8000-000000000001"; // owner
const V = "bbbbbbbb-0000-4000-8000-000000000002"; // linked contact
const X = "cccccccc-0000-4000-8000-000000000003"; // connection
const P = "dddddddd-0000-4000-8000-000000000004"; // phone-only circle member
const CV = "11111111-0000-4000-8000-00000000001a";
const CP = "11111111-0000-4000-8000-00000000001b";
const CIRC = "22222222-0000-4000-8000-00000000001c";
const PHONE_P = "+1 415 000-0004";

await query(`TRUNCATE shares, circle_members, circles, connections,
  contact_identity_keys, discovery_keys, observations, contacts, users
  RESTART IDENTITY CASCADE`);
await query(
  `INSERT INTO users (amber_id, phone, full_name) VALUES
     ($1,'+14150000001','Karthik'),($2,'+14150000002','Viewer'),
     ($3,'+14150000003','Connected'),($4,'+14150000004','PhoneOnly')`,
  [K, V, X, P],
);
await query(
  `INSERT INTO contacts (id, owner_id, full_name, linked_amber_id)
   VALUES ($1,$2,'Viewer',$3), ($4,$2,'PhoneOnly',NULL)`,
  [CV, K, V, CP],
);
await query(
  `INSERT INTO contact_identity_keys (owner_id, contact_id, key_type, key_hash)
   VALUES ($1,$2,$3,$4)`, [K, CP, KEY_TYPE.PHONE, phoneHash(PHONE_P)]);
await Disc.setDiscoveryKeys(P, { phones: [PHONE_P] });
await query(`INSERT INTO circles (id, owner_id, name) VALUES ($1,$2,'Close')`, [CIRC, K]);
await query(`INSERT INTO circle_members (circle_id, contact_id, owner_id) VALUES ($1,$2,$3)`,
  [CIRC, CP, K]);

const { rows: obsRows } = await query(
  `INSERT INTO observations (owner_id, kind, body, place_text, observed_at)
   VALUES ($1,'experience','Dinner with Maggie and Sagar','Sagar''s place', now())
   RETURNING observation_id`, [K]);
const EXP = obsRows[0].observation_id;

console.log("\n── writing a share ──");
const created = await S.createShare(K, {
  itemType: "experience", itemId: EXP, scopeType: "circle", scopeRef: CIRC });
ok(created?.id, "an experience shares to a circle, with UUID ids", JSON.stringify(created));
const stored = await query(`SELECT item_type FROM shares WHERE id = $1`, [created.id]);
ok(stored.rows[0].item_type === "observation",
   "the API word 'experience' is stored as 'observation'", stored.rows[0].item_type);
const again = await S.createShare(K, {
  itemType: "experience", itemId: EXP, scopeType: "circle", scopeRef: CIRC });
ok(again?.id === created.id, "re-sharing the same pair is idempotent, not a second row");

ok((await S.createShare(K, { itemType: "experience", itemId: EXP, scopeType: "circle", scopeRef: "22222222-0000-4000-8000-0000000000ff" })) === null,
   "a circle you do not own is refused");
ok((await S.createShare(X, { itemType: "experience", itemId: EXP, scopeType: "circle", scopeRef: CIRC })) === null,
   "an item you do not own is refused");
ok((await S.createShare(K, { itemType: "nonsense", itemId: EXP, scopeType: "circle", scopeRef: CIRC })) === null,
   "an item type outside the map never reaches the CHECK constraint");
ok((await S.createShare(K, { itemType: "post", itemId: EXP, scopeType: "network" }))?.id,
   "a network share writes with a NULL scope_ref");
ok((await S.createShare(K, { itemType: "interaction", itemId: EXP, scopeType: "network" }))?.id,
   "'interaction' is writable, because the API already accepts it");

console.log("\n── reading it back ──");
const list = await S.listSharesForItem(K, "experience", EXP);
ok(list.length === 1 && list[0].scopeRef === CIRC, "the share sheet sees one circle audience",
   JSON.stringify(list));

console.log("\n── who it reaches ──");
const pFeed = await S.getSharedWithViewer(P, null);
ok(pFeed.length === 1 && pFeed[0].itemId === EXP,
   "a circle member reachable only by registered phone receives it", JSON.stringify(pFeed.length));
ok(pFeed[0].itemType === "experience", "and gets the API word back, not the column word",
   pFeed[0].itemType);
ok(pFeed[0].content?.text === "Dinner with Maggie and Sagar", "with the observation's body");
ok(pFeed[0].content?.location === "Sagar's place",
   "and its location, which observations did not carry until place_text",
   JSON.stringify(pFeed[0].content));
ok((await S.getSharedWithViewer(V, null)).length === 0, "a non-member does not receive it");
ok((await S.getSharedWithViewer(K, null)).length === 0, "and you never receive your own");

console.log("\n── the network leg, which used to match nothing ──");
await query(
  `INSERT INTO connections (a_amber_id, b_amber_id, status)
   VALUES (LEAST($1::uuid,$2::uuid), GREATEST($1::uuid,$2::uuid), 'active')`, [K, X]);
await S.createShare(K, { itemType: "experience", itemId: EXP, scopeType: "network" });
// The 'post' and 'interaction' network shares written earlier reach X too, so
// count the experience specifically rather than the whole feed.
const expShares = async (who) =>
  (await S.getSharedWithViewer(who, null)).filter((r) => r.itemType === "experience").length;
ok((await expShares(X)) === 1, "a live connection receives a network share");
await query(`UPDATE connections SET status = 'blocked'`);
ok((await S.getSharedWithViewer(X, null)).length === 0, "and stops the moment it is blocked");
await query(`UPDATE connections SET status = 'active'`);

console.log("\n── deleting ──");
ok((await S.deleteShareByTarget(K, { itemType: "experience", itemId: EXP, scopeType: "network" })) === 1,
   "un-sharing by target removes exactly the one row");
ok((await expShares(X)) === 0, "and the connection stops seeing it");
ok((await S.deleteShare(K, created.id)) === 1, "un-sharing by id works too");
ok((await S.getSharedWithViewer(P, null)).length === 0, "and the circle member stops seeing it");

console.log("\n── a deleted item never surfaces ──");
await S.createShare(K, { itemType: "experience", itemId: EXP, scopeType: "circle", scopeRef: CIRC });
ok((await S.getSharedWithViewer(P, null)).length === 1, "shared again, visible again");
await query(`UPDATE observations SET deleted_at = now() WHERE observation_id = $1`, [EXP]);
ok((await S.getSharedWithViewer(P, null)).length === 0,
   "deleting the experience hides it even though the share row lingers");
await query(`UPDATE observations SET deleted_at = NULL WHERE observation_id = $1`, [EXP]);

console.log("\n── resolving a recipient to notify ──");
ok((await S.resolveContactRecipient(K, CV)) === V, "a linked contact resolves directly");
ok((await S.resolveContactRecipient(K, CP)) === P,
   "an unlinked contact resolves through discovery_keys, by hash");
ok((await S.resolveContactRecipient(X, CV)) === null, "and never for a contact you do not own");

console.log(`\n  ${pass} passed, ${fail} failed\n`);
await closePool();
process.exit(fail ? 1 : 0);
