import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerAmberCardRoutes } from "./amber-card.js";
import {
  normalizeCard,
  publicCard,
  cardHtml,
  cardVcf,
} from "../lib/amber-card.js";
const token = "a".repeat(32);
const input = {
  name: "A <person>",
  bio: "Hello",
  published: true,
  links: [
    {
      id: "public",
      type: "url",
      label: "Work",
      value: "https://example.com",
      enabled: true,
    },
    {
      id: "private",
      type: "email",
      label: "Private",
      value: "private@example.com",
      enabled: false,
    },
  ],
};
test("public HTML, JSON and vCard expose only explicitly selected fields", async () => {
  const card = {
    ...normalizeCard(input),
    token,
    notes: "SECRET NOTES",
    peopleRank: 99,
  };
  const pub = publicCard(card);
  assert.deepEqual(Object.keys(pub), ["name", "bio", "links"]);
  assert.equal(pub.links.length, 1);
  assert.equal(publicCard({ ...card, published: false }), null);
  assert.doesNotMatch(
    cardHtml(pub, token),
    /private@example|SECRET NOTES|<person>/,
  );
  assert.match(cardHtml(pub, token), /A &lt;person&gt;/);
  assert.doesNotMatch(cardVcf(pub), /private@example|SECRET NOTES/);
  const app = Fastify();
  registerAmberCardRoutes(app, {
    find: async (value) => {
      assert.equal(value, token);
      return pub;
    },
  });
  for (const suffix of ["", "/data", "/contact.vcf"]) {
    const r = await app.inject("/card/" + token + suffix);
    assert.equal(r.statusCode, 200);
    assert.equal(r.headers["cache-control"], "no-store");
    assert.doesNotMatch(r.body, /private@example|SECRET NOTES/);
  }
  assert.equal((await app.inject("/card/bad")).statusCode, 404);
  await app.close();
});
test("unsafe links, duplicates and invalid phone values are rejected", () => {
  for (const value of [
    "javascript:alert(1)",
    "http://example.com",
    "https://user:pass@example.com",
    "https://example.com\nInjected",
  ])
    assert.throws(() =>
      normalizeCard({ ...input, links: [{ ...input.links[0], value }] }),
    );
  assert.throws(() =>
    normalizeCard({ ...input, links: [input.links[0], input.links[0]] }),
  );
  assert.throws(() =>
    normalizeCard({
      ...input,
      links: [{ ...input.links[0], type: "phone", value: "call-me" }],
    }),
  );
});
test("writes derive ownership from DID, preserve concurrency token and fail closed", async () => {
  const app = Fastify();
  let saved = 0;
  registerAmberCardRoutes(app, {
    auth: async (req) => {
      if (req.headers.authorization)
        req.privyUser = { userId: "did:amber:owner" };
    },
    resolve: async (did) => {
      assert.equal(did, "did:amber:owner");
      return "owner";
    },
    save: async (owner, card, expected) => {
      assert.equal(owner, "owner");
      assert.equal(expected, "old");
      saved++;
      throw Error("card_changed");
    },
  });
  const a = await app.inject({
    method: "PUT",
    url: "/v1/me/amber-card",
    payload: input,
  });
  assert.equal(a.statusCode, 401);
  assert.equal(saved, 0);
  const b = await app.inject({
    method: "PUT",
    url: "/v1/me/amber-card",
    headers: { authorization: "test" },
    payload: { ...input, expectedUpdatedAt: "old", ownerId: "someone-else" },
  });
  assert.equal(b.statusCode, 409);
  assert.equal(saved, 1);
  await app.close();
});
