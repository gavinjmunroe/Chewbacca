import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import {
  registerContactPreviewRoutes,
  contactDraft,
} from "./contact-preview.js";
test("vCard preview is read-only and requires no AI lookup", async () => {
  const app = Fastify();
  registerContactPreviewRoutes(app, {
    auth: async (r) => {
      r.privyUser = { userId: "did:owner" };
    },
    model: () => assert.fail("vCard must not use AI"),
  });
  const r = await app.inject({
    method: "POST",
    url: "/v1/me/capture/contact-preview",
    payload: {
      text: "BEGIN:VCARD\nVERSION:3.0\nFN:Jane Doe\nEMAIL:jane@example.com\nTEL:+14155550123\nEND:VCARD",
    },
  });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json().contacts[0].emails, ["jane@example.com"]);
  await app.close();
});
test("draft validation rejects unsafe profile links and invalid identifiers", () => {
  const r = contactDraft({
    fullName: "Jane",
    emails: ["valid@example.com", "bad"],
    phones: ["+14155550123", "no"],
    linkedinUrl: "https://evil.test/in/jane",
  });
  assert.equal(r.linkedin, undefined);
  assert.equal(r.emails.length, 1);
  assert.equal(r.phoneNumbers.length, 1);
});

test("Apple link lookup scopes every candidate to the authenticated DID", async () => {
  const app = Fastify();
  registerContactPreviewRoutes(app, {
    auth: async (r) => {
      r.privyUser = { userId: "did:owner" };
    },
    resolve: async (did) => {
      assert.equal(did, "did:owner");
      return "owner";
    },
    query: async (sql, args) => {
      assert.match(sql, /c.owner_id=\$1/);
      assert.deepEqual(args, ["owner", "apple-id"]);
      return { rows: [{ id: "canonical" }] };
    },
  });
  const r = await app.inject("/v1/me/contacts/apple-link/apple-id");
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().contactId, "canonical");
  await app.close();
});
