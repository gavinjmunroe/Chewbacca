/**
 * SMOKE TEST — conversations, note media, note sharing, discovery keys.
 *
 * Run it against a scratch database (see scripts/smoke-db.mjs for the two locks
 * that stop it reaching a real one):
 *
 *     SMOKE_DATABASE_URL=postgres://amber:amber@127.0.0.1:5432/scratch \
 *       node scripts/notes-smoke.mjs
 *
 * WHAT IT IS FOR. Porting these stores onto the new schema broke things the SQL
 * looked fine for: return shapes that quietly changed underneath unchanged
 * signatures, and an authorization predicate that said yes to the wrong person.
 * Both classes are checked here by assertion rather than by reading.
 *
 * Two of these assertions exist because they failed the first time:
 *   "A STRANGER CANNOT DELETE A COMMENT"
 *   "PRESENTING SOMEONE ELSE'S PHONE DOES NOT HELP A STRANGER"
 */
process.env.IDENTITY_KEY_PEPPER ||= "smoke-only-pepper-not-a-real-secret-0123456789";

import { pool, query, closePool } from "./smoke-db.mjs";
import { __injectPoolForSmokeTests } from "../src/db/sql.js";
import * as Conv from "../src/db/csql-conversation-store.js";
import * as Media from "../src/db/note-media-store.js";
import * as ShareS from "../src/db/note-shares-store.js";
import * as Disc from "../src/db/discovery-store.js";
import { phoneHash, KEY_TYPE } from "../src/lib/identity-keys.js";

// The stores import the app's pool. Point that pool at the scratch database
// BEFORE any of them runs a query -- an explicit call, not an environment
// variable, so no deploy can trip it by accident. Nothing queries at import
// time, so doing this after the imports is safe.
__injectPoolForSmokeTests(pool);

let pass = 0, fail = 0;
const ok = (c, m, d = "") => {
  if (c) { pass++; console.log("  ✓ " + m); }
  else { fail++; console.log("  ✗ " + m + (d ? "   " + d : "")); }
};

const K = "aaaaaaaa-0000-4000-8000-000000000001"; // owner
const V = "bbbbbbbb-0000-4000-8000-000000000002"; // viewer, a linked contact
const X = "cccccccc-0000-4000-8000-000000000003"; // stranger
const P = "dddddddd-0000-4000-8000-000000000004"; // viewer reachable BY PHONE only
const CV = "11111111-0000-4000-8000-000000000001"; // contact row for V
const CP = "11111111-0000-4000-8000-000000000002"; // contact row for P
const CIRC = "22222222-0000-4000-8000-000000000001";
const PHONE_P = "+1 415 000-0004";

await query(`TRUNCATE conversations, conversation_messages, conversation_comments,
  conversation_reactions, media_assets, shares, circle_member_seen, circle_members,
  circles, connections, contact_identity_keys, discovery_keys, contacts, users
  RESTART IDENTITY CASCADE`);

await query(
  `INSERT INTO users (amber_id, phone, full_name) VALUES
     ($1,'+14150000001','Karthik'),($2,'+14150000002','Viewer'),
     ($3,'+14150000003','Stranger'),($4,'+14150000004','PhoneOnly')`,
  [K, V, X, P],
);
await query(
  `INSERT INTO contacts (id, owner_id, full_name, linked_amber_id) VALUES
     ($1,$2,'Viewer',$3), ($4,$2,'PhoneOnly',NULL)`,
  [CV, K, V, CP],
);
// PhoneOnly is in the owner's book by number, never linked to an account.
await query(
  `INSERT INTO contact_identity_keys (owner_id, contact_id, key_type, key_hash)
   VALUES ($1,$2,$3,$4)`,
  [K, CP, KEY_TYPE.PHONE, phoneHash(PHONE_P)],
);
await query(`INSERT INTO circles (id, owner_id, name) VALUES ($1,$2,'Close')`, [CIRC, K]);
await query(
  `INSERT INTO circle_members (circle_id, contact_id, owner_id) VALUES ($1,$2,$3),($1,$4,$3)`,
  [CIRC, CV, K, CP],
);

// ── identity keys ────────────────────────────────────────────────────────────
console.log("\n── identity keys ──");
ok(phoneHash(PHONE_P).length === 16, "a phone key hashes to exactly 16 bytes");
ok(phoneHash("415-000-0004").equals(phoneHash("+1 (415) 000 0004")),
   "formatting does not change the key");
ok(!phoneHash("415-000-0004").equals(phoneHash("415-000-0005")),
   "different numbers give different keys");
ok(phoneHash("123") === null, "too short to identify a person -> no key");

// ── discovery keys ───────────────────────────────────────────────────────────
console.log("\n── discovery keys ──");
// setDiscoveryKeys returns { held, conflicts } rather than a bare count: a
// refused claim has to be something a caller can see, not something inferred
// from a number that looks the same either way.
ok((await Disc.setDiscoveryKeys(P, { phones: [PHONE_P] })).held === 1,
   "an account records the key it owns");
// setDiscoveryKeys returns { held, conflicts } rather than a bare count: a
// refused claim has to be something a caller can see, not something inferred
// from a number that looks the same either way.
ok((await Disc.setDiscoveryKeys(P, { phones: [PHONE_P] })).held === 1, "and doing it twice is idempotent");
const found = await Disc.amberIdsForKeys([phoneHash(PHONE_P)]);
ok(found.get(phoneHash(PHONE_P).toString("hex")) === P, "the sweep can find the account by key");
const swept = await Disc.linkContactsToNewAccount(P, { phones: [PHONE_P] });
ok(swept.linked === 1 && swept.owners[0] === K,
   "signup links the contact card that held that number, and names its owner",
   JSON.stringify(swept));
ok((await Disc.linkContactsToNewAccount(P, { phones: [PHONE_P] })).linked === 0,
   "and re-running the sweep links nothing twice");
// Undo the link: the rest of the file tests the PHONE path, where the card is
// deliberately NOT linked to an account.
await query(`UPDATE contacts SET linked_amber_id = NULL WHERE id = $1`, [CP]);

// ── conversations ────────────────────────────────────────────────────────────
console.log("\n── conversations ──");
const a = await Conv.appendMessage(K, { conversationId: null, role: "user", content: "who should I call?" });
ok(!!a?.conversationId, "appendMessage creates the thread on its first turn");
const CONV = a.conversationId;
await Conv.appendMessage(K, { conversationId: CONV, role: "amber", content: "Maggie.", metadata: { groups: 1 } });
const turns = await Conv.listConversation(K, CONV);
ok(turns.length === 2 && turns[0].content === "who should I call?", "listConversation is oldest-first");
ok((await Conv.appendMessage(X, { conversationId: CONV, role: "user", content: "x" })) === null,
   "a stranger cannot append to your thread");
ok((await Conv.mergeMessageMetadata(K, turns[1].id, { people: [1, 2] })) === 1, "mergeMessageMetadata patches");
const recent = await Conv.listRecentConversations(K);
ok(recent.length === 1 && recent[0].message_count === 2 && recent[0].last_message === "Maggie.",
   "listRecentConversations returns the thread and its newest turn");

// ── audio: the three legs ────────────────────────────────────────────────────
console.log("\n── audio ──");
const key1 = await Media.reserveAudioUpload(K, CONV);
ok(typeof key1 === "string" && key1.startsWith(`notes/${K}/${CONV}/`),
   "reserve returns a STRING key the server chose", String(key1));
const key2 = await Media.reserveAudioUpload(K, CONV);
ok(typeof key2 === "string" && key2 !== key1, "re-reserving mints a NEW object path");
const liveRows = await query(
  `SELECT count(*)::int n FROM media_assets WHERE conversation_id=$1 AND deleted_at IS NULL`, [CONV]);
ok(liveRows.rows[0].n === 1, "...but there is still exactly ONE live row", String(liveRows.rows[0].n));
ok((await Media.markAudioReady(K, CONV, { durationMs: 12000, byteSize: 240000, peaks: [0, 55, 300, -4] })) === true,
   "markAudioReady returns a boolean");
const row = await Media.getAudioRow(K, CONV);
ok(row?.status === "ready" && row.duration_ms === 12000, "the row is ready with the server's numbers");
ok(row.peaks.length === 4 && row.peaks[2] === 100 && row.peaks[3] === 0, "peaks clamped to 0..100",
   JSON.stringify(row.peaks));
await Media.markAudioReady(K, CONV, { durationMs: 99e6, byteSize: 1, peaks: [] });
ok((await Media.getAudioRow(K, CONV)).duration_ms === Media.MAX_DURATION_MS,
   "an absurd duration is capped, not stored");
const long = Media.normalizePeaks(Array.from({ length: 400 }, (_, i) => (i < 200 ? 0 : 100)));
ok(long.length === Media.MAX_PEAKS && long[0] === 0 && long[Media.MAX_PEAKS - 1] === 100,
   "an over-long waveform is DOWNSAMPLED, so its shape survives", JSON.stringify([long.length, long[0], long.at(-1)]));

// ── sharing ──────────────────────────────────────────────────────────────────
console.log("\n── sharing ──");
ok((await ShareS.getNoteShare(K, CONV)).visibility === "private", "a note is private until shared");
ok((await ShareS.setNoteShare(K, CONV, { visibility: "circle", targetId: CIRC })).ok === true,
   "the owner can share to their own circle");
ok((await ShareS.getNoteShare(K, CONV)).targetName === "Close", "the share sheet reads back the circle name");
const badTarget = await ShareS.setNoteShare(X, CONV, { visibility: "circle", targetId: CIRC });
ok(badTarget.ok === false && badTarget.reason === "note_not_found",
   "a stranger cannot share your note", JSON.stringify(badTarget));
const notMine = await ShareS.setNoteShare(K, CONV, { visibility: "contact", targetId: "99999999-0000-4000-8000-000000000009" });
ok(notMine.ok === false && notMine.reason === "invalid_target", "a target you do not own is refused");

await ShareS.setNoteShare(K, CONV, { visibility: "contact", targetId: CV });
const live = await query(
  `SELECT count(*)::int n FROM shares WHERE item_id=$1 AND deleted_at IS NULL`, [CONV]);
ok(live.rows[0].n === 1, "changing the audience leaves exactly ONE live share row", String(live.rows[0].n));

// ── the choke point ──────────────────────────────────────────────────────────
console.log("\n── canViewNote ──");
ok((await Media.canViewNote(K, null, K, CONV)) === true, "the owner can always see their own note");
ok((await Media.canViewNote(V, null, K, CONV)) === true, "the scoped contact can see it");
ok((await Media.canViewNote(X, null, K, CONV)) === false, "a stranger cannot");
ok((await Media.canViewNote(P, PHONE_P, K, CONV)) === false, "...nor a phone-only contact who is not the target");

await ShareS.setNoteShare(K, CONV, { visibility: "circle", targetId: CIRC });
ok((await Media.canViewNote(P, PHONE_P, K, CONV)) === true,
   "a circle member reachable ONLY by registered phone can see it");
ok((await Media.canViewNote(P, null, K, CONV)) === true,
   "...and it does not depend on the caller passing a phone at all");
ok((await Media.canViewNote(X, PHONE_P, K, CONV)) === false,
   "PRESENTING SOMEONE ELSE'S PHONE DOES NOT HELP A STRANGER  <-- the hole this closes");
await query(`DELETE FROM discovery_keys WHERE amber_id = $1`, [P]);
ok((await Media.canViewNote(P, PHONE_P, K, CONV)) === false,
   "an account that has not proven the number fails CLOSED");
await Disc.setDiscoveryKeys(P, { phones: [PHONE_P] });

await query(`DELETE FROM circle_members WHERE circle_id=$1 AND contact_id=$2`, [CIRC, CP]);
ok((await Media.canViewNote(P, PHONE_P, K, CONV)) === false,
   "removing them from the circle revokes the past note immediately");
await query(`INSERT INTO circle_members (circle_id, contact_id, owner_id) VALUES ($1,$2,$3)`, [CIRC, CP, K]);

// network scope
await query(
  `INSERT INTO connections (a_amber_id, b_amber_id, status)
   VALUES (LEAST($1::uuid,$2::uuid), GREATEST($1::uuid,$2::uuid), 'active')`,
  [K, X]);
await ShareS.setNoteShare(K, CONV, { visibility: "network" });
ok((await Media.canViewNote(X, null, K, CONV)) === true, "a network share reaches a live connection");
await query(`UPDATE connections SET status='blocked'`);
ok((await Media.canViewNote(X, null, K, CONV)) === false, "...and stops the moment it is blocked");
await query(`UPDATE connections SET status='active'`);

// ── feeds ────────────────────────────────────────────────────────────────────
console.log("\n── feeds ──");
await ShareS.setNoteShare(K, CONV, { visibility: "circle", targetId: CIRC });
const feed = await ShareS.getSharedNotesForViewer(V, null);
ok(feed.length === 1 && feed[0].noteId === CONV, "the note reaches the viewer's feed", JSON.stringify(feed.length));
ok(feed[0].transcript === "who should I call?", "the transcript is the USER turns only", JSON.stringify(feed[0]?.transcript));
ok(feed[0].sharedBy?.name === "Karthik" && feed[0].circleName === "Close", "the feed row carries who and where");
ok((await ShareS.getSharedNotesForViewer(K, null)).length === 0, "your own note is not in your feed");

const cfeed = await ShareS.getCircleNoteFeed(V, null, CIRC);
ok(Array.isArray(cfeed) && cfeed.length === 1, "a member can read the circle feed");
ok((await ShareS.getCircleNoteFeed(X, null, CIRC)) === null, "a non-member gets null, not an empty list");
ok((await ShareS.getCircleNoteFeed(V, null, CIRC, { q: "call" })).length === 1, "search matches the transcript");
ok((await ShareS.getCircleNoteFeed(V, null, CIRC, { q: "zzz" })).length === 0, "and misses when it should");
ok((await ShareS.getCircleNoteFeed(X, null, CIRC, { q: "call" })) === null, "searching a circle you cannot see still 404s");

const unseen = await ShareS.getUnseenCircleShareCounts(V, null, [CIRC]);
ok(unseen.get(CIRC) === 1, "the unseen dot counts the share", JSON.stringify([...unseen]));
ok((await ShareS.markCircleFeedSeen(V, CIRC)) === true, "marking seen succeeds");
ok((await ShareS.getUnseenCircleShareCounts(V, null, [CIRC])).size === 0, "and the dot clears");
ok((await ShareS.getUnseenCircleShareCounts(K, null, [CIRC])).size === 0, "your own shares never light your own dot");

// deleting the thread hides it from every feed
await Conv.softDeleteConversation(K, CONV);
ok((await ShareS.getSharedNotesForViewer(V, null)).length === 0,
   "deleting the note removes it from the feed even though the share row lingers");
await query(`UPDATE conversations SET deleted_at = NULL WHERE conversation_id=$1`, [CONV]);
await query(`UPDATE conversation_messages SET deleted_at = NULL WHERE conversation_id=$1`, [CONV]);

// ── reactions ────────────────────────────────────────────────────────────────
console.log("\n── reactions ──");
ok((await Media.setReaction(K, CONV, V, "like")) === true, "setReaction returns a boolean");
ok((await Media.setReaction(K, CONV, V, "nope")) === false, "an unknown kind is refused");
await Media.setReaction(K, CONV, V, "laugh");
const rx = await Media.listReactions(K, CONV, V);
ok(rx.counts.laugh === 1 && rx.counts.like === 0, "changing your reaction replaces it, it does not add one");
ok(Object.keys(rx.counts).length === 5, "counts are zero-filled for all five kinds");
ok(rx.mine === "laugh" && rx.total === 1, "the viewer's own choice comes back with the counts");
ok(rx.people.length === 1 && rx.people[0].name === "Viewer", "and so does who reacted");
ok((await Media.clearReaction(K, CONV, V)) === true, "clearReaction returns a boolean");
ok((await Media.listReactions(K, CONV, V)).total === 0, "and the reaction is gone");

// ── comments ─────────────────────────────────────────────────────────────────
console.log("\n── comments ──");
const c1 = await Media.addComment(K, CONV, V, "  nice one  ");
ok(c1 && typeof c1.id === "string" && c1.createdAt instanceof Date, "addComment returns { id, createdAt }",
   JSON.stringify(c1));
ok((await Media.addComment(K, CONV, V, "x".repeat(1001))) === null,
   "an over-long comment is REJECTED, not silently truncated");
ok((await Media.addComment(K, CONV, V, "   ")) === null, "an empty comment is refused");
const list = await Media.listComments(K, CONV);
ok(list.length === 1 && list[0].body === "nice one" && list[0].author.name === "Viewer",
   "listComments trims and joins the author", JSON.stringify(list[0]));

const c2 = await Media.addComment(K, CONV, V, "second");
ok((await Media.deleteComment(K, CONV, c2.id, X)) === false,
   "A STRANGER CANNOT DELETE A COMMENT.  <-- the bug this test exists for");
ok((await Media.deleteComment(K, CONV, c2.id, V)) === true, "the author can delete their own");
ok((await Media.deleteComment(K, CONV, c1.id, K)) === true, "the note's owner can moderate any comment");
ok((await Media.listComments(K, CONV)).length === 0, "both are gone");

// ── the batch ────────────────────────────────────────────────────────────────
console.log("\n── batch ──");
await Media.addComment(K, CONV, V, "live comment");
await Media.setReaction(K, CONV, V, "like");
await Media.setReaction(K, CONV, X, "like");
await Media.setReaction(K, CONV, P, "laugh");
const meta = await Media.getNoteMetaBatch([{ ownerId: K, conversationId: CONV }], V);
const cell = meta[`${K}|${CONV}`];
ok(!!cell, "the batch is keyed ownerId|conversationId", JSON.stringify(Object.keys(meta)));
ok(cell?.audio?.durationMs === Media.MAX_DURATION_MS, "the batch carries the audio");
ok(cell?.commentCount === 1, "and the comment count", String(cell?.commentCount));
ok(cell?.reactions.total === 3 && cell?.reactions.counts.like === 2 && cell?.reactions.counts.laugh === 1,
   "and per-kind counts that sum to the total", JSON.stringify(cell?.reactions));
ok(cell?.reactions.mine === "like", "and the viewer's own reaction");
ok(Object.keys(cell.reactions.counts).length === 5, "zero-filled here too");
const empty = await Media.getNoteMetaBatch([{ ownerId: K, conversationId: "99999999-0000-4000-8000-000000000009" }], V);
const ecell = empty[`${K}|99999999-0000-4000-8000-000000000009`];
ok(ecell && ecell.audio === null && ecell.commentCount === 0 && ecell.reactions.total === 0,
   "a note with nothing on it still gets a fully-formed cell");

console.log(`\n  ${pass} passed, ${fail} failed\n`);
await closePool();
process.exit(fail ? 1 : 0);
