"use strict";

const crypto = require("node:crypto");
const { collectPages } = require("./clay-restriction-snapshot");
const {
  WORKSPACE_ID,
  CAMPAIGN_IDS,
  ISOLATED_SENDER_IDS,
} = require("./clay-campaign-sender-isolation");

// The exact holds from the 2026-10-16 fresh verification
// (work/incident/recovery-exact-holds-morning.json, 16 rows): bounced,
// catch-all, unknown/greylisted and the two sender-originated bounces. A hold
// is safe when Clay finished the enrollment or the address is blocklisted, and
// it is out of the campaign's base audience either way.
const HOLDS = Object.freeze({
  cam_0tmpnciWKD2QKjY3QAT: {
    audience: "audseg_0tmrvrdf4e2aVqXdcF6",
    holds: [
      ["1746525090", "don.heberle@bnymellon.com"],
      ["1746525053", "msavelov@confideri.info"],
      ["2092113266", "sean@anthemis.com"],
    ],
  },
  cam_0tmpndgzjN7hMBX8m8v: {
    audience: "audseg_0tmt0pizfMjkn8s4QoK",
    holds: [
      ["2092114175", "darren@cleanfood.group"],
      ["2092113807", "lisa@stripes.network"],
      ["1745464595", "cglover@mfi.org"],
      ["1745464585", "hhunt@huntconsolidated.com"],
    ],
  },
  cam_0tmrvre4dsi7pjvsfcy: {
    audience: "audseg_0tmrvrbJX84cuD5oUcw",
    holds: [
      ["1746524523", "mark.hewett@canaccord.com"],
      ["1746524406", "elon@pvfamilyoffice.com"],
      ["1746524263", "cdebacker@bper.ch"],
      ["1746524183", "lcoolidge@lwcotrust.com"],
      ["1746524066", "gusarova@nkbank.ru"],
      ["1746523835", "a.orivel@bpere.eu"],
      ["1746523811", "ps@tungstencapital.de"],
      ["1746523680", "hilly@metzler.com"],
      ["1746523678", "david.cobb@smith.williamson.co.uk"],
    ],
  },
});

const check = (condition, reason) => {
  if (!condition) throw new Error(reason);
};

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
const encode = (value) => JSON.stringify(canonical(value));
const digest = (value) =>
  crypto.createHash("sha256").update(encode(value)).digest("hex");

function comparable(campaign) {
  const copy = canonical(campaign);
  delete copy.updatedAt;
  delete copy.status;
  return copy;
}

async function collectResumeSnapshot(read, args) {
  const spec = HOLDS[args.campaign];
  check(
    String(args.ws) === WORKSPACE_ID &&
      spec &&
      CAMPAIGN_IDS.includes(args.campaign),
    "Recovery resume is limited to the three Zeutara recovery campaigns in workspace 1372623",
  );
  const campaign = await read("campaign", {
    ws: args.ws,
    campaign: args.campaign,
  });
  const members = await collectPages(
    read,
    "audience-record-ids-page",
    { ws: args.ws, audience: spec.audience, limit: "100" },
    "data",
    "cursor",
    (id) => (Number.isSafeInteger(id) && id > 0 ? String(id) : null),
  );
  const enrolled = await collectPages(
    read,
    "campaign-leads",
    { ws: args.ws, campaign: args.campaign, limit: "100" },
    "leads",
    "nextCursor",
    (row) =>
      /^\d+$/.test(String(row?.entityId)) ? String(row.entityId) : null,
  );
  const blocklist = await read("blocklist", { ws: args.ws });
  check(Array.isArray(blocklist), "Blocklist read lost its shape");
  const again = await read("campaign", {
    ws: args.ws,
    campaign: args.campaign,
  });
  check(
    encode(again) === encode(campaign),
    "Campaign changed during the resume snapshot",
  );
  return { campaign, members, enrolled, blocklist };
}

function planResume(snapshot, scope) {
  const spec = HOLDS[scope?.campaign];
  check(
    scope && String(scope.ws) === WORKSPACE_ID && spec,
    "Recovery resume is limited to the three Zeutara recovery campaigns in workspace 1372623",
  );
  const { campaign, members, enrolled, blocklist } = snapshot;
  check(
    campaign?.id === scope.campaign,
    "Campaign does not match the requested scope",
  );
  check(
    campaign.status === "paused",
    "Recovery resume requires a paused campaign",
  );
  check(
    typeof campaign.name === "string" && campaign.name.startsWith("Zeutara |"),
    "Campaign is not a Zeutara campaign",
  );
  check(
    campaign.leadBaseSegmentId === spec.audience,
    "Campaign base audience changed",
  );
  const senders = campaign.settings?.senderAccountIds;
  check(
    Array.isArray(senders) && senders.length > 0,
    "Campaign has no sender accounts",
  );
  check(
    ISOLATED_SENDER_IDS.every((id) => !senders.includes(id)),
    "An incident sender is still assigned; isolate senders before resuming",
  );
  const blocked = new Set(
    blocklist.map((row) => String(row?.email_or_domain || "").toLowerCase()),
  );
  const byId = new Map(enrolled.map((row) => [String(row.entityId), row]));
  const holds = spec.holds.map(([entityId, email]) => {
    check(
      !members.includes(entityId),
      `Held ${email} is still in the base audience`,
    );
    const row = byId.get(entityId);
    const finished = row && row.status === "done";
    const paused = row && row.isPaused === true;
    const onBlocklist =
      blocked.has(email.toLowerCase()) ||
      blocked.has(email.split("@")[1].toLowerCase());
    check(
      finished || paused || onBlocklist,
      `Held ${email} could still be emailed: enrollment active and not blocklisted`,
    );
    return {
      entityId,
      email,
      finished: !!finished,
      paused: !!paused,
      onBlocklist,
    };
  });
  return {
    workspaceId: WORKSPACE_ID,
    campaignId: campaign.id,
    beforeSha256: digest(comparable(campaign)),
    senderCount: senders.length,
    memberCount: members.length,
    enrolledCount: enrolled.length,
    holds,
    input: { status: "active" },
  };
}

function verifyResumeBeforeWrite(snapshot, plan) {
  const rebuilt = planResume(snapshot, {
    ws: plan?.workspaceId,
    campaign: plan?.campaignId,
  });
  check(
    encode(rebuilt) === encode(plan),
    "Campaign drift or resume plan tampering detected",
  );
  return true;
}

function verifyResume(before, plan, after) {
  check(
    after?.id === plan.campaignId,
    "Resume readback returned another campaign",
  );
  check(
    after.status === "active",
    `Resume readback status is ${after.status}, not active`,
  );
  check(
    encode(comparable(after)) === encode(comparable(before.campaign)),
    "Resume readback changed fields beyond status",
  );
  return {
    verified: true,
    campaignId: plan.campaignId,
    status: after.status,
    senderCount: plan.senderCount,
    memberCount: plan.memberCount,
    resumeSha256: digest({ plan, campaign: comparable(after) }),
  };
}

module.exports = {
  HOLDS,
  collectResumeSnapshot,
  planResume,
  verifyResumeBeforeWrite,
  verifyResume,
};
