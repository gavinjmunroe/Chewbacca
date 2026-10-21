import test from "node:test";
import assert from "node:assert/strict";
import { restoreGoogleCalendar } from "./calendar-repair.js";
test("explicit recovery uses only the authenticated owner and an existing calendar grant", async () => {
  let written;
  const deps = {
    list: async () => [],
    secrets: async (id) => {
      assert.equal(id, "did:amber:owner");
      return {
        GCAL_OAUTH_ACCOUNT_EMAIL: "a@test.com",
        GCAL_OAUTH_REFRESH: "fixture",
        GCAL_OAUTH_SCOPES: "calendar",
      };
    },
    connect: async (owner, input) => {
      written = { owner, input };
      return { id: "saved" };
    },
  };
  assert.equal(await restoreGoogleCalendar("owner", deps), true);
  assert.equal(written.owner, "owner");
  assert.equal(
    await restoreGoogleCalendar("owner", {
      ...deps,
      list: async () => [{ provider: "google", accountEmail: "A@test.com" }],
      connect: () => assert.fail(),
    }),
    false,
  );
  assert.equal(
    await restoreGoogleCalendar("owner", {
      ...deps,
      secrets: async () => ({ GMAIL_OAUTH_REFRESH: "fixture" }),
      connect: () => assert.fail(),
    }),
    false,
  );
});
