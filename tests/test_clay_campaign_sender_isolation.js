"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  WORKSPACE_ID,
  CAMPAIGN_IDS,
  ISOLATED_SENDER_IDS,
  planSenderIsolation,
  verifySenderIsolationBeforeWrite,
  verifySenderIsolation,
} = require("../bin/lib/clay-campaign-sender-isolation");

// Synthetic values follow the observed native campaign shape; only the
// allowlisted recovery campaign and incident sender IDs are operational IDs.
function campaign(id = CAMPAIGN_IDS[0]) {
  return {
    workspace: { id: WORKSPACE_ID, name: "Example workspace" },
    id,
    name: "Zeutara | Example recovery",
    status: "paused",
    settings: {
      unsubscribeText: "Unsubscribe",
      trackingSettings: { trackEmailOpen: false, trackLinkClick: false },
      scheduleSettings: {
        scheduleType: "prioritize_deliverability",
        timezone: "America/New_York",
        daysOfWeek: ["mon", "tue"],
        startHour: "09:00",
        endHour: "17:00",
        minTimeBetweenSteps: 20,
        scheduleStartDate: "2026-10-14",
      },
      senderAccountIds: [
        "csea_healthyA",
        ISOLATED_SENDER_IDS[0],
        "csea_healthyB",
        ISOLATED_SENDER_IDS[1],
      ],
      autoPauseLeadOnSegmentExit: true,
    },
    providers: { smartlead: { campaignId: 123, clientId: 456 } },
    leadBaseSegmentId: "audseg_example",
    leadExclusionSegmentIds: [],
    variants: [
      {
        id: "cvar_example",
        weightBps: 10000,
        sequence: [
          {
            id: "original",
            order: 0,
            emailType: "NEW_EMAIL_THREAD",
            body: { type: "doc", content: [] },
          },
        ],
      },
    ],
    createdAt: "2026-10-10T00:00:00Z",
    updatedAt: "2026-10-15T00:00:00Z",
  };
}
const scope = (id = CAMPAIGN_IDS[0]) => ({ ws: WORKSPACE_ID, campaign: id });
function isolated(before, plan) {
  const after = structuredClone(before);
  after.settings.senderAccountIds = [...plan.senderAccountIds];
  after.updatedAt = "2026-10-16T00:00:00Z";
  return after;
}

for (const id of CAMPAIGN_IDS)
  test(`isolates only two incident senders for ${id}`, () => {
    const before = campaign(id),
      original = structuredClone(before),
      plan = planSenderIsolation(before, scope(id));
    assert.deepEqual(before, original);
    assert.deepEqual(plan.input, {
      settings: {
        ...structuredClone(before.settings),
        senderAccountIds: ["csea_healthyA", "csea_healthyB"],
      },
    });
    assert.equal(verifySenderIsolationBeforeWrite(before, plan), true);
    const result = verifySenderIsolation(before, plan, isolated(before, plan));
    assert.equal(result.verified, true);
    assert.equal(result.remainingSenderCount, 2);
    assert.equal(result.readyToResume, false);
    assert.match(result.isolationSha256, /^[a-f0-9]{64}$/);
  });

test("binds raw API campaigns without embedded workspace to explicit request scope", () => {
  const before = campaign();
  delete before.workspace;
  assert.equal(planSenderIsolation(before, scope()).workspaceId, WORKSPACE_ID);
  assert.throws(() =>
    planSenderIsolation(before, { ws: "other", campaign: before.id }),
  );
});

test("refuses wrong scope, identity, status, name and malformed settings", () => {
  assert.throws(() =>
    planSenderIsolation(campaign(), { ws: "1", campaign: CAMPAIGN_IDS[0] }),
  );
  assert.throws(() =>
    planSenderIsolation(campaign("cam_other"), scope("cam_other")),
  );
  for (const mutate of [
    (c) => {
      c.id = CAMPAIGN_IDS[1];
    },
    (c) => {
      c.status = "active";
    },
    (c) => {
      c.workspace.id = "other";
    },
    (c) => {
      c.workspaceId = "other";
    },
    (c) => {
      c.name = "Other client";
    },
    (c) => {
      c.settings.senderAccountIds = null;
    },
    (c) => {
      c.settings.senderAccountIds.push("bad/id");
    },
  ]) {
    const c = campaign();
    mutate(c);
    assert.throws(() => planSenderIsolation(c, scope()));
  }
});

test("refuses missing targets, duplicate IDs and empty remaining sender set", () => {
  for (const senders of [
    ["csea_healthyA", ISOLATED_SENDER_IDS[0]],
    ["csea_healthyA", ...ISOLATED_SENDER_IDS, "csea_healthyA"],
    [...ISOLATED_SENDER_IDS],
    [],
  ]) {
    const c = campaign();
    c.settings.senderAccountIds = senders;
    assert.throws(() => planSenderIsolation(c, scope()));
  }
});

test("allows only top-level updatedAt drift before write", () => {
  const before = campaign(),
    plan = planSenderIsolation(before, scope()),
    current = structuredClone(before);
  current.updatedAt = "2026-10-16T01:00:00Z";
  assert.equal(verifySenderIsolationBeforeWrite(current, plan), true);
  current.settings.scheduleSettings.minTimeBetweenSteps = 3;
  assert.throws(() => verifySenderIsolationBeforeWrite(current, plan), /drift/);
});

test("refuses tampered plan, healthy sender removal or reordering, and unrelated readback changes", () => {
  const before = campaign(),
    plan = planSenderIsolation(before, scope());
  const tampered = structuredClone(plan);
  tampered.input.settings.senderAccountIds = [];
  assert.throws(
    () => verifySenderIsolationBeforeWrite(before, tampered),
    /tampering/,
  );
  for (const mutate of [
    (c) => {
      c.settings.senderAccountIds.pop();
    },
    (c) => {
      c.settings.senderAccountIds.reverse();
    },
    (c) => {
      c.settings.senderAccountIds.push(ISOLATED_SENDER_IDS[0]);
    },
    (c) => {
      c.settings.scheduleSettings.endHour = "19:00";
    },
    (c) => {
      c.settings.dailyCap = 999;
    },
    (c) => {
      c.variants[0].sequence[0].id = "replacement";
    },
    (c) => {
      c.createdAt = "2026-10-16T00:00:00Z";
    },
    (c) => {
      c.providers.smartlead.campaignId = 789;
    },
    (c) => {
      c.extraField = true;
    },
    (c) => {
      delete c.leadExclusionSegmentIds;
    },
  ]) {
    const after = isolated(before, plan);
    mutate(after);
    assert.throws(() => verifySenderIsolation(before, plan, after));
  }
});

test("compares object keys semantically but rejects non-JSON hidden field values", () => {
  const before = campaign(),
    plan = planSenderIsolation(before, scope());
  const reordered = Object.fromEntries(
    Object.entries(isolated(before, plan)).reverse(),
  );
  assert.equal(verifySenderIsolation(before, plan, reordered).verified, true);
  before.settings.hidden = undefined;
  assert.throws(() => planSenderIsolation(before, scope()), /JSON/);
});
