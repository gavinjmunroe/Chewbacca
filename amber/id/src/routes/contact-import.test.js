/**
 * THE UPLOAD ROUTE.
 *
 * The parser has its own tests. These cover the things only the route decides,
 * and each is a way an import surface goes wrong:
 *
 *   - it must be owner-scoped, and a session that cannot resolve an owner
 *     writes nothing rather than writing to a default
 *   - IT MUST GO THROUGH THE RESOLVER. An import path that writes contacts
 *     directly is the third writer, and the whole point is that there is one.
 *   - a file it cannot read must say WHICH kind of cannot: unreadable and empty
 *     send somebody to different places
 *   - it must be bounded, because this is where somebody uploads their entire
 *     social graph
 *
 * Run with:  node --test src/routes/contact-import.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { registerContactImportRoutes } from "./contact-import.js";

const OWNER = "11111111-1111-1111-1111-111111111111";
const PHONE = "+15550001111";
const AUTH = { authorization: "Bearer test" };

const VCARD = `BEGIN:VCARD
VERSION:3.0
FN:Sagar Tiwari
EMAIL:sagar@rytual.com
UID:abc-123
END:VCARD`;

const CSV = `First Name,Last Name,Email Address,Company
Ada,Reyes,ada@corp.com,Acme
Bo,Tran,bo@corp.com,Acme`;

function buildApp(over = {}) {
  const app = Fastify();
  const seen = { imports: [] };
  registerContactImportRoutes(app, {
    requireAuth: async (request) => {
      request.privyUser = over.noPhone ? { userId: "u" } : { userId: "u", phone: PHONE };
    },
    resolveOwnerId: over.resolveOwnerId ?? (async () => OWNER),
    importRecords:
      over.importRecords ??
      (async (ownerId, records) => {
        seen.imports.push({ ownerId, records });
        return { created: records.length, merged: 0, updated: 0, failed: 0, deduped: 0 };
      }),
  });
  return { app, seen };
}

const post = (app, payload) =>
  app.inject({ method: "POST", url: "/v1/me/contacts/import-file", headers: AUTH, payload });

test("a vCard imports and reports what it found", async () => {
  const { app } = buildApp();
  const res = await post(app, { content: VCARD });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.format, "vcard");
  assert.equal(body.found, 1);
  assert.equal(body.created, 1);
});

test("a LinkedIn-style CSV imports", async () => {
  const { app } = buildApp();
  const body = (await post(app, { content: CSV })).json();
  assert.equal(body.format, "csv");
  assert.equal(body.found, 2);
});

test("EVERY RECORD GOES THROUGH THE RESOLVER, not straight to a table", async () => {
  // If this ever stops being true there are two contact writers again, and the
  // second one will not dedupe.
  const { app, seen } = buildApp();
  await post(app, { content: VCARD });
  assert.equal(seen.imports.length, 1);
  assert.equal(seen.imports[0].records[0].fullName, "Sagar Tiwari");
  assert.deepEqual(seen.imports[0].records[0].emails, ["sagar@rytual.com"]);
});

test("the import is scoped to the resolved owner", async () => {
  const { app, seen } = buildApp();
  await post(app, { content: VCARD });
  assert.equal(seen.imports[0].ownerId, OWNER);
});

test("the source defaults to upload, which outranks nothing the person typed", async () => {
  const { app, seen } = buildApp();
  await post(app, { content: VCARD });
  assert.equal(seen.imports[0].records[0].source, "upload");
});

test("a caller-supplied source is recorded as provenance", async () => {
  const { app, seen } = buildApp();
  const body = (await post(app, { content: CSV, source: "linkedin" })).json();
  assert.equal(body.source, "linkedin");
  assert.equal(seen.imports[0].records[0].source, "linkedin");
});

test("a vCard UID rides along, so re-uploading the same export is idempotent", async () => {
  const { app, seen } = buildApp();
  await post(app, { content: VCARD });
  assert.equal(seen.imports[0].records[0].externalId, "vcard:abc-123");
});

test("A SESSION WITH NO PHONE STILL IMPORTS, because that account has no other way to", async () => {
  /*
   * This asserted the opposite until migration 062. The route refused outright
   * when a session carried no phone, which was correct while every account in
   * this service WAS a phone number -- and became exactly backwards the moment
   * an employee could be invited into a company by their work address. That
   * account has no phone, no iOS app syncing an address book on its behalf, and
   * this upload is the only way it will ever have contacts at all.
   *
   * The owner is resolved by phone OR by the token's subject now (lib/owner-id),
   * so what the route refuses is an unresolvable owner -- the next test -- not
   * a missing phone number.
   */
  const { app, seen } = buildApp({ noPhone: true });
  const res = await post(app, { content: VCARD });
  assert.equal(res.statusCode, 200);
  assert.equal(seen.imports.length, 1);
  assert.equal(seen.imports[0].ownerId, OWNER);
});

test("an unresolvable owner imports nothing", async () => {
  const { app, seen } = buildApp({ resolveOwnerId: async () => null });
  const res = await post(app, { content: VCARD });
  assert.equal(res.statusCode, 500);
  assert.equal(seen.imports.length, 0);
});

test("AN UNREADABLE FILE AND AN EMPTY ONE ARE DIFFERENT ANSWERS", async () => {
  const { app } = buildApp();
  const junk = await post(app, { content: "this is just prose" });
  assert.equal(junk.statusCode, 422);
  assert.equal(junk.json().format, "unknown");

  const headerless = await post(app, { content: "alpha,beta\n1,2" });
  assert.equal(headerless.statusCode, 422);
  assert.equal(headerless.json().error, "no_recognizable_header");
  assert.match(headerless.json().message, /columns/);
});

test("a file with too many records is refused rather than half-imported", async () => {
  const { app, seen } = buildApp();
  const many = ["Name,Email"]
    .concat(Array.from({ length: 5001 }, (_, i) => `Person ${i},p${i}@x.com`))
    .join("\n");
  const res = await post(app, { content: many });
  assert.equal(res.statusCode, 413);
  assert.equal(seen.imports.length, 0, "records were written before the cap was checked");
});

test("a content field that is missing is refused by the schema", async () => {
  const { app } = buildApp();
  const res = await post(app, { source: "linkedin" });
  assert.equal(res.statusCode, 400);
});

test("a failing write is a 503, not a 200 reporting an import that did not happen", async () => {
  const { app } = buildApp({
    importRecords: async () => {
      throw new Error("db down");
    },
  });
  const res = await post(app, { content: VCARD });
  assert.equal(res.statusCode, 503);
});

test("the format is sniffed from the bytes, not from the filename", async () => {
  const { app } = buildApp();
  const body = (await post(app, { content: VCARD, filename: "contacts.csv" })).json();
  assert.equal(body.format, "vcard");
  assert.equal(body.filename, "contacts.csv");
});
