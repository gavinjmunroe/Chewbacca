/**
 * Response-contract tests for the two contact-sync routes.
 *
 *   POST /v1/me/contacts                 (Apple import)
 *   POST /v1/me/contacts/import/google   (Google import)
 *
 * Both must report what the dedup actually did — merged / deduped / removed —
 * plus the owner's live per-source totals, WITHOUT dropping the fields clients
 * already read (`ok` + `upserted` for Apple; the importer's own counts for
 * Google). Run against Fastify inject() with the real store on the in-memory SQL
 * fake, so the numbers in the response come from a real write path rather than
 * from a stub.
 *
 * Only two collaborators are replaced: `requireAuth` (no Privy token here) and
 * the Google fetcher (no network). Everything else — resolveAmberIdByPhone,
 * upsertContactsForOwner, mergeContact, countLiveContactsBySource — is real.
 *
 * Run with:  node --test src/routes/contacts-sync-response.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { installFakeSql } from "../db/sql-fake-harness.js";

const OWNER_PHONE = "+13105559999";

const sql = await installFakeSql({
  stubs: {
    // Inherit the real module, override only the auth preHandler.
    "/src/lib/auth-session.js": `
      export * from "PASSTHROUGH";
      export const requireAuth = async (request) => {
        request.privyUser = globalThis.__TEST_SESSION__;
      };
    `,
    // Inherit the real module (isJunk, normalizePerson, importContactRecords all
    // stay real); only the network-facing fetch is replaced, and the importer is
    // re-implemented on top of the REAL importContactRecords so the counts under
    // test are genuinely computed.
    "/src/lib/google-contacts.js": `
      import * as real from "PASSTHROUGH";
      export * from "PASSTHROUGH";
      export async function importGoogleContactsForOwner(ownerId) {
        const canned = globalThis.__TEST_GOOGLE__;
        if (!canned) return { connected: false };
        let filtered = 0;
        const keep = [];
        for (const c of canned.records) {
          if (real.isJunk(c)) { filtered += 1; continue; }
          keep.push(c);
        }
        const counts = await real.importContactRecords(ownerId, keep);
        return {
          connected: true,
          otherContactsScope: true,
          fetched: keep.length,
          created: counts.created,
          merged: counts.merged,
          updated: counts.updated,
          deduped: counts.deduped,
          failed: counts.failed,
          removed: filtered,
          filteredCount: filtered,
        };
      }
    `,
  },
});

const { registerProfileRoutes } = await import("./profile.js");
const { invalidateIdentityIndex } = await import("../db/contact-identity.js");

async function buildApp() {
  const app = Fastify({ logger: false });
  registerProfileRoutes(app);
  await app.ready();
  return app;
}

function reset() {
  sql.resetFakeSql();
  invalidateIdentityIndex();
  sql.state.users.set(OWNER_PHONE, "owner-1");
  globalThis.__TEST_SESSION__ = { userId: "did:privy:test", phone: OWNER_PHONE };
  globalThis.__TEST_GOOGLE__ = null;
}

const appleCard = (id, name, phone, extra = {}) => ({
  externalId: id,
  name,
  phoneNumbers: phone ? [phone] : [],
  emails: [],
  source: "apple",
  ...extra,
});

const googleRecord = (resourceName, fullName, { emails = [], phones = [], bucket = "saved", company = null } = {}) => ({
  source: "google",
  bucket,
  externalId: resourceName,
  fullName,
  firstName: null,
  lastName: null,
  emails,
  phones,
  company,
  raw: { resourceName },
});

// ── Apple sync route ────────────────────────────────────────────────────────

test("Apple sync response keeps ok + upserted and adds merged/deduped/removed/bySource", async () => {
  reset();
  const app = await buildApp();

  const res = await app.inject({
    method: "POST",
    url: "/v1/me/contacts",
    payload: {
      contacts: [
        appleCard("A1", "Anoushka Chandra", "+13105558127"),
        appleCard("A2", "Ellie Keen", "+13105554614"),
        // duplicate card for Anoushka inside THIS payload → deduped
        appleCard("A3", "Anoushka Chandra", "3105558127"),
        // no name → junk, dropped before the store → removed
        { externalId: "A4", phoneNumbers: ["+13105550000"], source: "apple" },
      ],
    },
  });

  assert.equal(res.statusCode, 200);
  const body = res.json();

  // Pre-existing fields, unchanged.
  assert.equal(body.ok, true);
  assert.equal(body.upserted, 3, "three named cards accounted for");

  // New counts.
  assert.equal(body.deduped, 1, "one duplicate card collapsed within the payload");
  assert.equal(body.merged, 0, "nothing to merge onto — first sync");
  assert.equal(body.removed, 1, "the nameless card was filtered out");

  // Per-source breakdown of what the owner now has.
  assert.deepEqual(body.bySource, { apple: 2, google: 0, total: 2 });
  await app.close();
});

test("Apple re-sync with rotated ids adds nobody and edits nobody", async () => {
  reset();
  const app = await buildApp();
  const payload = (suffix) => ({
    contacts: [
      appleCard(`X-${suffix}`, "Kitty Schur", "+13105551740"),
      appleCard(`Y-${suffix}`, "Liam Rinehart", "+13105555975"),
    ],
  });

  const first = await app.inject({ method: "POST", url: "/v1/me/contacts", payload: payload("v1") });
  assert.equal(first.json().bySource.apple, 2);
  // ONE MODE, ON EVERY SYNC. There used to be a flip here -- "merge" on the
  // first Apple sync, "insert_only" after -- and it was a bug in its own right:
  // the client batches at 200 and this route re-reads the count per request, so
  // a first sync of 1,179 contacts ran batch one as merge and the rest as
  // insert-only. Three-way is correct on sync one and on sync one hundred.
  assert.equal(first.json().mode, "three_way");

  // Every identifier changed (reinstall / new device) — the prod failure case.
  const second = await app.inject({ method: "POST", url: "/v1/me/contacts", payload: payload("v2") });
  const body = second.json();

  // THIS USED TO REPORT merged: 2, AND MERGING WAS THE BUG.
  //
  // "It should not reset all the names of the contacts I had painstakingly
  //  changed."
  //
  // Both cards still match an existing person by phone -- the property that
  // matters, and the reason totals do not grow. What has changed is that a match
  // no longer means folding the device's version over the top. Here the rotated
  // ids resolve by PHONE rather than by source, which is not an authoritative
  // path, so the merge fills blanks only and cannot touch a name. A name edited
  // in Amber survives a reinstall.
  assert.equal(body.mode, "three_way");
  assert.equal(body.unchanged, 2, "both matched an existing person and nothing changed");
  assert.equal(body.inserted, 0, "nobody new");
  assert.equal(body.merged, 0, "nothing was edited");
  assert.equal(body.deduped, 0);
  assert.equal(body.removed, 0);
  assert.deepEqual(body.bySource, { apple: 2, google: 0, total: 2 }, "no new rows");
  await app.close();
});

test("Apple sync counts are all present and numeric even on an empty payload", async () => {
  reset();
  const app = await buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/me/contacts",
    payload: { contacts: [] },
  });
  const body = res.json();
  assert.equal(body.ok, true);
  for (const k of ["upserted", "merged", "deduped", "removed"]) {
    assert.equal(typeof body[k], "number", `${k} must always be a number`);
  }
  assert.deepEqual(body.bySource, { apple: 0, google: 0, total: 0 });
  await app.close();
});

// ── Google import route ─────────────────────────────────────────────────────

test("Google import response carries merged/deduped/removed and bySource", async () => {
  reset();
  const app = await buildApp();

  // Seed an Apple contact so the Google import has someone to merge onto.
  await app.inject({
    method: "POST",
    url: "/v1/me/contacts",
    payload: { contacts: [appleCard("A1", "Maansi Solanky", "+13105551446")] },
  });

  globalThis.__TEST_GOOGLE__ = {
    records: [
      // merges onto the Apple row (shared phone)
      googleRecord("people/c1", "Maansi Solanky", { phones: ["+13105551446"], emails: ["maansi@rytual.com"] }),
      // brand new person
      googleRecord("people/c2", "Shirley Park", { emails: ["shirley@rytual.com"] }),
      // second card for Shirley inside THIS import → deduped
      googleRecord("people/c3", "Shirley Park", { emails: ["Shirley@Rytual.com"] }),
      // harvested, no name and no phone → removed
      googleRecord("otherContacts/c9", null, { emails: ["lori@ipsd.org"], bucket: "other" }),
    ],
  };

  const res = await app.inject({ method: "POST", url: "/v1/me/contacts/import/google" });
  assert.equal(res.statusCode, 200);
  const body = res.json();

  // Pre-existing importer fields survive.
  assert.equal(body.connected, true);
  assert.equal(body.otherContactsScope, true);
  assert.equal(body.fetched, 3, "one record was filtered before the merge loop");
  assert.equal(body.created, 1, "Shirley");
  assert.equal(body.failed, 0);
  assert.equal(body.filteredCount, 1, "legacy alias retained");

  // New counts.
  assert.equal(body.merged, 1, "Maansi collapsed onto the Apple row");
  assert.equal(body.deduped, 1, "two Google cards for Shirley collapsed");
  assert.equal(body.removed, 1, "the harvested nameless entry was filtered");

  assert.deepEqual(body.bySource, { apple: 1, google: 1, total: 2 });
  await app.close();
});

test("Google import still 400s when Google is not connected", async () => {
  reset();
  const app = await buildApp();
  globalThis.__TEST_GOOGLE__ = null;
  const res = await app.inject({ method: "POST", url: "/v1/me/contacts/import/google" });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "google_not_connected");
  await app.close();
});

test("bySource reports every source the owner has, and the parts sum to total", async () => {
  reset();
  const app = await buildApp();
  await app.inject({
    method: "POST",
    url: "/v1/me/contacts",
    payload: { contacts: [appleCard("A1", "Apple Person", "+13105550001")] },
  });
  // A row from a third source, written directly.
  await sql.query(
    `INSERT INTO contacts (owner_id, external_id, full_name, source) VALUES ($1,$2,$3,$4)`,
    ["owner-1", "li-1", "LinkedIn Person", "linkedin"],
  );

  globalThis.__TEST_GOOGLE__ = {
    records: [googleRecord("people/c1", "Google Person", { emails: ["g@rytual.com"] })],
  };
  const res = await app.inject({ method: "POST", url: "/v1/me/contacts/import/google" });
  const { bySource } = res.json();

  assert.equal(bySource.apple, 1);
  assert.equal(bySource.google, 1);
  assert.equal(bySource.linkedin, 1, "other sources are reported too");
  assert.equal(bySource.total, 3);
  const parts = Object.entries(bySource)
    .filter(([k]) => k !== "total")
    .reduce((n, [, v]) => n + v, 0);
  assert.equal(parts, bySource.total, "the parts must add up");
  await app.close();
});

// ── The saved-contact guarantee, end to end through the route ───────────────

test("a SAVED Google contact with only a name survives the import", async () => {
  reset();
  const app = await buildApp();
  globalThis.__TEST_GOOGLE__ = {
    records: [
      // No phone, no email — exactly the shape the junk filter used to drop.
      googleRecord("people/c1", "Nagu Mama", { bucket: "saved" }),
      // Saved, and its only address is a mailing-list sender.
      googleRecord("people/c2", "Newsletter Guy", {
        bucket: "saved",
        emails: ["no-reply@mailer.example.com"],
      }),
    ],
  };

  const res = await app.inject({ method: "POST", url: "/v1/me/contacts/import/google" });
  const body = res.json();

  assert.equal(body.removed, 0, "a saved contact is NEVER junk");
  assert.equal(body.fetched, 2);
  assert.equal(body.created, 2);
  assert.equal(body.bySource.google, 2);
  await app.close();
});
