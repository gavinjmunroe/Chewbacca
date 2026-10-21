/**
 * SMOKE TEST — provider identities, which is Sign in with Apple.
 *
 *     SMOKE_DATABASE_URL=postgres://postgres@127.0.0.1:5432/scratch \
 *       node scripts/identities-smoke.mjs
 *
 * user-identities-store.js read six columns that migration 002 removed, so every
 * query in it threw and Apple identity linking has been dead since the rebuild.
 * Nothing tested it, which is why nobody knew.
 *
 * TWO CLAIMS MATTER MORE THAN THE REST, and both are about refusing correctly:
 *
 *   a subject already live on ANOTHER account must not be re-pointed. That means
 *   two people are contesting one Apple ID, or one person has two accounts, and
 *   silently moving the row hands the loser's account to the winner.
 *
 *   removing Sign in with Apple and adding it back must WORK. unlinkIdentity
 *   soft-deletes and (provider, subject) is the primary key, so the obvious INSERT
 *   raises a unique violation, the old code then looked for a live row, found
 *   none, and answered "subject_taken" -- accusing the user of contesting their
 *   own Apple ID, permanently.
 */
process.env.IDENTITY_KEY_PEPPER ||= "smoke-only-pepper-not-a-real-secret-0123456789";

import { pool, query, closePool } from "./smoke-db.mjs";
import { __injectPoolForSmokeTests } from "../src/db/sql.js";
import * as I from "../src/db/user-identities-store.js";

__injectPoolForSmokeTests(pool);

let pass = 0, fail = 0;
const ok = (c, m, d = "") => {
  if (c) { pass++; console.log("  ✓ " + m); }
  else { fail++; console.log("  ✗ " + m + (d ? "   " + d : "")); }
};

const A = "aaaaaaaa-0000-4000-8000-00000000da01";
const B = "aaaaaaaa-0000-4000-8000-00000000da02";
const SUB = "001234.abcdef0123456789.0900";

await query(`TRUNCATE user_identities, users RESTART IDENTITY CASCADE`);
await query(`INSERT INTO users (amber_id, phone, full_name) VALUES
  ($1,'+14155553001','Alice'), ($2,'+14155553002','Bob')`, [A, B]);

const raw = async () => (await query(
  `SELECT provider, subject, amber_id, email, email_verified, is_private_email,
          last_used_at, deleted_at
     FROM user_identities ORDER BY provider, subject`)).rows;

// ── the first link ───────────────────────────────────────────────────────────
console.log("\n── the link that never worked ──");
const first = await I.linkIdentity({
  amberId: A, provider: "apple", subject: SUB,
  email: "alice@privaterelay.appleid.com", emailVerified: true, isPrivateEmail: true,
});
ok(first.ok === true, "an identity attaches to an account", JSON.stringify(first.reason ?? ""));
const rows1 = await raw();
ok(rows1.length === 1, "one row exists", String(rows1.length));
ok(rows1[0].email === "alice@privaterelay.appleid.com",
   "carrying the email Apple sent — the column migration 002 dropped");
ok(rows1[0].is_private_email === true, "and the private-relay flag");
ok(rows1[0].email_verified === true, "and Apple's verified claim");
ok(rows1[0].last_used_at !== null, "and last_used_at");
ok(first.identity.amberId === A, "and the returned identity names the account");
ok(!("id" in first.identity),
   "with NO surrogate id — the key is (provider, subject)", JSON.stringify(Object.keys(first.identity)));

// ── APPLE SENDS THE EMAIL ONCE ───────────────────────────────────────────────
console.log("\n── a later sign-in carries no email, and must not erase it ──");
const again = await I.linkIdentity({ amberId: A, provider: "apple", subject: SUB, email: null });
ok(again.ok === true, "re-linking the same subject to the same account is fine");
const rows2 = await raw();
ok(rows2[0].email === "alice@privaterelay.appleid.com",
   "the address SURVIVES a null — Apple only ever sends it on the first "
   + "authorization, so it is not recoverable later", String(rows2[0].email));
ok(rows2[0].is_private_email === true, "and so do the flags that came with it");
ok(rows2.length === 1, "still one row");

// ── the refusal that must never resolve itself ───────────────────────────────
console.log("\n── a contested Apple ID is refused, not re-pointed ──");
const stolen = await I.linkIdentity({ amberId: B, provider: "apple", subject: SUB });
ok(stolen.ok === false && stolen.reason === "subject_taken",
   "a second account claiming a live subject is refused", JSON.stringify(stolen));
const rows3 = await raw();
ok(rows3[0].amber_id === A,
   "and the row still belongs to the first account — this is the one that would "
   + "have handed over somebody's account", rows3[0].amber_id);

// ── find, list, touch ────────────────────────────────────────────────────────
console.log("\n── the reads ──");
const found = await I.findIdentity("apple", SUB);
ok(found?.amberId === A, "findIdentity resolves the pair");
ok((await I.findIdentity("apple", "nope")) === null, "and an unknown subject is null");
ok((await I.listIdentitiesForUser(A)).length === 1, "the account lists its one identity");
ok((await I.listIdentitiesForUser(B)).length === 0, "the other account lists none");

const before = (await raw())[0].last_used_at;
await new Promise((r) => setTimeout(r, 10));
await I.touchIdentity("apple", SUB);
const after = (await raw())[0].last_used_at;
ok(new Date(after) > new Date(before),
   "touchIdentity moves last_used_at — it took an id that was undefined, so the "
   + "UPDATE matched nothing and this never moved at all",
   JSON.stringify([before, after]));

// ── unlink, and the round trip that was impossible ───────────────────────────
console.log("\n── removing Sign in with Apple, then adding it back ──");
ok((await I.unlinkIdentity(A, "apple")) === 1, "unlink soft-deletes one row");
ok((await I.findIdentity("apple", SUB)) === null, "and the identity stops resolving");
ok((await I.listIdentitiesForUser(A)).length === 0, "and drops off the account");
ok((await raw()).length === 1, "the row is still there, marked, not erased");

const relink = await I.linkIdentity({
  amberId: A, provider: "apple", subject: SUB, email: null,
});
ok(relink.ok === true,
   "RE-LINKING WORKS. The old code answered subject_taken here, forever, because "
   + "the soft-deleted row raised a unique violation and then could not be found",
   JSON.stringify(relink));
const rows4 = await raw();
ok(rows4[0].deleted_at === null, "the row is revived rather than duplicated");
ok(rows4.length === 1, "still exactly one row", String(rows4.length));
ok(rows4[0].email === "alice@privaterelay.appleid.com",
   "and the email Apple will never send again is still there");

// ── a soft-deleted row may move to a different account ───────────────────────
console.log("\n── a released subject can be claimed by someone else ──");
await I.unlinkIdentity(A, "apple");
const toB = await I.linkIdentity({ amberId: B, provider: "apple", subject: SUB });
ok(toB.ok === true, "an unlinked subject is available to another account");
ok((await raw())[0].amber_id === B, "and moves");
ok((await I.findIdentity("apple", SUB)).amberId === B, "and resolves to them");
const backToA = await I.linkIdentity({ amberId: A, provider: "apple", subject: SUB });
ok(backToA.ok === false && backToA.reason === "subject_taken",
   "while it is live on B, A cannot take it back either — the rule is symmetric");

// ── an identity never creates a user ────────────────────────────────────────
console.log("\n── the invariant in the file header ──");
const orphan = await I.linkIdentity({
  amberId: "aaaaaaaa-0000-4000-8000-00000000ffff", provider: "apple", subject: "other.sub",
});
ok(orphan.ok === false && orphan.reason === "no_such_user",
   "linking to an amber_id with no users row is refused with a REASON, not a "
   + "thrown FK violation that 500s the route", JSON.stringify(orphan));
ok((await raw()).length === 1, "and no row was created");
ok((await I.linkIdentity({ provider: "apple", subject: "x" })).reason === "missing_args",
   "and a call with no account is refused before any SQL");

console.log(`\n  ${pass} passed, ${fail} failed\n`);
await closePool();
process.exit(fail ? 1 : 0);
