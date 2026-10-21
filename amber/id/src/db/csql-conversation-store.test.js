import test from "node:test";
import assert from "node:assert/strict";
import { roleToColumn, roleFromColumn } from "./csql-conversation-store.js";

// THE REGRESSION THIS FILE EXISTS FOR.
//
// conversation_messages.role is CHECK (user|amber|system). Every reply in
// routes/chat.js is appended with role:"assistant". The old bridge between the
// two coerced anything it did not recognize to "user", so every single one of
// Amber's answers was stored as if the user had said it -- which broke the note
// transcript, the model's own history, the correction fast-path and the
// people-merge, all at once and all silently.
//
// Nothing here needs a database. That is the point: the translation is a pure
// function precisely so it can be pinned down.

test("an assistant message is stored as an amber row", () => {
  assert.equal(roleToColumn("assistant"), "amber");
});

test("the user's own message is stored as a user row", () => {
  assert.equal(roleToColumn("user"), "user");
});

test("'amber' is accepted as itself, so the store is idempotent", () => {
  assert.equal(roleToColumn("amber"), "amber");
  assert.equal(roleToColumn("system"), "system");
});

test("an unknown role throws instead of silently becoming a user message", () => {
  // The whole bug in one assertion.
  assert.throws(() => roleToColumn("assistent"), /unknown role/);
  assert.throws(() => roleToColumn(undefined), /unknown role/);
  assert.throws(() => roleToColumn(null), /unknown role/);
});

test("reads come back in the vocabulary every caller tests for", () => {
  assert.equal(roleFromColumn("amber"), "assistant");
  assert.equal(roleFromColumn("user"), "user");
  assert.equal(roleFromColumn("system"), "system");
});

test("write then read round-trips an assistant turn", () => {
  assert.equal(roleFromColumn(roleToColumn("assistant")), "assistant");
  assert.equal(roleFromColumn(roleToColumn("user")), "user");
});
