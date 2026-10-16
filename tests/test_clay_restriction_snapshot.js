"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  collectPages,
  collectRestrictionSnapshot,
} = require("../bin/lib/clay-restriction-snapshot");

test("retains cursor envelopes and reads every page", async () => {
  const calls = [];
  const read = async (_op, args) => {
    calls.push(args.cursor);
    return args.cursor ? { data: [2] } : { data: [1], cursor: "next" };
  };
  assert.deepEqual(
    await collectPages(read, "ids", {}, "data", "cursor", String),
    [1, 2],
  );
  assert.deepEqual(calls, [undefined, "next"]);
});

for (const [name, read] of [
  ["lost envelope", async () => [1]],
  [
    "repeated cursor",
    async (_o, args) => ({ data: [args.cursor ? 2 : 1], cursor: "loop" }),
  ],
  [
    "duplicate entity",
    async (_o, a) => (a.cursor ? { data: [1] } : { data: [1], cursor: "next" }),
  ],
  ["empty cursor page", async () => ({ data: [], cursor: "next" })],
])
  test(`refuses ${name}`, async () => {
    await assert.rejects(
      collectPages(read, "ids", {}, "data", "cursor", String),
    );
  });

function reader(overrides = {}) {
  const campaign = {
    id: "cam_test",
    status: "paused",
    leadBaseSegmentId: "audseg_test",
    leadExclusionSegmentIds: [],
    settings: { autoPauseLeadOnSegmentExit: true },
  };
  const audience = {
    id: "audseg_test",
    workspace: { id: "123" },
    entityType: "people",
    filter: { type: "GroupOp", combinationMode: "And", items: [] },
  };
  const responses = {
    campaign,
    audience,
    "campaigns-page": {
      data: [{ id: "cam_test", audience: { id: "audseg_test" } }],
    },
    "audience-record-ids-page": { data: [1, 2] },
    "audience-records": [
      { recordId: 1, fields: { email: "a@example.com" } },
      { recordId: 2, fields: { email: "b@example.com" } },
    ],
    "campaign-leads": {
      leads: [
        {
          entityId: "1",
          email: "a@example.com",
          status: "active",
          isPaused: false,
        },
      ],
      nextCursor: null,
    },
    ...overrides,
  };
  return async (operation) => structuredClone(responses[operation]);
}
const args = { ws: "123", campaign: "cam_test", audience: "audseg_test" };

test("collector establishes completeness from native terminal pages", async () => {
  const result = await collectRestrictionSnapshot(reader(), args);
  assert.equal(result.complete, true);
  assert.deepEqual(
    result.members.map((row) => row.entityId),
    ["1", "2"],
  );
  assert.deepEqual(result.campaigns, [
    {
      id: "cam_test",
      leadBaseSegmentId: "audseg_test",
      leadExclusionSegmentIds: [],
    },
  ]);
});

test("refuses missing record lookup rows and foreign workspace", async () => {
  await assert.rejects(
    collectRestrictionSnapshot(reader({ "audience-records": [] }), args),
  );
  await assert.rejects(
    collectRestrictionSnapshot(
      reader({ audience: { workspace: { id: "999" } } }),
      args,
    ),
  );
});

test("fetches full other campaign exclusion references omitted by list rows", async () => {
  const read = reader({
    "campaigns-page": {
      data: [
        { id: "cam_test", audience: { id: "audseg_test" } },
        { id: "cam_other", audience: { id: "audseg_other" } },
      ],
    },
  });
  const calls = [];
  const snapshot = await collectRestrictionSnapshot(async (op, values) => {
    if (op === "campaign" && values.campaign === "cam_other") {
      calls.push(values.campaign);
      return {
        id: "cam_other",
        leadBaseSegmentId: "audseg_other",
        leadExclusionSegmentIds: ["audseg_test"],
      };
    }
    return read(op, values);
  }, args);
  assert.deepEqual(calls, ["cam_other"]);
  assert.deepEqual(
    snapshot.campaigns.find((row) => row.id === "cam_other")
      .leadExclusionSegmentIds,
    ["audseg_test"],
  );
  const { planRestriction } = require("../bin/lib/clay-campaign-restriction");
  assert.throws(
    () =>
      planRestriction(snapshot, [{ entityId: "1", email: "a@example.com" }]),
    /shared/,
  );
});

test("collector refuses missing and malformed full campaign reference coverage", async () => {
  for (const exclusions of [undefined, null, "audseg_test", [null]]) {
    const read = reader({
      "campaigns-page": {
        data: [
          { id: "cam_test", audience: { id: "audseg_test" } },
          { id: "cam_other" },
        ],
      },
    });
    await assert.rejects(
      collectRestrictionSnapshot((op, values) => {
        if (op === "campaign" && values.campaign === "cam_other")
          return {
            id: "cam_other",
            leadBaseSegmentId: null,
            leadExclusionSegmentIds: exclusions,
          };
        return read(op, values);
      }, args),
      /coverage/,
    );
  }
});

test("refuses a governing campaign changed during the paged read", async () => {
  const read = reader();
  let count = 0;
  await assert.rejects(
    collectRestrictionSnapshot(async (op, values) => {
      const result = await read(op, values);
      if (op === "campaign" && ++count === 2) result.status = "active";
      return result;
    }, args),
  );
});
