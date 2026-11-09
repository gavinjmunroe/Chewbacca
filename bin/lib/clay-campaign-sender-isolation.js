"use strict";

const crypto = require("node:crypto");

const WORKSPACE_ID = "1372623";
const CAMPAIGN_IDS = Object.freeze([
  "cam_0tmpnciWKD2QKjY3QAT",
  "cam_0tmpndgzjN7hMBX8m8v",
  "cam_0tmrvre4dsi7pjvsfcy",
]);
// Sender-originated bounce evidence in the 2026-10-15 Zeutara incident.
// Isolation is campaign-local; this helper never deletes an account or
// changes its daily cap, credentials, warmup or assignment elsewhere.
const ISOLATED_SENDER_IDS = Object.freeze([
  "csea_0tma115WdqRmyRGNjsW",
  "csea_0tm9xmwEyHnKWFoZAvS",
]);
const check = (condition, reason) => {
  if (!condition) throw new Error(reason);
};

function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") {
    check(Number.isFinite(value), "Campaign contains a non-JSON number");
    return value;
  }
  if (Array.isArray(value)) return Array.from(value, canonical);
  check(
    value &&
      typeof value === "object" &&
      [Object.prototype, null].includes(Object.getPrototypeOf(value)),
    "Campaign must contain only JSON values",
  );
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
}

function comparable(campaign) {
  const copy = canonical(campaign);
  delete copy.updatedAt;
  return copy;
}
const encode = (value) => JSON.stringify(canonical(value));
const digest = (value) =>
  crypto.createHash("sha256").update(encode(value)).digest("hex");

function validateCampaign(campaign, scope) {
  check(
    scope && scope.ws === WORKSPACE_ID && CAMPAIGN_IDS.includes(scope.campaign),
    "Sender isolation is limited to the three Zeutara recovery campaigns in workspace 1372623",
  );
  check(
    campaign && campaign.id === scope.campaign,
    "Campaign does not match the explicitly requested recovery scope",
  );
  if (Object.hasOwn(campaign, "workspace"))
    check(
      campaign.workspace?.id === WORKSPACE_ID,
      "Embedded campaign workspace does not match",
    );
  if (Object.hasOwn(campaign, "workspaceId"))
    check(
      String(campaign.workspaceId) === WORKSPACE_ID,
      "Embedded campaign workspace does not match",
    );
  check(
    campaign.status === "paused",
    "Sender isolation requires a paused campaign",
  );
  check(
    typeof campaign.name === "string" && campaign.name.startsWith("Zeutara |"),
    "Campaign is not a Zeutara campaign",
  );
  check(
    campaign.settings &&
      typeof campaign.settings === "object" &&
      !Array.isArray(campaign.settings),
    "Campaign settings are missing",
  );
  const senders = campaign.settings.senderAccountIds;
  check(
    Array.isArray(senders) &&
      senders.length > 0 &&
      senders.every(
        (id) => typeof id === "string" && /^csea_[A-Za-z0-9]+$/.test(id),
      ),
    "Campaign sender IDs are missing or malformed",
  );
  check(
    new Set(senders).size === senders.length,
    "Campaign contains duplicate sender IDs",
  );
  canonical(campaign);
  return senders;
}

function planSenderIsolation(campaign, scope) {
  const current = validateCampaign(campaign, scope);
  check(
    ISOLATED_SENDER_IDS.every((id) => current.includes(id)),
    "Both incident sender IDs must be present exactly once",
  );
  const senderAccountIds = current.filter(
    (id) => !ISOLATED_SENDER_IDS.includes(id),
  );
  check(
    senderAccountIds.length > 0,
    "Sender isolation would leave no remaining sender accounts",
  );
  return {
    workspaceId: WORKSPACE_ID,
    campaignId: campaign.id,
    beforeSha256: digest(comparable(campaign)),
    removedSenderIds: [...ISOLATED_SENDER_IDS],
    senderAccountIds,
    input: {
      settings: {
        ...structuredClone(campaign.settings),
        senderAccountIds: [...senderAccountIds],
      },
    },
    readyToResume: false,
  };
}

function verifySenderIsolationBeforeWrite(current, plan) {
  const rebuilt = planSenderIsolation(current, {
    ws: plan?.workspaceId,
    campaign: plan?.campaignId,
  });
  check(
    encode(rebuilt) === encode(plan),
    "Campaign drift or sender-isolation plan tampering detected",
  );
  return true;
}

function verifySenderIsolation(before, plan, after) {
  verifySenderIsolationBeforeWrite(before, plan);
  validateCampaign(after, { ws: plan.workspaceId, campaign: plan.campaignId });
  const expected = comparable(before);
  expected.settings.senderAccountIds = [...plan.senderAccountIds];
  check(
    encode(comparable(after)) === encode(expected),
    "Sender-isolation readback changed fields beyond the two incident sender IDs",
  );
  return {
    verified: true,
    campaignId: plan.campaignId,
    removedSenderIds: [...ISOLATED_SENDER_IDS],
    remainingSenderCount: plan.senderAccountIds.length,
    isolationSha256: digest({ plan, campaign: comparable(after) }),
    readyToResume: false,
  };
}

module.exports = {
  WORKSPACE_ID,
  CAMPAIGN_IDS,
  ISOLATED_SENDER_IDS,
  planSenderIsolation,
  verifySenderIsolationBeforeWrite,
  verifySenderIsolation,
};
