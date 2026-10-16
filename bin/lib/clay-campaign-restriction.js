"use strict";

const crypto = require("node:crypto");

const digest = (value) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const assert = (condition, reason) => {
  if (!condition) throw new Error(reason);
};
const emailKey = (value) => String(value).trim().toLowerCase();
const ids = (rows) => rows.map((row) => String(row.entityId));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function validateSnapshot(snapshot) {
  const { campaign, audience, members, enrolled, campaigns } = snapshot;
  assert(campaign?.status === "paused", "Campaign must currently be paused");
  assert(
    campaign.settings?.autoPauseLeadOnSegmentExit === true,
    "Segment-exit pause must be enabled",
  );
  assert(
    campaign.leadBaseSegmentId === audience?.id,
    "Campaign base audience must match",
  );
  assert(
    audience.entityType === "people",
    "Only people audiences are supported",
  );
  assert(
    audience.filter?.type === "GroupOp",
    "Original filter AST is required",
  );
  assert(
    snapshot.complete === true,
    "Complete membership, enrollment and campaign pages are required",
  );
  assert(
    Array.isArray(members) &&
      Array.isArray(enrolled) &&
      Array.isArray(campaigns),
    "Missing readback collections",
  );
  assert(
    new Set(ids(members)).size === members.length,
    "Duplicate audience entity IDs",
  );
  assert(
    new Set(ids(enrolled)).size === enrolled.length,
    "Duplicate enrollment entity IDs",
  );
  assert(
    members.every(
      (row) =>
        /^\d+$/.test(String(row.entityId)) && typeof row.email === "string",
    ),
    "Membership requires exact entity IDs and email values",
  );
  assert(
    campaigns.every(
      (other) =>
        typeof other.id === "string" &&
        Object.hasOwn(other, "leadBaseSegmentId") &&
        (other.leadBaseSegmentId === null ||
          typeof other.leadBaseSegmentId === "string") &&
        Array.isArray(other.leadExclusionSegmentIds) &&
        other.leadExclusionSegmentIds.every(
          (id) => typeof id === "string" && id.length > 0,
        ),
    ),
    "Complete campaign base/exclusion reference coverage is required",
  );
  assert(
    !campaigns.some(
      (other) =>
        other.id !== campaign.id &&
        (other.leadBaseSegmentId === audience.id ||
          other.leadExclusionSegmentIds.includes(audience.id)),
    ),
    "Base audience is shared by another campaign",
  );
}

function planRestriction(snapshot, holds) {
  validateSnapshot(snapshot);
  assert(
    Array.isArray(holds) && holds.length > 0 && holds.length <= 100,
    "Provide between one and 100 exact holds",
  );
  const normalized = holds.map((hold) => {
    assert(
      hold && Object.keys(hold).sort().join(",") === "email,entityId",
      "Each hold takes only email and entityId",
    );
    assert(
      typeof hold.email === "string" &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(hold.email),
      "Hold email is invalid",
    );
    assert(/^\d+$/.test(String(hold.entityId)), "Hold entity ID is invalid");
    return { entityId: String(hold.entityId), email: emailKey(hold.email) };
  });
  assert(
    new Set(ids(normalized)).size === normalized.length,
    "Duplicate held entity IDs",
  );
  assert(
    new Set(normalized.map((hold) => hold.email)).size === normalized.length,
    "Duplicate held emails",
  );
  for (const hold of normalized) {
    const member = snapshot.members.find(
      (row) => String(row.entityId) === hold.entityId,
    );
    assert(
      member && emailKey(member.email) === hold.email,
      "Held identity must match an existing audience member",
    );
    assert(
      snapshot.members.filter((row) => emailKey(row.email) === hold.email)
        .length === 1,
      "Held email matches multiple entities",
    );
  }
  const filter = {
    type: "GroupOp",
    combinationMode: "And",
    items: [
      structuredClone(snapshot.audience.filter),
      ...normalized.map((hold) => ({
        type: "BinOp",
        key: "email",
        dataPath: ["contact_entity_field_values", "field", "email"],
        operator: "NotEqual",
        value: hold.email,
        entityType: "CONTACT",
      })),
    ],
  };
  const pendingPause = normalized.filter((hold) =>
    snapshot.enrolled.some(
      (row) =>
        String(row.entityId) === hold.entityId &&
        ["active", "enrolled", "pending", "retryable"].includes(row.status) &&
        row.isPaused !== true,
    ),
  );
  return {
    campaignId: snapshot.campaign.id,
    audienceId: snapshot.audience.id,
    beforeSha256: digest(snapshot),
    holds: normalized,
    filter,
    expectedMemberIds: ids(snapshot.members)
      .filter((id) => !ids(normalized).includes(id))
      .sort(),
    pendingPauseIds: ids(pendingPause).sort(),
    request: {
      argv: [
        "audiences",
        "update",
        snapshot.audience.id,
        "--filter",
        JSON.stringify(filter),
      ],
    },
    readyToResume: false,
  };
}

function verifyBeforeWrite(snapshot, plan) {
  validateSnapshot(snapshot);
  assert(
    digest(snapshot) === plan.beforeSha256,
    "Campaign, audience, membership or enrollment changed after preview",
  );
  const rebuilt = planRestriction(snapshot, plan.holds);
  assert(same(rebuilt, plan), "Restriction plan changed after preview");
  return true;
}

function verifyRestriction(snapshot, plan, after) {
  verifyBeforeWrite(snapshot, plan);
  validateSnapshot(after);
  assert(
    after.campaign.id === snapshot.campaign.id &&
      after.audience.id === snapshot.audience.id,
    "Readback identity changed",
  );
  assert(
    same(snapshot.campaign, after.campaign),
    "Campaign settings, sequence or status changed during restriction",
  );
  assert(
    same(after.audience.filter, plan.filter),
    "Provider did not persist the exact restrictive filter",
  );
  assert(
    same(ids(after.members).sort(), plan.expectedMemberIds),
    "Membership changed beyond the exact approved holds",
  );
  assert(
    same(ids(after.enrolled).sort(), ids(snapshot.enrolled).sort()),
    "Original enrollment history changed",
  );
  for (const before of snapshot.enrolled) {
    const row = after.enrolled.find(
      (item) => String(item.entityId) === String(before.entityId),
    );
    assert(
      row.email === before.email && row.enrolledAt === before.enrolledAt,
      "Original enrollment identity or date changed",
    );
    if (!plan.holds.some((hold) => hold.entityId === String(before.entityId)))
      assert(same(row, before), "Unheld enrollment changed during restriction");
  }
  const unconfirmed = plan.pendingPauseIds.filter(
    (id) =>
      after.enrolled.find((row) => String(row.entityId) === id)?.isPaused !==
      true,
  );
  return {
    verified: unconfirmed.length === 0,
    unconfirmedPauseIds: unconfirmed,
    repairSha256: unconfirmed.length ? null : digest({ plan, after }),
    readyToResume: false,
  };
}

module.exports = { planRestriction, verifyBeforeWrite, verifyRestriction };
