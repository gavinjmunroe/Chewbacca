"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  planRestriction,
  verifyBeforeWrite,
  verifyRestriction,
} = require("../bin/lib/clay-campaign-restriction");

function fixture() {
  return {
    complete: true,
    campaign: {
      id: "cam_test",
      status: "paused",
      leadBaseSegmentId: "audseg_test",
      settings: {
        autoPauseLeadOnSegmentExit: true,
        senderAccountIds: ["csea_one"],
      },
      sequence: [{ id: "original" }],
    },
    audience: {
      id: "audseg_test",
      entityType: "people",
      filter: {
        type: "GroupOp",
        combinationMode: "Or",
        items: [
          {
            type: "GroupOp",
            combinationMode: "And",
            items: [
              {
                type: "BinOp",
                key: "email",
                operator: "ContainAny",
                value: ["held@example.com", "keep@example.com"],
              },
              { type: "BinOp", key: "firm", operator: "NotEmpty" },
            ],
          },
        ],
      },
    },
    members: [
      { entityId: "1", email: "held@example.com" },
      { entityId: "2", email: "keep@example.com" },
    ],
    enrolled: [
      {
        entityId: "1",
        email: "held@example.com",
        status: "active",
        isPaused: false,
        enrolledAt: "2026-10-14T00:00:00Z",
      },
      {
        entityId: "2",
        email: "keep@example.com",
        status: "active",
        isPaused: false,
        enrolledAt: "2026-10-14T00:00:00Z",
      },
    ],
    campaigns: [
      {
        id: "cam_test",
        leadBaseSegmentId: "audseg_test",
        leadExclusionSegmentIds: [],
      },
    ],
  };
}
const held = [{ entityId: "1", email: "held@example.com" }];
function repaired(before, plan) {
  const after = structuredClone(before);
  after.audience.filter = structuredClone(plan.filter);
  after.members = after.members.filter((row) => row.entityId !== "1");
  after.enrolled[0].isPaused = true;
  return after;
}

test("builds an exact AND restriction preserving the complete original AST", () => {
  const before = fixture(),
    original = structuredClone(before),
    plan = planRestriction(before, held);
  assert.deepEqual(before, original);
  assert.deepEqual(plan.filter.items[0], before.audience.filter);
  assert.equal(plan.filter.items[1].operator, "NotEqual");
  assert.deepEqual(plan.expectedMemberIds, ["2"]);
  assert.equal(plan.readyToResume, false);
  assert.equal(verifyBeforeWrite(before, plan), true);
});

for (const [name, change] of [
  [
    "active campaign",
    (s) => {
      s.campaign.status = "active";
    },
  ],
  [
    "base mismatch",
    (s) => {
      s.campaign.leadBaseSegmentId = "different";
    },
  ],
  [
    "exit pause disabled",
    (s) => {
      s.campaign.settings.autoPauseLeadOnSegmentExit = false;
    },
  ],
  [
    "incomplete pagination",
    (s) => {
      s.complete = false;
    },
  ],
  [
    "shared audience",
    (s) => {
      s.campaigns.push({
        id: "cam_other",
        leadBaseSegmentId: "audseg_test",
        leadExclusionSegmentIds: [],
      });
    },
  ],
  [
    "duplicate email identity",
    (s) => {
      s.members[1].email = "held@example.com";
    },
  ],
])
  test(`refuses ${name}`, () => {
    const s = fixture();
    change(s);
    assert.throws(() => planRestriction(s, held));
  });

test("refuses wrong held identity, duplicates and extra input fields", () => {
  assert.throws(() =>
    planRestriction(fixture(), [{ entityId: "2", email: "held@example.com" }]),
  );
  assert.throws(() => planRestriction(fixture(), [...held, ...held]));
  assert.throws(() => planRestriction(fixture(), [{ ...held[0], filter: {} }]));
});

test("refuses concurrent changes and tampered plans before the caller writes", () => {
  const s = fixture(),
    p = planRestriction(s, held),
    changed = structuredClone(s);
  changed.campaign.settings.senderAccountIds = [];
  assert.throws(() => verifyBeforeWrite(changed, p));
  p.filter.items = [];
  assert.throws(() => verifyBeforeWrite(s, p));
});

test("requires enrolled pause proof even when audience membership changed", () => {
  const s = fixture(),
    p = planRestriction(s, held),
    after = repaired(s, p);
  after.enrolled[0].isPaused = false;
  assert.deepEqual(verifyRestriction(s, p, after).unconfirmedPauseIds, ["1"]);
  assert.equal(verifyRestriction(s, p, after).repairSha256, null);
});

test("refuses additions, extra removals, sequence changes and deleted history", () => {
  const s = fixture(),
    p = planRestriction(s, held);
  for (const change of [
    (a) => {
      a.members.push({ entityId: "3", email: "new@example.com" });
    },
    (a) => {
      a.members = [];
    },
    (a) => {
      a.campaign.sequence = [];
    },
    (a) => {
      a.enrolled = a.enrolled.slice(1);
    },
    (a) => {
      a.enrolled[0].enrolledAt = "2026-10-15T00:00:00Z";
    },
  ]) {
    const a = repaired(s, p);
    change(a);
    assert.throws(() => verifyRestriction(s, p, a));
  }
});

test("refuses a base audience also used as another campaign exclusion", () => {
  const snapshot = fixture();
  snapshot.campaigns.push({
    id: "cam_other",
    leadBaseSegmentId: "audseg_other",
    leadExclusionSegmentIds: ["audseg_test"],
  });
  assert.throws(() => planRestriction(snapshot, held), /shared/);
});

test("refuses missing or malformed campaign exclusion coverage", () => {
  for (const coverage of [undefined, null, "audseg_test", [null]]) {
    const snapshot = fixture();
    snapshot.campaigns.push({
      id: "cam_other",
      leadBaseSegmentId: "audseg_other",
      leadExclusionSegmentIds: coverage,
    });
    assert.throws(() => planRestriction(snapshot, held), /coverage/);
  }
});

test("verified protection never claims resume readiness", () => {
  const s = fixture(),
    p = planRestriction(s, held),
    result = verifyRestriction(s, p, repaired(s, p));
  assert.equal(result.verified, true);
  assert.match(result.repairSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.readyToResume, false);
});
