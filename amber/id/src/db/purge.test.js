/**
 * What "delete my account" actually deletes, and what it is allowed to call a
 * success. The query function is injected, so nothing here touches a database.
 *
 * Run with:  node --test src/db/purge.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { readdirSync, readFileSync } from "node:fs";
import { purgeOwnerData, OWNER_SCOPED_TABLES } from "./purge.js";

const AMBER = "11111111-2222-3333-4444-555555555555";

function recorder({ fail = () => null } = {}) {
  const calls = [];
  const queryImpl = async (sql, params) => {
    calls.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
    const err = fail(sql);
    if (err) throw err;
    return { rowCount: 1 };
  };
  return { calls, queryImpl };
}

const pgError = (code) => Object.assign(new Error(`pg ${code}`), { code });

test("the tables that hold the most sensitive data are covered", () => {
  // These were ALL missing once, which meant a deleted account left behind its
  // voice note transcripts, the audio itself, its push tokens and a live Clay
  // webhook credential. A regression here is a privacy incident, so it is
  // asserted -- and asserted by NAME, which is why this list had to change when
  // the tables did. A purge list naming tables that no longer exist deletes
  // nothing and reports every miss as a skip, which looks like success.
  for (const t of [
    "conversation_messages",
    "conversations",
    "media_assets",
    "observations",
    "push_tokens",
    "clay_destinations",
    "contacts",
  ]) {
    assert.ok(OWNER_SCOPED_TABLES.includes(t), `${t} must be purged`);
  }
  // contacts must stay last: its children are deleted before it so a foreign key
  // without ON DELETE CASCADE cannot block the delete.
  assert.equal(OWNER_SCOPED_TABLES[OWNER_SCOPED_TABLES.length - 1], "contacts");
});

test("a clean run deletes everything, frees the user row, and reports no errors", async () => {
  const { calls, queryImpl } = recorder();
  const res = await purgeOwnerData(AMBER, { queryImpl, privyDid: "did:privy:x", phone: "+13105550100" });
  assert.deepEqual(res.errors, []);
  assert.equal(res.userRowDeleted, true);
  // The user row is deleted LAST, so the phone is freed only once the data is gone.
  assert.match(calls[calls.length - 1].sql, /DELETE FROM users WHERE amber_id/);
  // Every owner-scoped table was attempted.
  for (const t of OWNER_SCOPED_TABLES) {
    assert.ok(calls.some((c) => c.sql.startsWith(`DELETE FROM ${t} WHERE owner_id`)), t);
  }
});

test("a table this deployment never created is a SKIP, not an error", async () => {
  // The purge list is deliberately broader than any one schema. Counting a
  // missing table as a failure would make every delete return 500.
  const { queryImpl } = recorder({
    fail: (sql) => (sql.includes("voice_vocabulary") ? pgError("42P01") : null),
  });
  const res = await purgeOwnerData(AMBER, { queryImpl });
  assert.deepEqual(res.errors, []);
  assert.ok(res.skipped.includes("voice_vocabulary"));
  assert.equal(res.userRowDeleted, true);
});

test("a missing COLUMN is also a skip", async () => {
  const { queryImpl } = recorder({
    fail: (sql) => (sql.includes("push_tokens") ? pgError("42703") : null),
  });
  const res = await purgeOwnerData(AMBER, { queryImpl });
  assert.deepEqual(res.errors, []);
  assert.ok(res.skipped.includes("push_tokens"));
});

test("a real failure is reported with its code and never silently swallowed", async () => {
  // Permission denied on the table that holds every transcript. Before this,
  // purgeOwnerData caught it bare and the route reported a completed deletion.
  const { queryImpl } = recorder({
    fail: (sql) => (sql.includes("conversation_messages") ? pgError("42501") : null),
  });
  const res = await purgeOwnerData(AMBER, { queryImpl });
  assert.equal(res.errors.length, 1);
  assert.equal(res.errors[0].label, "conversation_messages");
  assert.equal(res.errors[0].code, "42501");
  // The rest of the purge still runs — one bad table does not abandon the sweep.
  assert.equal(res.userRowDeleted, true);
});

test("a failed users delete means the account still exists", async () => {
  const { queryImpl } = recorder({
    fail: (sql) => (sql.includes("FROM users") ? pgError("40001") : null),
  });
  const res = await purgeOwnerData(AMBER, { queryImpl });
  assert.equal(res.userRowDeleted, false);
});

test("deleting zero user rows is a success, not a failure", async () => {
  // rowCount 0 means there is no such row, which is the state we wanted.
  const calls = [];
  const res = await purgeOwnerData(AMBER, {
    queryImpl: async (sql, params) => {
      calls.push(sql);
      return { rowCount: 0 };
    },
  });
  assert.equal(res.userRowDeleted, true);
  assert.deepEqual(res.errors, []);
});

test("device sessions, OTP codes and the Slack link are purged from the identity", async () => {
  const { calls, queryImpl } = recorder();
  await purgeOwnerData(AMBER, { queryImpl, privyDid: "did:privy:abc", phone: "+13105550100" });
  const sqls = calls.map((c) => c.sql);
  // A refresh token that outlives the account it belongs to is a live session
  // for a deleted user.
  assert.ok(sqls.some((q) => /DELETE FROM device_sessions WHERE subject_id/.test(q)));
  assert.ok(sqls.some((q) => /DELETE FROM device_sessions WHERE phone/.test(q)));
  assert.ok(sqls.some((q) => /DELETE FROM otp_codes WHERE phone/.test(q)));
  assert.ok(sqls.some((q) => /DELETE FROM slack_links WHERE phone_e164/.test(q)));
  // Scoped to this caller, never a bare DELETE.
  for (const c of calls) assert.ok(c.params.length === 1, c.sql);
});

test("without a DID or phone the identity-scoped deletes are skipped, not run unscoped", async () => {
  const { calls, queryImpl } = recorder();
  await purgeOwnerData(AMBER, { queryImpl });
  const sqls = calls.map((c) => c.sql).join(" | ");
  assert.ok(!sqls.includes("device_sessions"));
  assert.ok(!sqls.includes("otp_codes"));
  assert.ok(!sqls.includes("slack_links"));
});

test("reactions and comments are deleted from BOTH sides", async () => {
  const { calls, queryImpl } = recorder();
  await purgeOwnerData(AMBER, { queryImpl });
  const sqls = calls.map((c) => c.sql);
  // ONE SIDE NOW, NOT BOTH, and the change is the point. A reaction on the
  // user's OWN note hangs off a conversation they own, which is deleted above
  // and cascades by foreign key. What does NOT cascade is a reaction they left
  // on somebody else's note -- that parent belongs to another account and must
  // survive. So the explicit delete covers the reactor/author side only, and the
  // old "BOTH sides" query would now be deleting rows the cascade already took.
  assert.ok(sqls.some((q) => /conversation_reactions WHERE reactor_amber_id = \$1/.test(q)));
  assert.ok(sqls.some((q) => /conversation_comments WHERE author_amber_id = \$1/.test(q)));
  assert.ok(sqls.some((q) => /dm_reactions WHERE reactor_amber_id = \$1/.test(q)));
});

test("no amberId means no queries at all", async () => {
  const { calls, queryImpl } = recorder();
  const res = await purgeOwnerData(null, { queryImpl, phone: "+13105550100" });
  assert.equal(calls.length, 0);
  assert.equal(res.userRowDeleted, false);
});

// ── The recordings, not just the rows ────────────────────────────────────────
//
// Deleting a media_assets row makes a recording unreachable and leaves the BYTES
// in the bucket forever, with nothing left pointing at them. For a product whose
// most sensitive content is voice recordings, and which has to satisfy an App
// Store requirement that deleting an account deletes the user's data, that is
// not housekeeping. These tests pin the parts that are easy to get subtly wrong.

function storageRecorder({ failObject = null } = {}) {
  const order = [];
  const deletedObjects = [];
  // Per-table keys, because that is how the real tables look: media_assets holds
  // notes/<owner>/..., profile_voice_bios holds voice-bios/<owner>/...
  const byTable = {
    media_assets: ['notes/o/a.m4a'],
    profile_voice_bios: ['voice-bios/o/b.m4a'],
  };
  const queryImpl = async (sql, params) => {
    const flat = sql.replace(/\s+/g, ' ').trim();
    order.push(flat);
    if (flat.startsWith('SELECT storage_key')) {
      // Only ever the owner's own rows.
      assert.deepEqual(params, [AMBER]);
      const table = Object.keys(byTable).find((t) => flat.includes(`FROM ${t} `));
      const keys = byTable[table] ?? [];
      return { rowCount: keys.length, rows: keys.map((k) => ({ storage_key: k })) };
    }
    return { rowCount: 1 };
  };
  const deleteObject = async (key) => {
    order.push(`DELETE_OBJECT ${key}`);
    if (failObject && failObject(key)) throw new Error(`bucket said no: ${key}`);
    deletedObjects.push(key);
  };
  return { order, deletedObjects, queryImpl, deleteObject };
}

test('the keys are read BEFORE the rows go and the objects deleted AFTER', async () => {
  // The order is the whole design. Read after the deletes and there is nothing
  // left to read from; delete the objects first and a purge that then fails has
  // destroyed a live account's recordings.
  const r = storageRecorder();
  const out = await purgeOwnerData(AMBER, {
    queryImpl: r.queryImpl,
    deleteObject: r.deleteObject,
    storageConfigured: () => true,
  });
  const firstRead = r.order.findIndex((s) => s.startsWith('SELECT storage_key'));
  const firstRowDelete = r.order.findIndex((s) => s.startsWith('DELETE FROM'));
  const firstObjectDelete = r.order.findIndex((s) => s.startsWith('DELETE_OBJECT'));
  assert.ok(firstRead >= 0 && firstRowDelete >= 0 && firstObjectDelete >= 0);
  assert.ok(firstRead < firstRowDelete, 'keys must be read before any row is deleted');
  assert.ok(firstRowDelete < firstObjectDelete, 'objects must go after the rows');
  assert.equal(out.storageObjectsDeleted, 2);
  assert.deepEqual(out.storageErrors, []);
});

test('both storage-bearing tables are read', async () => {
  const r = storageRecorder();
  await purgeOwnerData(AMBER, {
    queryImpl: r.queryImpl,
    deleteObject: r.deleteObject,
    storageConfigured: () => true,
  });
  const reads = r.order.filter((s) => s.startsWith('SELECT storage_key'));
  assert.ok(reads.some((s) => s.includes('FROM media_assets')));
  assert.ok(reads.some((s) => s.includes('FROM profile_voice_bios')));
});

test('a bucket failure is NOT reported as a failed deletion', async () => {
  // `errors` is what the delete-account route turns into "your account was not
  // deleted". A leftover object is not a surviving account, and conflating the
  // two would start reporting successful purges as failures.
  const r = storageRecorder({ failObject: (k) => k.startsWith('notes/') });
  const out = await purgeOwnerData(AMBER, {
    queryImpl: r.queryImpl,
    deleteObject: r.deleteObject,
    storageConfigured: () => true,
  });
  assert.deepEqual(out.errors, []);
  assert.equal(out.userRowDeleted, true);
  // One failed, and the OTHER still went -- one bad object must not strand the rest.
  assert.equal(out.storageErrors.length, 1);
  assert.equal(out.storageObjectsDeleted, 1);
  assert.deepEqual(r.deletedObjects, ['voice-bios/o/b.m4a']);
});

test('no storage configured: says so, deletes nothing, still purges', async () => {
  const r = storageRecorder();
  const out = await purgeOwnerData(AMBER, {
    queryImpl: r.queryImpl,
    deleteObject: r.deleteObject,
    storageConfigured: () => false,
  });
  assert.equal(out.storageObjectsDeleted, 0);
  assert.equal(out.storageErrors.length, 1);
  assert.match(out.storageErrors[0].message, /left in place/);
  assert.equal(out.userRowDeleted, true);
  assert.equal(r.deletedObjects.length, 0);
});

test('a deployment without profile_voice_bios skips it silently', async () => {
  const queryImpl = async (sql) => {
    const flat = sql.replace(/\s+/g, ' ').trim();
    if (flat.includes('SELECT storage_key') && flat.includes('profile_voice_bios')) {
      throw pgError('42P01');
    }
    if (flat.startsWith('SELECT storage_key')) {
      return { rowCount: 1, rows: [{ storage_key: 'notes/o/a.m4a' }] };
    }
    return { rowCount: 1 };
  };
  const out = await purgeOwnerData(AMBER, {
    queryImpl,
    deleteObject: async () => {},
    storageConfigured: () => true,
  });
  // A table this deployment never created is a skip, not an error.
  assert.deepEqual(out.storageErrors, []);
  assert.equal(out.storageObjectsDeleted, 1);
});

test('the new tables are in the purge list by name, not by cascade', () => {
  // Both would in fact cascade -- circle_favorites from circles,
  // profile_voice_bios from users -- but a table removed only as a side effect
  // of someone else's ON DELETE CASCADE is one FK change away from silently
  // surviving account deletion. This list is what anyone reads to answer "what
  // does delete-my-account actually delete".
  for (const t of ['circle_favorites', 'profile_voice_bios']) {
    assert.ok(OWNER_SCOPED_TABLES.includes(t), `${t} missing from the purge list`);
  }
});

/**
 * NO TABLE THAT HOLDS SOMEBODY'S UUID GETS TO BE FORGOTTEN.
 *
 * This is a structural test rather than a list, because the failure it catches
 * is precisely the failure of a list: post_reactions and post_comments shipped
 * in migration 044 and were not added here, so "delete my account" left the
 * account's uuid attached to other people's feeds. Nothing was wrong with the
 * purge code; a human simply did not think of two new tables.
 *
 * So the migrations are read, every table carrying a column that names a PERSON
 * (reactor_amber_id, author_amber_id, owner_id and friends) is collected, and
 * each one must appear somewhere in purge.js -- either in OWNER_SCOPED_TABLES or
 * in a hand-written DELETE. A new table of that shape fails this on the day it
 * is created, which is the day somebody can still remember what it is for.
 */
test("EVERY TABLE KEYED ON A PERSON IS IN THE PURGE, INCLUDING ONES ADDED LATER", () => {
  const dir = new URL("../../db/migrations/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
  const sql = files.map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");
  const purgeSrc = readFileSync(new URL("./purge.js", import.meta.url), "utf8");

  // Columns that mean "this row belongs to, or was written by, a person".
  // A TABLE THAT BELONGS TO TWO PEOPLE HAS NO OWNER COLUMN.
  //
  // This list used to name only owner-ish columns, and the whole direct-message
  // graph slipped past it: dm_threads is keyed on a_amber_id/b_amber_id,
  // dm_messages on sender_amber_id, dm_reads and dm_clears on a bare amber_id.
  // Every one of them held user data -- including message bodies and voice-note
  // storage keys -- and none was purged, because the guard was looking for a
  // shape those tables do not have.
  const PERSON_COLUMNS =
    /\b(owner_id|owner_amber_id|amber_id|a_amber_id|b_amber_id|sender_amber_id|reactor_amber_id|author_amber_id|requester_amber_id|addressee_amber_id|viewer_amber_id|blocker_amber_id|blocked_amber_id|subject_id)\b/;

  /**
   * Tables that are deliberately NOT purged by amber_id, each with the reason.
   * Anything not on this list and not in purge.js fails, so an exemption is a
   * line somebody has to write and a reviewer can argue with.
   */
  const EXEMPT = new Map([
    ["users", "the account row itself, deleted last by purgeOwnerData"],
    ["event_participants", "cascades from events, which is owner-scoped"],
    ["circle_invites", "cascades from circles"],
    ["schema_migrations", "not user data"],

    /*
     * SAFETY RECORDS, DELIBERATELY RETAINED.
     *
     * An abuse report is not the reported person's data to erase. If deleting
     * an account cleared the reports filed about it, "delete and re-register"
     * would be a one-step way to wipe your own record, and the people who filed
     * those reports would have done it for nothing. Same argument for the
     * blocks made AGAINST this person: somebody else decided they did not want
     * to hear from them, and that decision has to outlive the account.
     *
     * purge.js DOES delete the blocks this person made, and the reports they
     * filed keep their reporter_amber_id pointing at a deleted user, which is
     * the correct end state: the report survives, the account does not.
     *
     * The audit log is the record of what was done TO accounts, including this
     * deletion. Purging it would delete the evidence that the purge happened.
     */
    /*
     * THE COMPANY IS NOT THE EMPLOYEE'S DATA TO DELETE.
     *
     * These four match the person-column pattern on a REFERENCES clause rather
     * than on a column of their own: organizations.created_by, org_groups and
     * org_policy's created_by/updated_by, org_invites' invited_by/accepted_by.
     * Every one of them is a nullable provenance pointer declared ON DELETE SET
     * NULL, so the uuid does NOT survive the purge -- the database clears it
     * when the users row goes, which happens last.
     *
     * What survives is the company itself: its groups, its ceiling, and the
     * record that invitations were issued. That is deliberate. An admin
     * deleting their own account must not take their employer's organization
     * with it, and the invite history is the record of what was done to
     * accounts -- the same argument audit_log is exempt under.
     *
     * The membership rows themselves ARE purged, by name, in purge.js:
     * org_members, org_group_members and email_login_tokens all carry a real
     * amber_id column and all three are deleted there.
     */
    /*
     * A LINK BETWEEN TWO OTHER PEOPLE IS NOT THE AUTHOR'S TO DELETE.
     *
     * "Sagar introduced me to Jonah" is a fact about Sagar and Jonah. The
     * colleague who wrote it down leaving the company does not unmake the
     * introduction, and erasing it would quietly remove the company's own
     * record of how it came to know somebody. Only the authorship is
     * personal, and created_by is declared ON DELETE SET NULL, so the
     * database clears that uuid when the users row goes -- the same argument
     * organizations is exempt under, for the same reason.
     */
    ["org_person_links", "a claim about two other people; created_by is ON DELETE SET NULL"],
    ["organizations", "company record; created_by is ON DELETE SET NULL, membership is purged separately"],
    ["org_groups", "company record; created_by is ON DELETE SET NULL"],
    ["org_policy", "company record; updated_by is ON DELETE SET NULL"],
    ["org_invites", "record that an invitation happened; both person columns are ON DELETE SET NULL"],

    /*
     * WHAT THE COMPANY KNOWS IS NOT THE EMPLOYEE'S DATA TO DELETE EITHER, and
     * this one is worth more than a line because the rows contain prose the
     * person wrote rather than a name they typed into a field.
     *
     * A runbook is written to outlive whoever wrote it. That is the only
     * reason a company wiki exists, and an account deletion that blanked every
     * page its author had touched would be a delete button that takes the
     * company's operating knowledge with it -- which is not what anybody means
     * by "delete my account", and is a thing a departing employee could do on
     * their way out. Same for the feed: an answer was written to somebody else
     * who needed it, and it is read by the person who asked.
     *
     * The uuid does not survive. created_by, updated_by, author_id and
     * uploaded_by are every person column on these four tables and all of them
     * are declared ON DELETE SET NULL, so the pages stay and the authorship
     * pointer is cleared by the database when the users row goes. The
     * contributor bar then reads "Unknown", which is the honest rendering of a
     * contribution by an account that no longer exists.
     *
     * THE LINE THIS DOES NOT CROSS: direct messages, which are two-party and
     * private, ARE purged in full a few lines down in purge.js. The difference
     * is who the writing was addressed to -- a company, or one other person.
     */
    ["org_pages", "company knowledge; created_by/updated_by are ON DELETE SET NULL"],
    ["org_page_revisions", "the contribution ledger under the pages; author_id is ON DELETE SET NULL"],
    ["org_page_attachments", "files on a company page; uploaded_by is ON DELETE SET NULL"],
    ["org_posts", "written to colleagues who still read it; author_id is ON DELETE SET NULL"],
    // Same argument as org_groups, which it is an edge between: the shape of
    // the company is the company's, and created_by is ON DELETE SET NULL.
    ["org_group_links", "company record; created_by is ON DELETE SET NULL"],

    /*
     * A SHARE LINK BELONGS TO THE PAGE, NOT TO WHOEVER PRESSED THE BUTTON.
     *
     * Deleting an account must not silently break every URL a departing
     * colleague had handed to customers -- that is the company's page and
     * the company's link, and turning it off is a decision somebody makes
     * on purpose rather than a side effect of an HR event. The link dies
     * with the PAGE (ON DELETE CASCADE on page_id) or when somebody revokes
     * it, which are the two moments anybody would expect.
     *
     * created_by is ON DELETE SET NULL, so the uuid does not survive: the
     * link stays, and who made it becomes unknown.
     */
    ["org_page_links", "the page's link, not its author's; created_by is ON DELETE SET NULL"],

    /*
     * THE TEAM'S WORKING CONTEXT OUTLIVES THE PERSON WHO TYPED IT.
     *
     * A connection is a URL the team uses -- the repo, the shared drive, the
     * CRM -- and an account deletion that took the repo link with it would be
     * a delete button that removes a company's bookmarks. Same for a team
     * event: the standup belongs to the team, not to whoever created the row,
     * which is exactly why org_group_events is its own table rather than an
     * owner-scoped `events` row that would CASCADE away.
     *
     * created_by is ON DELETE SET NULL on both, so the uuid does not survive
     * the purge -- the database clears it when the users row goes.
     */
    ["org_connections", "where the team's work lives; created_by is ON DELETE SET NULL"],
    ["org_group_events", "the team's own events, which outlive whoever typed them; created_by is ON DELETE SET NULL"],

    /*
     * A CREDENTIAL THAT STOPS WORKING WHEN SOMEBODY LEAVES IS THE BUG, NOT THE
     * FEATURE.
     *
     * The entire reason org_api_keys exists alongside the per-person
     * user_api_keys is that a company's nightly sync must not break because
     * the engineer who set it up resigned. Purging the key on account
     * deletion would reintroduce exactly the failure the table was added to
     * prevent -- and silently, on a Saturday.
     *
     * The person's uuid does not survive either way: created_by and
     * revoked_by are both ON DELETE SET NULL, so the database clears the
     * attribution when the users row goes and the key keeps authenticating
     * under the company that owns it. Revoking a departing colleague's keys
     * is an offboarding decision an admin makes deliberately, on the
     * Connectors page, which is where that judgment belongs.
     *
     * Same argument for a connector: "this company uses Salesforce" is a fact
     * about the company, and connected_by is ON DELETE SET NULL.
     */
    ["org_api_keys", "the company's credential, which must outlive its author; created_by/revoked_by are ON DELETE SET NULL"],
    ["org_connectors", "which products the company uses; connected_by is ON DELETE SET NULL"],

    /*
     * THE COMPANY'S RECORD OF ITS OWN RELATIONSHIPS.
     *
     * org_people is a contact the COMPANY deals with -- a prospect, a
     * customer, somebody's counterpart at a partner. It is not the employee's
     * to take with them, and an account deletion that removed every contact a
     * departing rep had ever owned would be a delete button that empties the
     * pipeline. owner_id is ON DELETE SET NULL, so the uuid does not survive;
     * the contact does, with no owner, which is both true and the thing an
     * admin needs to see so they can reassign it.
     *
     * org_interactions is the same argument with more force. "A meeting
     * happened with this customer on the fourteenth" is a fact about the
     * company, it is what every compliance and audit claim in this product
     * rests on, and a ledger that can be edited by leaving is not a ledger.
     * member_id is ON DELETE SET NULL, so it stops saying WHO without
     * pretending the meeting did not happen.
     *
     * The halves that ARE the person's -- their consent to feed a source,
     * the interactions that arrived under it, and their derived edges -- are
     * deleted in purge.js, which is the line this exemption sits on the far
     * side of.
     */
    ["org_people", "the company's contacts, not the employee's; owner_id is ON DELETE SET NULL"],
    ["org_memory_policy", "the COMPANY's rules, not a person's. updated_by is ON DELETE SET NULL: the admin who set a retention window leaving does not repeal it."],
    ["org_policy_refusals", "the evidence that the gate stopped something. Deleting it when the person who tripped it leaves would make the audit trail selectively forgetful, which is worse than not having one. amber_id is ON DELETE SET NULL."],
    ["org_interaction_shares", "a share is an act of publication: once made it belongs to the company, so it survives the author leaving (shared_by is ON DELETE SET NULL). Cascading it would erase team-published research the moment somebody resigns, which is the exact loss this product exists to prevent."],
    ["org_accounts", "the firms the COMPANY has relationships with; a departing employee stops owning one, they do not take it with them. owner_id is ON DELETE SET NULL, which is the whole point of the account model: the relationship outlives the rep."],
    ["org_interactions", "the append-only record the audit trail rests on; member_id is ON DELETE SET NULL"],

    ["abuse_reports", "safety record; deleting an account must not erase reports about it"],
    ["blocked_handles", "blocks MADE are purged; blocks RECEIVED outlive the account on purpose"],
    ["audit_log", "the record of what was done to accounts, including this deletion"],
  ]);

  const missing = [];
  for (const m of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?["']?(\w+)["']?\s*\(([\s\S]*?)\n\);/g)) {
    const [, table, body] = m;
    if (!PERSON_COLUMNS.test(body)) continue;
    if (EXEMPT.has(table)) continue;
    // Named in the owner-scoped list, or in a DELETE FROM somewhere in the file.
    const covered =
      OWNER_SCOPED_TABLES.includes(table) ||
      new RegExp(`DELETE FROM ${table}\\b`).test(purgeSrc);
    if (!covered) missing.push(table);
  }

  assert.deepEqual(
    missing,
    [],
    `these tables hold a person's uuid and delete-my-account leaves it behind:\n  ${missing.join("\n  ")}`,
  );
});
