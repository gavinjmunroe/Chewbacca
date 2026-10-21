import test from "node:test";
import assert from "node:assert/strict";
import { planVersion, updateMemoPlan } from "./memo-plans.js";
const plan = {
  id: "plan",
  title: "Coffee",
  description: "Original",
  place: "Cafe",
  startsAt: "2026-10-05T10:00:00Z",
  endsAt: "2026-10-05T11:00:00Z",
  provider: "capture",
};
const input = {
  ...plan,
  ownerId: "owner",
  version: planVersion(plan),
  place: "Library",
};
test("missing, changed and invalid plans cannot be silently overwritten", async () => {
  await assert.rejects(
    updateMemoPlan(input, {
      get: async (owner, id) => {
        assert.equal(owner, "owner");
        assert.equal(id, "plan");
        return null;
      },
    }),
    { code: "not_found" },
  );
  await assert.rejects(
    updateMemoPlan(input, { get: async () => ({ ...plan, title: "Changed" }) }),
    { code: "plan_changed" },
  );
  await assert.rejects(
    updateMemoPlan(
      { ...input, endsAt: input.startsAt },
      { get: () => assert.fail() },
    ),
    { code: "invalid_plan" },
  );
});
test("local update uses the explicitly selected plan and an unchanged retry is a no-op", async () => {
  let calls = 0;
  let saved = plan;
  const deps = {
    get: async () => saved,
    update: async (before, next) => {
      calls++;
      assert.equal(before.id, "plan");
      saved = { ...next, provider: "capture" };
      return "plan";
    },
  };
  assert.equal((await updateMemoPlan(input, deps)).destination, "amber");
  assert.equal((await updateMemoPlan(input, deps)).replayed, true);
  assert.equal(calls, 1);
});
function googleFixture(extra = {}) {
  let event = {
    id: "event",
    summary: plan.title,
    description: plan.description,
    location: plan.place,
    start: { dateTime: plan.startsAt },
    end: { dateTime: plan.endsAt },
    etag: "v1",
    attendees: [{ email: "guest@example.org" }],
    ...extra,
  };
  let patches = 0,
    mirrors = 0;
  const selected = {
    ...plan,
    provider: "google",
    accountId: "account",
    externalId: "calendar@example.org:event",
  };
  const deps = {
    get: async () => selected,
    accounts: async () => [
      { id: "account", owner_id: "owner", provider: "google" },
    ],
    token: async () => "token",
    fetch: async (url, o) => {
      assert.match(url, /calendars\/calendar%40example.org\/events\/event/);
      if (o.method === "PATCH") {
        patches++;
        assert.equal(o.headers["If-Match"], "v1");
        const patch = JSON.parse(o.body);
        assert.equal(patch.attendees, undefined);
        assert.equal(patch.reminders, undefined);
        event = { ...event, ...patch, etag: "v2" };
      }
      return { ok: true, json: async () => event };
    },
    mirror: async () => {
      mirrors++;
      return { eventId: "plan" };
    },
  };
  return { deps, patches: () => patches, mirrors: () => mirrors };
}
test("Google updates the selected secondary calendar with If-Match and mirrors only after success", async () => {
  const f = googleFixture();
  assert.equal((await updateMemoPlan(input, f.deps)).destination, "google");
  assert.equal((await updateMemoPlan(input, f.deps)).replayed, true);
  assert.equal(f.patches(), 1);
  assert.equal(f.mirrors(), 2);
});
test("remote edits, recurring events and another owner’s account block Google writes", async () => {
  for (const [extra, code] of [
    [{ location: "Changed" }, "plan_changed"],
    [{ recurringEventId: "series" }, "plan_not_editable"],
  ]) {
    const f = googleFixture(extra);
    await assert.rejects(updateMemoPlan(input, f.deps), { code });
    assert.equal(f.patches(), 0);
  }
  const f = googleFixture();
  f.deps.accounts = async () => [
    { id: "account", owner_id: "other", provider: "google" },
  ];
  await assert.rejects(updateMemoPlan(input, f.deps), {
    code: "google_not_connected",
  });
});
test("Google 412 and failed mirroring never claim a confirmed update", async () => {
  const f = googleFixture();
  const fetch = f.deps.fetch;
  f.deps.fetch = async (url, o) =>
    o.method === "PATCH" ? { ok: false, status: 412 } : fetch(url, o);
  await assert.rejects(updateMemoPlan(input, f.deps), { code: "plan_changed" });
  assert.equal(f.mirrors(), 0);
  const g = googleFixture();
  g.deps.mirror = async () => null;
  await assert.rejects(updateMemoPlan(input, g.deps), {
    code: "google_saved_amber_pending",
  });
});
