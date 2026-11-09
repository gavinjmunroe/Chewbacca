"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  HOLDS,
  collectResumeSnapshot,
  planResume,
} = require("../bin/lib/clay-campaign-recovery-resume");

const CAMPAIGN = "cam_0tmpnciWKD2QKjY3QAT";
const spec = HOLDS[CAMPAIGN];

// Audience record ids arrive as numbers, enrollment ids as strings, as the
// live reads returned them on 2026-10-16.
function reader({ audienceIds, leads, blocked }) {
  const campaign = {
    id: CAMPAIGN,
    name: "Zeutara | Example recovery",
    status: "paused",
    leadBaseSegmentId: spec.audience,
    settings: { senderAccountIds: ["csea_keep"] },
  };
  return async (operation) => {
    if (operation === "campaign") return structuredClone(campaign);
    if (operation === "audience-record-ids-page")
      return { data: audienceIds, cursor: null };
    if (operation === "campaign-leads") return { leads, nextCursor: null };
    if (operation === "blocklist")
      return blocked.map((email_or_domain) => ({ email_or_domain }));
    throw new Error(`unexpected read ${operation}`);
  };
}

const finished = spec.holds.map(([entityId, email]) => ({
  entityId,
  email,
  status: "done",
  isPaused: false,
}));

test("a hold still in the base audience refuses the resume, even when it is finished", async () => {
  const read = reader({
    audienceIds: [Number(spec.holds[0][0]), 2092114930],
    leads: finished,
    blocked: [],
  });
  const snapshot = await collectResumeSnapshot(read, {
    ws: "1372623",
    campaign: CAMPAIGN,
  });
  assert.throws(
    () => planResume(snapshot, { ws: "1372623", campaign: CAMPAIGN }),
    /still in the base audience/,
  );
});

test("an active, unblocked hold refuses the resume", async () => {
  const leads = finished.map((row, i) =>
    i === 0 ? { ...row, status: "active" } : row,
  );
  const read = reader({ audienceIds: [2092114930], leads, blocked: [] });
  const snapshot = await collectResumeSnapshot(read, {
    ws: "1372623",
    campaign: CAMPAIGN,
  });
  assert.throws(
    () => planResume(snapshot, { ws: "1372623", campaign: CAMPAIGN }),
    /could still be emailed/,
  );
});

test("the plan changes only status once every hold is out and safe", async () => {
  const leads = finished.map((row, i) =>
    i === 0 ? { ...row, status: "active" } : row,
  );
  const read = reader({
    audienceIds: [2092114930],
    leads,
    blocked: [spec.holds[0][1]],
  });
  const snapshot = await collectResumeSnapshot(read, {
    ws: "1372623",
    campaign: CAMPAIGN,
  });
  const plan = planResume(snapshot, { ws: "1372623", campaign: CAMPAIGN });
  assert.deepEqual(plan.input, { status: "active" });
  assert.equal(plan.memberCount, 1);
});

test("a campaign outside the three is refused before any read", async () => {
  await assert.rejects(
    collectResumeSnapshot(
      async () => {
        throw new Error("read");
      },
      { ws: "1372623", campaign: "cam_other" },
    ),
    /limited to the three/,
  );
});
