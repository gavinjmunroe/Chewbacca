/**
 * POST /v1/me/contacts/from-web — the auth gate, the identifier guard, and what
 * actually gets written. Every store call is injected, so nothing touches the DB.
 *
 * Run with:  node --test src/routes/contacts-web.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { registerWebContactRoutes } from "./contacts-web.js";

const AMBER_ID = "amber-uuid-1";

function buildApp(opts = {}) {
  const { authed = true, spy = {} } = opts;
  const app = Fastify({ logger: false });
  registerWebContactRoutes(app, {
    requireAuth: async (request) => {
      if (authed) request.privyUser = { userId: "did:amber:x", phone: "+13105550100" };
    },
    resolveAmberIdByPhone: async () => AMBER_ID,
    createContactForOwner: async (args) => {
      (spy.created ||= []).push(args);
      return { id: "11111111-2222-4333-8444-555555555555" };
    },
    updateContactFields: async (args) => {
      (spy.fields ||= []).push(args);
      return {};
    },
    upsertContactSource: async (ownerId, contactId, record) => {
      (spy.sources ||= []).push({ ownerId, contactId, record });
    },
    addContactTags: async (ownerId, contactId, tags) => {
      (spy.tags ||= []).push({ ownerId, contactId, tags });
      return (tags || []).map((t) => t.toLowerCase());
    },
    insertContactNote: async (args) => {
      (spy.notes ||= []).push(args);
      return 7;
    },
    // The URL-as-a-field write (awaited) and the page read (backgrounded) are
    // injected so no test touches Exa, Anthropic or the DB.
    applyProfileUrlFields: async (args) => {
      (spy.urlFields ||= []).push(args);
      if (opts.applyThrows) throw new Error("link write exploded");
      return ["linkedin_url"];
    },
    fillWebContactFromProfile: async (args) => {
      (spy.filled ||= []).push(args);
      if (opts.fillThrows) throw new Error("extraction exploded");
      return { filled: ["title"], skipped: [], extras: 0, reason: null };
    },
    extractionConfigured: () => opts.extractionConfigured !== false,
  });
  return app;
}

const save = (app, payload) =>
  app.inject({ method: "POST", url: "/v1/me/contacts/from-web", payload });

test("saves the contact, its title/company, its source, its tags and its note", async () => {
  const spy = {};
  const app = buildApp({ spy });
  const res = await save(app, {
    name: "Danielle Renaldo",
    title: "VP Finance",
    company: "Zocdoc",
    profileUrl: "https://linkedin.com/in/danielle-renaldo-15981a59",
    tags: ["Work", "reach out"],
    note: "Healthtech FP&A, warm intro via Sagar",
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), {
    contactId: "11111111-2222-4333-8444-555555555555",
    tags: ["work", "reach out"],
    links: ["linkedin_url"],
    enriching: true,
  });

  assert.equal(spy.created[0].fullName, "Danielle Renaldo");
  assert.equal(spy.created[0].source, "web_search");
  assert.equal(spy.fields[0].title, "VP Finance");
  assert.equal(spy.fields[0].company, "Zocdoc");
  // The URL is the identifier, so it is the source's externalId — that is what makes
  // saving the same person twice idempotent.
  assert.equal(spy.sources[0].record.externalId, "https://linkedin.com/in/danielle-renaldo-15981a59");
  assert.deepEqual(spy.tags[0].tags, ["Work", "reach out"]);
  // The note lands on the contact, not in a separate silo.
  // A UUID. This asserted [42], so an integer fixture made the broken code
  // pass: Number(contactId) on a real uuid is NaN and the note went out with
  // no participants at all.
  assert.deepEqual(spy.notes[0].participantIds, ["11111111-2222-4333-8444-555555555555"]);
  assert.equal(spy.notes[0].source, "app_web_save");
});

test("a profile URL is required, and it has to be a real one", async () => {
  const spy = {};
  const app = buildApp({ spy });
  for (const bad of ["not a url", "linkedin.com/in/x", "amber://connect", "ftp://a.b/c"]) {
    const res = await save(app, { name: "X", profileUrl: bad });
    assert.equal(res.statusCode, 400, bad);
    assert.equal(res.json().error, "invalid_profile_url", bad);
  }
  // Nothing was written on any rejected attempt.
  assert.equal(spy.created, undefined);
});

test("a blank name is rejected", async () => {
  const res = await save(buildApp(), { name: "   ", profileUrl: "https://linkedin.com/in/x" });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "name_required");
});

test("no auth means no write", async () => {
  const spy = {};
  const app = buildApp({ authed: false, spy });
  const res = await save(app, { name: "X", profileUrl: "https://linkedin.com/in/x" });
  assert.equal(res.statusCode, 400);
  assert.equal(spy.created, undefined);
});

test("omitted title/company do not blank out fields the contact already has", async () => {
  const spy = {};
  const app = buildApp({ spy });
  await save(app, { name: "Cy C", profileUrl: "https://linkedin.com/in/cy" });
  // updateContactFields must not be called at all when there is nothing to set.
  assert.equal(spy.fields, undefined);
});

test("no note means no note row", async () => {
  const spy = {};
  const app = buildApp({ spy });
  await save(app, { name: "Cy C", profileUrl: "https://linkedin.com/in/cy", note: "   " });
  assert.equal(spy.notes, undefined);
});

test("the profile URL is written as a FIELD, not only as provenance", async () => {
  const spy = {};
  const app = buildApp({ spy });
  const res = await save(app, {
    name: "Danielle Renaldo",
    profileUrl: "https://www.linkedin.com/in/danielle-renaldo",
    snippet: "VP Finance at Zocdoc, New York",
  });
  assert.equal(res.statusCode, 200);
  // This is the bug that made the LinkedIn button never appear: the card reads
  // linkedin_url and only contact_sources was being written.
  assert.equal(spy.urlFields[0].profileUrl, "https://www.linkedin.com/in/danielle-renaldo");
  assert.deepEqual(res.json().links, ["linkedin_url"]);
  // The snippet rides along so a crawler-blocked page still has something to read.
  assert.equal(spy.filled[0].snippet, "VP Finance at Zocdoc, New York");
  assert.equal(spy.filled[0].name, "Danielle Renaldo");
});

test("a save still succeeds when the page read blows up", async () => {
  const spy = {};
  const app = buildApp({ spy, fillThrows: true });
  const res = await save(app, { name: "X Y", profileUrl: "https://example.org/people/xy" });
  // The extraction is backgrounded and rejects. The contact still exists, the
  // response is still 200, and the process must not take an unhandled rejection.
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().contactId, "11111111-2222-4333-8444-555555555555");
  assert.equal(spy.created.length, 1);
});

test("a failed link write does not fail the save either", async () => {
  const spy = {};
  const app = buildApp({ spy, applyThrows: true });
  const res = await save(app, { name: "X Y", profileUrl: "https://example.org/people/xy" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().links, []);
});

test("with no extraction key the save reports enriching:false and reads nothing", async () => {
  const spy = {};
  const app = buildApp({ spy, extractionConfigured: false });
  const res = await save(app, { name: "X Y", profileUrl: "https://example.org/people/xy" });
  assert.equal(res.json().enriching, false);
  // No silent pretending: the page read is not attempted at all.
  assert.equal(spy.filled, undefined);
  // The URL is still stored, because that half needs no key.
  assert.deepEqual(res.json().links, ["linkedin_url"]);
});
