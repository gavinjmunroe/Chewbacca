/**
 * GET /v1/me/contacts/recently-mentioned — the auth gate, the owner scoping, and
 * the query bounds. The DB function itself is injected, so what is pinned here is
 * the route's contract rather than the SQL.
 *
 * Run with:  node --test src/routes/contact-notes.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { registerContactNoteRoutes } from "./contact-notes.js";

const AMBER_ID = "amber-uuid-1";

function buildApp({ authed = true, spy } = {}) {
  const app = Fastify({ logger: false });
  registerContactNoteRoutes(app, {
    requireAuth: async (request) => {
      if (authed) request.privyUser = { userId: "did:amber:x", phone: "+13105550100" };
    },
    listRecentlyMentionedContacts: async (ownerId, opts) => {
      spy?.push({ ownerId, opts });
      return [
        {
          contactId: "7",
          name: "Neel Patel",
          company: "Springdale",
          title: "Partner",
          kind: "note",
          excerpt: "said he is raising a fund",
          mentionedAt: "2026-08-10T12:00:00.000Z",
          mentionCount: 3,
        },
      ];
    },
  });
  return app;
}

// resolveAmberIdByPhone is the real one, so the happy path needs it stubbed at the
// route's own boundary. It resolves from the phone on privyUser; with no DB reachable
// in a unit test it returns null, which the route must treat as unauthenticated
// rather than as "no results".
test("no auth → 401, and the DB function is never called", async () => {
  const spy = [];
  const app = buildApp({ authed: false, spy });
  const res = await app.inject({ method: "GET", url: "/v1/me/contacts/recently-mentioned" });
  assert.equal(res.statusCode, 401);
  assert.equal(spy.length, 0);
});

test("limit is rejected outside 1..50 rather than clamped silently", async () => {
  const app = buildApp();
  for (const bad of ["0", "51", "abc"]) {
    const res = await app.inject({
      method: "GET",
      url: `/v1/me/contacts/recently-mentioned?limit=${bad}`,
    });
    assert.equal(res.statusCode, 400, `limit=${bad} should be a 400`);
  }
});

// ── POST /v1/me/contacts/:contactId/note ─────────────────────────────────────
// The note must be REAL before anything else happens. This route used to hand
// "Name: text" to the extractor and let a model work out who a note opened on
// one person's card was about; if extraction found nothing, the note existed
// nowhere, which is what made "Add a note" a dead end.

// A UUID, because contacts.id is uuid. These tests used to use "7", which is
// how the route's integer validator survived long enough to break every note
// saved from a person's card: the tests agreed with the validator and both were
// wrong about the schema.
const CONTACT_ID = "9c30df26-0014-4e6a-b66e-8cb26aca1586";
const CONTACT = { id: CONTACT_ID, full_name: "Sagar Tiwari GOAT" };

function buildNoteApp(over = {}) {
  const app = Fastify({ logger: false });
  const spy = { notes: [], captures: [], reembeds: [] };
  registerContactNoteRoutes(app, {
    requireAuth: async (request) => {
      request.privyUser = { userId: "did:amber:x", phone: "+13105550100" };
    },
    resolveAmberIdByPhone: async () => AMBER_ID,
    getContactById: async () => CONTACT,
    getFactsForContact: async () => [],
    insertContactNote: async (args) => {
      spy.notes.push(args);
      return 99;
    },
    captureFromMessage: async (args) => {
      spy.captures.push(args);
      return { status: "captured", outcomes: [{ route: "fact", status: "captured" }] };
    },
    reembedContactSoon: (ownerId, contactId) => {
      spy.reembeds.push({ ownerId, contactId });
    },
    ...over,
  });
  return { app, spy };
}

const addNote = (app, id, payload) =>
  app.inject({ method: "POST", url: `/v1/me/contacts/${id}/note`, payload });

test("the note is written against the contact id in the URL, with no model in the path", async () => {
  const { app, spy } = buildNoteApp();
  const res = await addNote(app, CONTACT_ID, { text: "He likes Chinese food" });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.noteId, "99");
  assert.equal(body.contactId, CONTACT_ID);
  assert.equal(body.text, "He likes Chinese food");
  // Deterministic: this contact, resolved status, the raw text as typed.
  assert.deepEqual(spy.notes[0].participantIds, [CONTACT_ID]);
  assert.equal(spy.notes[0].noteText, "He likes Chinese food");
  assert.equal(spy.notes[0].status, "resolved");
  assert.equal(spy.notes[0].source, "contact_note");
  assert.deepEqual(spy.notes[0].rawNames, []);
});

test("extraction runs after, and is told NOT to write its own copy of the note", async () => {
  const { app, spy } = buildNoteApp();
  await addNote(app, CONTACT_ID, { text: "He likes Chinese food" });
  // Same sentence stored twice is the trap here.
  assert.equal(spy.captures[0].captureNote, false);
  assert.equal(spy.captures[0].messageText, "Sagar Tiwari GOAT: He likes Chinese food");
});

test("the contact is re-embedded so the next semantic question can reach the note", async () => {
  const { app, spy } = buildNoteApp();
  await addNote(app, CONTACT_ID, { text: "Loves Sichuan" });
  assert.deepEqual(spy.reembeds, [{ ownerId: AMBER_ID, contactId: CONTACT_ID }]);
});

test("a failed extraction still leaves the note saved", async () => {
  const { app, spy } = buildNoteApp({
    captureFromMessage: async () => {
      throw new Error("model down");
    },
  });
  const res = await addNote(app, CONTACT_ID, { text: "He likes Chinese food" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().noteId, "99");
  assert.equal(spy.notes.length, 1);
});

test("a failed WRITE is reported as a failure, never as a save", async () => {
  const { app } = buildNoteApp({ insertContactNote: async () => null });
  const res = await addNote(app, CONTACT_ID, { text: "He likes Chinese food" });
  assert.equal(res.statusCode, 500);
  assert.equal(res.json().error, "note_write_failed");
});

test("a contact that is not the caller's is a 404, not a write", async () => {
  const { app, spy } = buildNoteApp({ getContactById: async () => null });
  const res = await addNote(app, CONTACT_ID, { text: "x" });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error, "contact_not_found");
  assert.equal(spy.notes.length, 0);
});

test("a bad contact id or empty text writes nothing", async () => {
  const { app, spy } = buildNoteApp();
  // None of these is a uuid, so all three are still rejected -- including "7",
  // which used to be the only shape this route accepted.
  for (const id of ["0", "-1", "abc", "7"]) {
    const res = await addNote(app, id, { text: "x" });
    assert.equal(res.statusCode, 400, `id=${id}`);
  }
  const blank = await addNote(app, CONTACT_ID, { text: "   " });
  assert.equal(blank.statusCode, 400);
  assert.equal(spy.notes.length, 0);
});
