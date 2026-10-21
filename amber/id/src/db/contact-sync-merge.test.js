/**
 * APPLE CHANGES FLOW IN. AMBER EDITS ALWAYS WIN.
 *
 * Run with the rest: npm test
 *
 * Two instructions that read as contradictory and are not:
 *
 *   "It shouldn't override the edits you made in Amber. If I edited a contact in
 *    Amber and the old stale one is in Apple, that old stale one should not
 *    override the one I have in Amber."
 *
 *   "If I update Sagar's nickname or his notes or his birthday in Apple and then
 *    hit resync, Amber should see that update and update that information on the
 *    Sagar contact ID it already has."
 *
 * The invariant under both is NEVER LOSE AN AMBER EDIT. insert_only held it by
 * refusing to learn anything, which is why a contact renamed on the phone never
 * arrived. The three-way merge holds it while picking up real changes, using
 * contacts.sync_snapshot -- the values Amber last wrote -- as the baseline:
 *
 *   Amber blank                  -> take the incoming (fill a gap)
 *   Amber == what we last wrote  -> untouched here, take the incoming
 *   Amber != what we last wrote  -> edited here, Amber wins
 *   no baseline yet              -> Amber wins, every field
 *
 * THE TEST THAT MATTERS MOST IS `idempotence`. If the baseline fails to
 * round-trip byte-identically, every field reads as hand-edited forever, no
 * upstream change is ever picked up again, AND every sync issues an UPDATE for
 * every row in the address book -- reshuffling a contacts list that orders by
 * updated_at. Nothing else here would catch that.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { installFakeSql } from "./sql-fake-harness.js";

const sql = await installFakeSql();
const { upsertContactsForOwner } = await import("./store.js");

const OWNER = "amber_owner_1";
const OWNER_PHONE = "+13105559999";

// Indices into UPSERT_COLUMN_ORDER.
const NAME = 3;
const FIRST = 4;
const PHONE_PRIMARY = 6;
const PHONES_ALL = 7;
const EMAILS = 8;
const COMPANY = 9;
const NICKNAME = 12;
const BIRTHDAY = 13;
const SNAPSHOT = 14;

function card(over = {}) {
  return {
    externalId: "APPLE-1",
    name: "Sagar Patel",
    firstName: "Sagar",
    lastName: "Patel",
    phoneNumbers: ["+13105550100"],
    emails: [],
    company: null,
    source: "apple",
    ...over,
  };
}

const sync = (contacts, mode) =>
  upsertContactsForOwner({
    ownerId: OWNER,
    ownerPhone: OWNER_PHONE,
    contacts,
    ...(mode ? { mode } : {}),
  });

function stored(externalId = "APPLE-1") {
  return sql.state.contacts.get(`${OWNER}|${externalId}`)?.row ?? null;
}

function liveRow(externalId = "APPLE-1") {
  const id = sql.state.contacts.get(`${OWNER}|${externalId}`)?.id;
  return id == null ? null : sql.state.rows.get(String(id));
}

/** Statements that would MODIFY an existing contact row. */
function contactUpdates() {
  return sql
    .statementCalls()
    .filter((c) => /UPDATE contacts\b/.test(c.text) || /UPDATE contacts AS c SET/.test(c.text));
}

/** Edit a field the way the Amber editor does: straight onto the row. */
function editInAmber(patch, externalId = "APPLE-1") {
  const row = liveRow(externalId);
  assert.ok(row, "precondition: the row exists");
  Object.assign(row, patch);
}

// ── the Sagar case ──────────────────────────────────────────────────────────

test("a change made in Apple reaches the contact Amber already has", async () => {
  sql.resetFakeSql();
  await sync([card()]);
  assert.equal(stored()[COMPANY], null);
  const firstId = sql.state.contacts.get(`${OWNER}|APPLE-1`).id;

  // He adds a company on the phone and hits resync. Nothing was edited in Amber.
  await sync([card({ company: "Stripe" })]);

  assert.equal(stored()[COMPANY], "Stripe", "the device's update landed");
  assert.equal(
    sql.state.contacts.get(`${OWNER}|APPLE-1`).id,
    firstId,
    "on the SAME contact id it already had",
  );
});

test("a name changed on the phone renames the contact, when Amber never touched it", async () => {
  sql.resetFakeSql();
  await sync([card()]);
  await sync([card({ name: "Sagar R Patel", firstName: "Sagar", lastName: "R Patel" })]);
  assert.equal(stored()[NAME], "Sagar R Patel");
});

// ── the Amber edit always wins ──────────────────────────────────────────────

test("a name edited in Amber survives a re-sync carrying the device's OLD name", async () => {
  sql.resetFakeSql();
  await sync([card()]);
  editInAmber({ full_name: "Sags" });
  assert.equal(stored()[NAME], "Sags", "precondition: the edit landed");

  // The phone still says Sagar Patel. This is the moment that used to undo it.
  const res = await sync([card()]);

  assert.equal(stored()[NAME], "Sags", "the Amber edit stands");
  assert.equal(res.inserted, 0, "and no second Sagar was created");
});

test("an Amber edit on one field does not freeze the others", async () => {
  sql.resetFakeSql();
  await sync([card()]);
  editInAmber({ full_name: "Sags" });

  // The phone changes the COMPANY, which Amber never touched.
  await sync([card({ company: "Stripe" })]);

  assert.equal(stored()[NAME], "Sags", "the edited field is still his");
  assert.equal(stored()[COMPANY], "Stripe", "the untouched field took the update");
});

test("a gap in Amber fills from Apple even on a hand-edited contact", async () => {
  // "Unless there is some new information that does not overwrite the stuff I
  //  already have in Amber but simply adds on to it, then that's fine."
  sql.resetFakeSql();
  await sync([card()]);
  editInAmber({ full_name: "Sags", company: null });

  await sync([card({ company: "Stripe" })]);
  assert.equal(stored()[COMPANY], "Stripe");
  assert.equal(stored()[NAME], "Sags");
});

test("an empty string counts as blank, not as data", async () => {
  sql.resetFakeSql();
  await sync([card()]);
  editInAmber({ company: "" });
  await sync([card({ company: "Stripe" })]);
  assert.equal(stored()[COMPANY], "Stripe");
});

test("Apple clearing a field does not blank what Amber has", async () => {
  sql.resetFakeSql();
  await sync([card({ company: "Stripe" })]);
  assert.equal(stored()[COMPANY], "Stripe");

  // The card loses its company on the device. That is not evidence that Amber's
  // copy should be destroyed.
  await sync([card({ company: null })]);
  assert.equal(stored()[COMPANY], "Stripe");
});

// ── the safe first run, and convergence ─────────────────────────────────────

test("a row with no baseline is never overwritten, and gains one", async () => {
  // Every row that existed before this shipped has sync_snapshot NULL, so it
  // reads as hand-edited on every field: the first sync after the deploy behaves
  // exactly like insert-only. There is no window in which an existing edit can
  // be lost.
  sql.resetFakeSql();
  await sync([card()]);
  editInAmber({ full_name: "Sags", sync_snapshot: null });

  await sync([card({ name: "Sagar Patel", company: "Stripe" })]);
  assert.equal(stored()[NAME], "Sags", "no baseline: Amber wins");
  assert.ok(stored()[SNAPSHOT], "and a baseline was recorded");
});

test("with a baseline recorded, the NEXT device change lands", async () => {
  sql.resetFakeSql();
  await sync([card()]);
  editInAmber({ sync_snapshot: null });

  // Sync one after the deploy: records the baseline, changes nothing it should not.
  await sync([card()]);
  // Sync two: now a real device change is distinguishable from a local edit.
  await sync([card({ name: "Sagar R Patel" })]);
  assert.equal(stored()[NAME], "Sagar R Patel");
});

// ── idempotence. the one that guards the whole design. ──────────────────────

test("a second identical sync issues ZERO updates", async () => {
  sql.resetFakeSql();
  await sync([card()]);

  sql.resetFakeSqlCalls();
  const res = await sync([card()]);

  assert.deepEqual(contactUpdates(), [], "an unchanged re-sync must not write");
  assert.equal(res.unchanged, 1);
  assert.equal(res.updated ?? 0, 0);
});

test("ten identical syncs issue zero updates and keep one row", async () => {
  // If the baseline does not round-trip byte-identically this fails loudly here
  // rather than silently rewriting the address book forever.
  sql.resetFakeSql();
  await sync([card()]);
  sql.resetFakeSqlCalls();
  for (let i = 0; i < 10; i += 1) await sync([card()]);
  assert.deepEqual(contactUpdates(), []);
  assert.equal(sql.state.contacts.size, 1);
});

test("updated_at does not move when only the baseline advances", async () => {
  sql.resetFakeSql();
  await sync([card()]);
  editInAmber({ full_name: "Sags" });
  const before = liveRow().updated_at;

  // The device changes the name Amber has already diverged on. Amber wins, so
  // nothing the user can see changed -- and a contacts list orders by
  // updated_at, so bumping it would reshuffle their list for no reason.
  await sync([card({ name: "Sagar Patel Jr" })]);
  assert.equal(stored()[NAME], "Sags");
  assert.equal(liveRow().updated_at, before, "updated_at must not move");
});

// ── lists never lose a value ────────────────────────────────────────────────

test("a phone added on the device is appended, never replacing the list", async () => {
  sql.resetFakeSql();
  await sync([card({ phoneNumbers: ["+13105550100"] })]);
  await sync([card({ phoneNumbers: ["+13105550100", "+13105550199"] })]);
  const all = stored()[PHONES_ALL] ?? "";
  assert.ok(all.includes("3105550100"), all);
  assert.ok(all.includes("3105550199"), all);
});

test("a phone only Amber has is kept when the device sends a different list", async () => {
  sql.resetFakeSql();
  await sync([card({ phoneNumbers: ["+13105550100"] })]);
  editInAmber({ phones_all: "+13105550100, +13105550777" });
  await sync([card({ phoneNumbers: ["+13105550100", "+13105550199"] })]);
  const all = stored()[PHONES_ALL] ?? "";
  for (const want of ["3105550100", "3105550777", "3105550199"]) {
    assert.ok(all.includes(want), `${want} missing from ${all}`);
  }
});

test("an email only Amber has is never dropped", async () => {
  sql.resetFakeSql();
  await sync([card({ emails: ["sagar@apple.example"] })]);
  editInAmber({ emails: "sagar@apple.example, sagar@amber.example" });
  await sync([card({ emails: ["sagar@apple.example"] })]);
  const emails = stored()[EMAILS] ?? "";
  assert.ok(emails.includes("sagar@amber.example"), emails);
  assert.ok(emails.includes("sagar@apple.example"), emails);
});

// ── other writers must not wipe the baseline ────────────────────────────────

test("a non-authoritative merge leaves the baseline alone", async () => {
  // A row matched by PHONE from a different card is enrichment, not the source
  // restating itself. It may fill blanks, it may not overwrite, and crucially it
  // must not erase the baseline -- if it did, Amber would win every field
  // forever afterwards and no device change would ever be seen again.
  sql.resetFakeSql();
  await sync([card()]);
  const baseline = stored()[SNAPSHOT];
  assert.ok(baseline);

  // Same person, different source and different external id: resolves by phone.
  await sync([
    {
      externalId: "GOOG-9",
      name: "Sagar Patel",
      phoneNumbers: ["+13105550100"],
      emails: ["sagar@google.example"],
      source: "google",
    },
  ]);

  assert.equal(stored()[SNAPSHOT], baseline, "the baseline survived the other writer");
});

// ── insert-only still means insert-only ─────────────────────────────────────

test("the insert_only kill switch still refuses every edit", async () => {
  sql.resetFakeSql();
  await sync([card()]);
  editInAmber({ full_name: "Sags" });

  sql.resetFakeSqlCalls();
  const res = await sync([card({ name: "Sagar Patel", company: "Stripe" })], "insert_only");

  assert.equal(stored()[NAME], "Sags");
  assert.equal(stored()[COMPANY], null, "insert-only does not even fill a gap");
  assert.equal(res.unchanged, 1);
  assert.equal(res.inserted, 0);
});

// ── the collision tail ──────────────────────────────────────────────────────

test("a planner miss fills blanks and cannot rename anybody", async () => {
  // This statement only runs for a cluster the planner called NEW. If it
  // collides, the planner was wrong -- and a wrong planner is the last thing
  // that should be trusted to overwrite a name. The old tail did exactly that.
  sql.resetFakeSql();
  await sync([card()]);
  editInAmber({ full_name: "Sags", company: null });

  const id = sql.state.contacts.get(`${OWNER}|APPLE-1`).id;
  sql.state.hiddenFromIndexLoad.add(String(id));
  const res = await sync([card({ name: "Sagar Patel", company: "Stripe" })]);
  sql.state.hiddenFromIndexLoad.delete(String(id));

  assert.equal(stored()[NAME], "Sags", "a collision must not rename");
  assert.equal(stored()[COMPANY], "Stripe", "but a blank column still fills");
  assert.equal(res.failed, 0, "and the row is still returned, not counted as a failure");
  assert.equal(sql.state.contacts.size, 1, "no duplicate row");
});

// ── new contacts still arrive ───────────────────────────────────────────────

test("a contact that is new in Apple and absent from Amber is inserted", async () => {
  sql.resetFakeSql();
  await sync([card()]);
  const res = await sync([
    card(),
    card({ externalId: "APPLE-2", name: "Nina Gupta", firstName: "Nina", lastName: "Gupta", phoneNumbers: ["+13105550200"] }),
  ]);
  assert.equal(res.inserted, 1);
  assert.equal(sql.state.contacts.size, 2);
  assert.equal(stored("APPLE-2")[NAME], "Nina Gupta");
});

test("a fresh row carries a baseline from the moment it is inserted", async () => {
  // Without this every new contact would need one throwaway sync before an
  // upstream change could reach it.
  sql.resetFakeSql();
  await sync([card()]);
  const snap = JSON.parse(stored()[SNAPSHOT]);
  assert.equal(snap.full_name, "Sagar Patel");
  assert.equal(snap.first_name, "Sagar");
  // Fixed key order is what makes the comparison byte-stable.
  assert.deepEqual(Object.keys(snap), [
    "full_name",
    "first_name",
    "last_name",
    "company",
    "phone_primary",
    "phones_all",
    "emails",
    "nickname",
    "birthday",
  ]);
});

// ── the three fields he named ───────────────────────────────────────────────

test("a nickname set in Apple reaches the contact Amber already has", async () => {
  sql.resetFakeSql();
  await sync([card()]);
  assert.equal(stored()[NICKNAME], null);
  await sync([card({ nickname: "Sags" })]);
  assert.equal(stored()[NICKNAME], "Sags");
});

test("a nickname edited in Amber is not overwritten by the device's old one", async () => {
  sql.resetFakeSql();
  await sync([card({ nickname: "Sagar" })]);
  editInAmber({ nickname: "Sags" });
  await sync([card({ nickname: "Sagar" })]);
  assert.equal(stored()[NICKNAME], "Sags");
});

test("a birthday set in Apple lands, and does not churn on the next sync", async () => {
  // pg hands timestamptz back as a Date and the wire value is "YYYY-MM-DD", so a
  // raw comparison is always unequal -- which would UPDATE every contact with a
  // birthday on every single sync, forever. This is that guard.
  sql.resetFakeSql();
  await sync([card()]);
  await sync([card({ birthday: "1996-03-14" })]);
  assert.equal(stored()[BIRTHDAY], "1996-03-14");

  sql.resetFakeSqlCalls();
  await sync([card({ birthday: "1996-03-14" })]);
  assert.deepEqual(contactUpdates(), [], "an unchanged birthday must not write");
});

test("a birthday already in Amber is never replaced by the device", async () => {
  sql.resetFakeSql();
  await sync([card({ birthday: "1996-03-14" })]);
  editInAmber({ birthday: "1996-03-15" });
  await sync([card({ birthday: "1996-03-14" })]);
  assert.equal(stored()[BIRTHDAY], "1996-03-15");
});
