"use strict";

const check = (ok, message) => {
  if (!ok) throw new Error(message);
};

// Bounded operational protection, not a provider limit. Reaching this bound
// means completeness is unknown and must refuse the write.
const MAX_PAGES = 100;

async function collectPages(
  read,
  operation,
  args,
  rowsKey,
  cursorKey,
  identity,
) {
  const rows = [],
    seenIds = new Set(),
    seenCursors = new Set();
  let cursor;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await read(operation, {
      ...args,
      ...(cursor ? { cursor } : {}),
    });
    check(
      data && Array.isArray(data[rowsKey]),
      `${operation} lost its page envelope`,
    );
    for (const row of data[rowsKey]) {
      const id = identity(row);
      check(
        id && !seenIds.has(id),
        `${operation} returned a duplicate or invalid identity`,
      );
      seenIds.add(id);
      rows.push(row);
    }
    const next = data[cursorKey];
    if (next === undefined || next === null) return rows;
    check(
      typeof next === "string" && next.length > 0 && !seenCursors.has(next),
      `${operation} returned an invalid or repeated cursor`,
    );
    check(
      data[rowsKey].length > 0,
      `${operation} returned an empty page with a cursor`,
    );
    seenCursors.add(next);
    cursor = next;
  }
  throw new Error(`${operation} exceeded the bounded page budget`);
}

async function collectRestrictionSnapshot(read, args) {
  const campaign = await read("campaign", {
    ws: args.ws,
    campaign: args.campaign,
  });
  check(
    campaign?.id === args.campaign &&
      campaign.leadBaseSegmentId === args.audience,
    "Campaign/base identity mismatch",
  );
  const audience = await read("audience", { audience: args.audience });
  check(
    String(audience.workspace?.id) === String(args.ws),
    "Audience belongs to another workspace",
  );
  const listedCampaigns = await collectPages(
    read,
    "campaigns-page",
    { ws: args.ws, limit: "100" },
    "data",
    "cursor",
    (row) => (typeof row?.id === "string" ? row.id : null),
  );
  // Native campaign-list rows omit exclusions. Fetch every full campaign so a
  // restriction cannot remove an exclusion protecting a different campaign.
  const campaigns = [];
  for (const row of listedCampaigns) {
    const full =
      row.id === campaign.id
        ? campaign
        : await read("campaign", { ws: args.ws, campaign: row.id });
    check(
      full?.id === row.id &&
        Object.hasOwn(full, "leadBaseSegmentId") &&
        (full.leadBaseSegmentId === null ||
          typeof full.leadBaseSegmentId === "string") &&
        Array.isArray(full.leadExclusionSegmentIds) &&
        full.leadExclusionSegmentIds.every(
          (id) => typeof id === "string" && id.length > 0,
        ),
      "Full campaign base/exclusion reference coverage is missing or malformed",
    );
    campaigns.push({
      id: full.id,
      leadBaseSegmentId: full.leadBaseSegmentId,
      leadExclusionSegmentIds: full.leadExclusionSegmentIds,
    });
  }
  const recordIds = await collectPages(
    read,
    "audience-record-ids-page",
    { ws: args.ws, audience: args.audience, limit: "100" },
    "data",
    "cursor",
    (id) => (Number.isSafeInteger(id) && id > 0 ? String(id) : null),
  );
  const members = [];
  for (let start = 0; start < recordIds.length; start += 100) {
    const requested = recordIds.slice(start, start + 100).map(String);
    const records = await read("audience-records", {
      ids: requested.join(","),
    });
    check(
      Array.isArray(records) && records.length === requested.length,
      "Audience record lookup omitted members",
    );
    const returned = records.map((row) => String(row.recordId));
    check(
      new Set(returned).size === returned.length &&
        returned.every((id) => requested.includes(id)),
      "Audience record lookup changed identities",
    );
    members.push(
      ...records.map((row) => ({
        entityId: String(row.recordId),
        email: row.fields?.email,
      })),
    );
  }
  const enrolled = await collectPages(
    read,
    "campaign-leads",
    { ws: args.ws, campaign: args.campaign, limit: "100" },
    "leads",
    "nextCursor",
    (row) =>
      /^\d+$/.test(String(row?.entityId)) ? String(row.entityId) : null,
  );
  // Re-read the governing objects to detect changes during a paged scan.
  const finalCampaign = await read("campaign", {
    ws: args.ws,
    campaign: args.campaign,
  });
  const finalAudience = await read("audience", { audience: args.audience });
  check(
    JSON.stringify(finalCampaign) === JSON.stringify(campaign) &&
      JSON.stringify(finalAudience) === JSON.stringify(audience),
    "Campaign or audience changed during snapshot collection",
  );
  check(
    campaigns.some((row) => row.id === campaign.id),
    "Campaign list did not contain the target campaign",
  );
  return {
    campaign,
    audience,
    members: members.sort((a, b) => a.entityId.localeCompare(b.entityId)),
    enrolled: enrolled.sort((a, b) =>
      String(a.entityId).localeCompare(String(b.entityId)),
    ),
    campaigns: campaigns.sort((a, b) => a.id.localeCompare(b.id)),
    complete: true,
  };
}

module.exports = { collectPages, collectRestrictionSnapshot };
