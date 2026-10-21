import { test } from "node:test";
import assert from "node:assert/strict";
import { userToContact } from "./scrape-following.js";

test("userToContact maps a full X user payload to the contact schema", () => {
  const user = {
    id: "44196397",
    username: "elonmusk",
    name: "Elon Musk",
    description: "I love tweeting at 3am",
    location: "Austin, TX",
    url: "https://x.com",
    verified: true,
    profile_image_url:
      "https://pbs.twimg.com/profile_images/123/abc_normal.jpg",
    created_at: "2009-06-02T20:12:29.000Z",
  };
  const contact = userToContact(user);
  assert.equal(contact.source, "twitter");
  assert.equal(contact.sourceHandle, "elonmusk");
  assert.equal(contact.externalId, "twitter:44196397");
  assert.equal(contact.name, "Elon Musk");
  assert.equal(contact.title, "I love tweeting at 3am");
  assert.equal(contact.location, "Austin, TX");
  assert.equal(contact.notes, "I love tweeting at 3am");
  assert.equal(contact.metadata.twitter.id, "44196397");
  assert.equal(contact.metadata.twitter.username, "elonmusk");
  assert.equal(
    contact.metadata.twitter.profileUrl,
    "https://twitter.com/elonmusk",
  );
  assert.equal(contact.metadata.twitter.verified, true);
  assert.equal(contact.metadata.twitter.url, "https://x.com");
});

test("userToContact handles missing optional fields cleanly", () => {
  const user = {
    id: "1",
    username: "jane",
    name: "Jane Q",
  };
  const contact = userToContact(user);
  assert.equal(contact.location, null);
  assert.equal(contact.title, null);
  assert.equal(contact.notes, null);
  assert.equal(contact.metadata.twitter.verified, null);
  assert.equal(contact.metadata.twitter.profile_image_url, null);
  assert.equal(contact.metadata.twitter.url, null);
});

test("userToContact returns null on missing required fields", () => {
  assert.equal(userToContact(null), null);
  assert.equal(userToContact({}), null);
  assert.equal(userToContact({ id: "1" }), null);
  assert.equal(userToContact({ id: "1", username: "jane" }), null);
  assert.equal(userToContact({ id: "1", username: "jane", name: "" }), null);
  assert.equal(userToContact({ id: "1", username: "jane", name: "   " }), null);
  assert.equal(userToContact({ username: "jane", name: "Jane" }), null);
});

test("userToContact trims whitespace from name, description, and location", () => {
  const user = {
    id: "1",
    username: "jane",
    name: "  Jane Q  ",
    description: "  builds things  ",
    location: "  SF  ",
  };
  const contact = userToContact(user);
  assert.equal(contact.name, "Jane Q");
  assert.equal(contact.title, "builds things");
  assert.equal(contact.location, "SF");
});

test("userToContact treats empty description as null instead of empty string", () => {
  const user = {
    id: "1",
    username: "jane",
    name: "Jane",
    description: "",
    location: "",
  };
  const contact = userToContact(user);
  assert.equal(contact.title, null);
  assert.equal(contact.notes, null);
  assert.equal(contact.location, null);
});

test("userToContact rejects non-string id (X ids are always strings in v2)", () => {
  const user = {
    id: 44196397,
    username: "elonmusk",
    name: "Elon Musk",
  };
  assert.equal(userToContact(user), null);
});
