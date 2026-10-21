/**
 * team-content.js — Aggregate a teammate's recent output across Slack,
 * Google Drive, and LinkedIn so Sagar can see what the team is shipping
 * without having to ask people directly.
 *
 * Tool surface (Tab 4 dispatch):
 *   show_team_content({ team_member, channels?, window? })
 *
 * Implementation pattern:
 *   - Reuses existing native tool modules (slack.js, drive.js,
 *     linkedin.js) by calling their public executors rather than
 *     duplicating OAuth + API client code. Per-tenant secret
 *     resolution stays in those modules.
 *   - team_member can be a display name ("Shirley Park"), a Slack handle
 *     ("@shirley"), an email, or "all" to fan out across known
 *     teammates surfaced via the Slack user roster.
 *   - LinkedIn org-level post analytics is owned by Tab 5
 *     (linkedin_org_analytics). Until that lands, the linkedin slice
 *     surfaces a structured stub flagging the dependency rather than
 *     pretending the data exists.
 *
 * Caleb / Sagar should never see "blank list" responses. Every channel
 * key in by_channel returns either an array of items or a structured
 * note that explains why it is empty.
 */

import { executeSlackTool } from "./slack.js";
import { executeDriveTool } from "./drive.js";
import { executeLinkedInTool } from "./linkedin.js";
import { registerCapability } from "../capabilities.js";

registerCapability(
  "_tools_TeamContent",
  "Show what a teammate is shipping across Slack, Drive, and LinkedIn",
);

const DEFAULT_WINDOW = "30d";
const SLACK_MAX_MESSAGES = 30;
const DRIVE_MAX_FILES = 30;

// ---------------------------------------------------------------------------
// Tool schemas
// ---------------------------------------------------------------------------

export const TEAM_CONTENT_TOOLS = [
  {
    name: "show_team_content",
    description:
      "Aggregate a teammate's recent visible output across Slack, " +
      "Google Drive, and LinkedIn so the requester can see what the " +
      "person has been shipping without having to ask them directly. " +
      "Use this for prompts like 'what is Shirley doing with content', " +
      "'tell me what the team has been working on', or any 'show me " +
      "team output' style ask.",
    input_schema: {
      type: "object",
      required: ["team_member"],
      properties: {
        team_member: {
          type: "string",
          description:
            "Display name, Slack handle (@user), or email of the " +
            "teammate. Pass 'all' to aggregate across every visible " +
            "teammate in the Slack workspace.",
        },
        channels: {
          type: "array",
          items: {
            type: "string",
            enum: ["slack", "linkedin", "drive", "all"],
          },
          description: "Subset of channels to query. Defaults to all three.",
        },
        window: {
          type: "string",
          enum: ["7d", "30d", "90d"],
          description: "Lookback window. Defaults to 30d.",
        },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export async function executeTeamContentTool(toolName, input, ctx) {
  if (toolName !== "show_team_content") {
    return { error: `Unknown team-content tool: ${toolName}` };
  }

  const tenant = ctx?.tenant ?? ctx;
  const window = normalizeWindow(input?.window);
  const channels = normalizeChannels(input?.channels);
  const memberArg = String(input?.team_member || "").trim();
  if (!memberArg) {
    return { error: "team_member is required" };
  }

  if (memberArg.toLowerCase() === "all") {
    return aggregateAllTeammates({ tenant, channels, window });
  }

  const profile = await resolveTeammate(memberArg, tenant);
  if (profile.error) return profile;

  return aggregateForMember({ profile, tenant, channels, window });
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

async function aggregateForMember({ profile, tenant, channels, window }) {
  const range = windowRange(window);

  const tasks = {};
  if (channels.has("slack")) {
    tasks.slack = fetchSlackOutput(profile, tenant, range);
  }
  if (channels.has("drive")) {
    tasks.drive = fetchDriveOutput(profile, tenant, range);
  }
  if (channels.has("linkedin")) {
    tasks.linkedin = fetchLinkedInOutput(profile, tenant, range);
  }

  const settled = await Promise.all(
    Object.entries(tasks).map(async ([key, p]) => [key, await p]),
  );

  const by_channel = {};
  for (const [key, value] of settled) {
    by_channel[key] = value;
  }

  const totals = buildTotals(by_channel);
  const training_data_gaps = inferTrainingDataGaps(profile, by_channel);

  return {
    member: {
      name: profile.name,
      email: profile.email,
      slack_user_id: profile.slack_user_id,
    },
    window: { label: window, from: range.fromIso, to: range.toIso },
    by_channel,
    totals,
    visual_hint:
      "Render as a per-channel table. Group slack rows by channel, " +
      "drive rows by folder, linkedin rows by post date.",
    training_data_gaps,
  };
}

async function aggregateAllTeammates({ tenant, channels, window }) {
  const roster = await listSlackTeammates(tenant);
  if (roster.error) return roster;

  const members = roster.users.slice(0, 25); // soft cap for payload size
  const results = [];
  for (const u of members) {
    const profile = {
      name: u.real_name || u.name,
      email: u.email,
      slack_user_id: u.id,
      slack_handle: u.name,
    };
    const summary = await aggregateForMember({
      profile,
      tenant,
      channels,
      window,
    });
    results.push(summary);
  }
  return {
    window: { label: window, ...windowRange(window) },
    total_members: results.length,
    members: results,
  };
}

// ---------------------------------------------------------------------------
// Per-channel fetchers
// ---------------------------------------------------------------------------

async function fetchSlackOutput(profile, tenant, range) {
  if (!profile.slack_user_id && !profile.slack_handle && !profile.email) {
    return {
      status: "skipped",
      reason: "no Slack identifier resolved for this person",
      items: [],
    };
  }

  // search.messages takes a free-form query; "from:@handle" filters by author.
  // Fall back to the display name if no handle.
  const author =
    profile.slack_handle || profile.email?.split("@")[0] || profile.name;
  const query = `from:@${author} after:${range.slackAfter}`;

  const res = await executeSlackTool(
    "slack_search_messages",
    { query, maxResults: SLACK_MAX_MESSAGES },
    { tenant },
  );

  if (res?.error) {
    return { status: "error", reason: res.error, items: [] };
  }

  const items = (res?.matches || []).map((m) => ({
    channel: m.channel,
    ts: m.ts,
    summary: truncate(m.text, 240),
    permalink: m.permalink,
  }));

  return {
    status: "ok",
    items,
    query,
  };
}

async function fetchDriveOutput(profile, tenant, range) {
  if (!profile.email) {
    return {
      status: "skipped",
      reason: "no email resolved for this person — cannot query Drive",
      items: [],
    };
  }

  const driveQuery =
    `'${profile.email.replace(/'/g, "\\'")}' in owners ` +
    `and modifiedTime > '${range.fromIso}' and trashed = false`;

  const res = await executeDriveTool(
    "drive_list_files",
    { query: driveQuery, pageSize: DRIVE_MAX_FILES },
    { tenant },
  );

  if (res?.error) {
    return { status: "error", reason: res.error, items: [] };
  }

  const items = (res?.files || []).map((f) => ({
    file: f.name,
    modifiedTime: f.modifiedTime,
    mimeType: f.mimeType,
    url: f.webViewLink,
  }));

  return { status: "ok", items, query: driveQuery };
}

async function fetchLinkedInOutput(profile, tenant, range) {
  // Verify the requester's LinkedIn is connected so the model knows the
  // answer is "tool exists, data does not yet" rather than "Slack is down".
  const me = await executeLinkedInTool("linkedin_me", {}, { tenant });
  if (me?.error) {
    return { status: "error", reason: me.error, items: [] };
  }

  // Per Tab 4 dispatch: the LinkedIn org-analytics surface that would
  // return real per-teammate post counts is owned by Tab 5
  // (linkedin_org_analytics). Until that ships, surface a structured
  // pending status so the model can explain the gap honestly instead of
  // inventing data.
  return {
    status: "pending_tab_5",
    reason:
      "Per-teammate LinkedIn post analytics lands with linkedin_org_analytics " +
      "(Tab 5 of the parallel-tab dispatch). Until then, only the requester's " +
      "own profile is reachable via linkedin_me.",
    items: [],
    requester_linkedin: { name: me?.name, sub: me?.sub },
    window: { from: range.fromIso, to: range.toIso },
  };
}

// ---------------------------------------------------------------------------
// Resolution + helpers
// ---------------------------------------------------------------------------

async function resolveTeammate(memberArg, tenant) {
  if (memberArg.includes("@") && memberArg.includes(".")) {
    // Looks like an email — look up Slack profile by email.
    const r = await executeSlackTool(
      "slack_lookup_user_by_email",
      { email: memberArg },
      { tenant },
    );
    if (r?.error) {
      return {
        name: memberArg,
        email: memberArg,
        slack_user_id: null,
        slack_handle: null,
        note: `Slack lookup failed: ${r.error}`,
      };
    }
    return {
      name: r.real_name || r.name,
      email: r.email || memberArg,
      slack_user_id: r.id,
      slack_handle: r.name,
    };
  }

  // Name or @handle — scan the Slack roster for a match.
  const handle = memberArg.replace(/^@/, "").trim().toLowerCase();
  const list = await listSlackTeammates(tenant);
  if (list.error) return list;
  const match = list.users.find((u) => {
    const candidates = [
      u.name?.toLowerCase(),
      u.real_name?.toLowerCase(),
      u.email?.toLowerCase(),
    ];
    if (candidates.includes(handle)) return true;
    return candidates.some(
      (c) => c && c.replace(/\s+/g, "").includes(handle.replace(/\s+/g, "")),
    );
  });

  if (!match) {
    return {
      error: `Could not resolve team_member "${memberArg}" against the Slack workspace roster.`,
    };
  }

  return {
    name: match.real_name || match.name,
    email: match.email,
    slack_user_id: match.id,
    slack_handle: match.name,
  };
}

async function listSlackTeammates(tenant) {
  const r = await executeSlackTool("slack_list_users", {}, { tenant });
  if (r?.error) return { error: `Slack roster unavailable: ${r.error}` };
  const users = (r.users || []).filter((u) => !u.is_bot);
  return { users };
}

function normalizeWindow(w) {
  if (w === "7d" || w === "30d" || w === "90d") return w;
  return DEFAULT_WINDOW;
}

function normalizeChannels(c) {
  const all = new Set(["slack", "drive", "linkedin"]);
  if (!Array.isArray(c) || c.length === 0) return all;
  if (c.includes("all")) return all;
  const out = new Set();
  for (const k of c) {
    if (all.has(k)) out.add(k);
  }
  return out.size === 0 ? all : out;
}

function windowRange(window) {
  const to = new Date();
  const days = window === "7d" ? 7 : window === "90d" ? 90 : 30;
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    from,
    to,
    fromIso: from.toISOString(),
    toIso: to.toISOString(),
    slackAfter: from.toISOString().slice(0, 10), // YYYY-MM-DD
  };
}

function truncate(s, n) {
  const str = String(s || "");
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}

function buildTotals(byChannel) {
  return {
    slack_messages: byChannel.slack?.items?.length || 0,
    files_touched: byChannel.drive?.items?.length || 0,
    posts: byChannel.linkedin?.items?.length || 0,
  };
}

/**
 * Cheap heuristic. The dispatch document is explicit: don't over-engineer.
 * If a teammate is highly active on Slack but Drive output is thin, the
 * read is "they're talking but not authoring documents — Sagar should
 * write a doc to give them reference material." Inversely if Drive is
 * busy but Slack is silent, the gap is "they're heads-down but
 * unblockers aren't reaching them."
 */
function inferTrainingDataGaps(profile, byChannel) {
  const slackCount = byChannel.slack?.items?.length || 0;
  const driveCount = byChannel.drive?.items?.length || 0;
  const linkedinCount = byChannel.linkedin?.items?.length || 0;
  const gaps = [];
  const name = profile.name || "this teammate";

  if (slackCount >= 5 && driveCount <= 1) {
    gaps.push(
      `${name} is active in Slack but isn't authoring shared docs. ` +
        `Consider writing a short reference doc on the topic they keep ` +
        `discussing so they have something concrete to reference and remix.`,
    );
  }
  if (driveCount >= 3 && slackCount === 0) {
    gaps.push(
      `${name} is heads-down on documents but isn't surfacing them in ` +
        `Slack. Ask them to share progress in a channel so the rest of the ` +
        `team can react and unblock.`,
    );
  }
  if (linkedinCount === 0 && byChannel.linkedin?.status === "pending_tab_5") {
    gaps.push(
      `LinkedIn org-level post visibility ships with Tab 5 ` +
        `(linkedin_org_analytics). Until that merges, treat per-teammate ` +
        `LinkedIn output as unknown.`,
    );
  }
  if (gaps.length === 0) {
    gaps.push(
      `No obvious gaps for ${name} in this window. Drop the Amber product ` +
        `vision into a doc and share it with them so they have raw training ` +
        `data to repurpose.`,
    );
  }
  return gaps;
}
