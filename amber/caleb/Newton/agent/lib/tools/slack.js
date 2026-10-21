/**
 * slack.js — Native Slack Web API integration with per-tenant tokens.
 *
 * Auth (populated by medha-id /v1/oauth/slack/callback):
 *   - SLACK_WORKSPACE_TOKEN (xoxb-…) — workspace-shared bot token,
 *     used for most read/post operations on shared resources.
 *   - SLACK_USER_TOKEN (xoxp-…) — per-user token, required for actions
 *     that must execute AS the user (search.messages, users.profile.set).
 *   - Legacy fallback only: SLACK_BOT_TOKEN env-style key (predates the
 *     OAuth callback). Remove once no live tenant has only the legacy key.
 *
 * Slack response format: { ok: true, ... } or { ok: false, error: "..." }
 * Endpoint base: https://slack.com/api/
 */

import { getSecret } from "../secrets.js";
import { registerCapability } from "../capabilities.js";
import { createSlackCanvas } from "../transports/slack/canvas.js";

registerCapability(
  "_tools_Slack",
  "Send messages, read channels, search messages, manage threads",
);
registerCapability(
  "_tools_Slack",
  "List channels, set user status, reply to threads",
);
registerCapability(
  "_tools_Slack",
  "Create a Slack Canvas for long-form output instead of a wall of chat text",
);

const SLACK_BASE = "https://slack.com/api";

// ── Token resolution ──────────────────────────────────────────────────────────

async function getBotToken(tenant) {
  // SLACK_WORKSPACE_TOKEN is what /v1/oauth/slack/callback persists.
  // SLACK_BOT_TOKEN is the legacy env-style key from before OAuth landed;
  // checked second for tenants that haven't re-OAuth'd yet.
  const workspaceTok = await getSecret(tenant, "SLACK_WORKSPACE_TOKEN");
  if (workspaceTok) return workspaceTok;
  return getSecret(tenant, "SLACK_BOT_TOKEN");
}

async function getUserToken(tenant) {
  return getSecret(tenant, "SLACK_USER_TOKEN");
}

/**
 * Resolve the most appropriate token for an operation.
 *
 * Default `prefer = "user"` because our app's bot scopes are intentionally
 * narrow (im:read, im:write, chat:write, users:read) for the
 * Medha-as-an-app identity. The per-user xoxp is strictly more capable
 * for read/post operations on channels, groups, search, and reactions,
 * so the agent should reach for it first. Set `prefer = "bot"` only for
 * actions that genuinely need to execute as the Medha bot identity.
 *
 * @param {object} tenant
 * @param {"bot"|"user"|"any"} prefer
 */
async function resolveToken(tenant, prefer = "user") {
  if (prefer === "bot") {
    const botTok = await getBotToken(tenant);
    if (botTok) return botTok;
    return getUserToken(tenant);
  }
  const userTok = await getUserToken(tenant);
  if (userTok) return userTok;
  return getBotToken(tenant);
}

// ── Core HTTP client ──────────────────────────────────────────────────────────

/**
 * Call a Slack Web API method.
 *
 * @param {string} method   - Slack API method name (e.g. "chat.postMessage")
 * @param {object} params   - Request parameters
 * @param {string} token    - Bearer token
 * @returns {Promise<{ok: boolean, data: object, error?: string}>}
 */
async function slackCall(method, params, token) {
  let res;
  try {
    res = await fetch(`${SLACK_BASE}/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return { ok: false, data: null, error: err.message };
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return { ok: false, data: null, error: `HTTP ${res.status}` };
  }

  if (!data.ok) {
    return { ok: false, data, error: data.error || "slack-unknown-error" };
  }

  return { ok: true, data };
}

/**
 * Build the connect-page URL the agent surfaces verbatim when Slack
 * isn't wired up yet. Defensive fallback to the bare frontend host if
 * the env var is missing (MEDHA_FRONTEND_URL is required in prod).
 */
function connectPageUrl() {
  const base = (
    process.env.MEDHA_FRONTEND_URL || "https://www.justarock.ai"
  ).replace(/\/+$/, "");
  return `${base}/connect`;
}

/**
 * Standard not-connected reply. Includes a real connect URL so the
 * agent's reply gives the user a single click to fix the missing
 * connection (per the OAuth playbook's NOT_CONNECTED template).
 */
function notConnected() {
  const url = connectPageUrl();
  return {
    error: "slack_not_connected",
    suggestConnect: true,
    connect_url: url,
    message: `Slack isn't connected to your medha-id yet. Connect it here and ask me again: ${url}`,
  };
}

// ── Tool handlers ─────────────────────────────────────────────────────────────

async function sendMessage(input, ctx) {
  const token = await resolveToken(ctx.tenant, "user");
  if (!token) return notConnected();

  const r = await slackCall(
    "chat.postMessage",
    {
      channel: input.channel,
      text: input.text,
    },
    token,
  );

  if (!r.ok) return { error: r.error };
  return {
    sent: true,
    ts: r.data.ts,
    channel: r.data.channel,
    messageId: r.data.message?.ts,
  };
}

async function listChannels(input, ctx) {
  const token = await resolveToken(ctx.tenant, "user");
  if (!token) return notConnected();

  // Paginate so total_count reflects the whole workspace, not just the
  // first 200. Cap at a few pages to keep tail latency bounded — most
  // workspaces fit in one page anyway.
  const channels = [];
  let cursor = "";
  for (let page = 0; page < 5; page++) {
    const params = {
      exclude_archived: true,
      limit: 1000,
      types: "public_channel,private_channel",
    };
    if (cursor) params.cursor = cursor;
    const r = await slackCall("conversations.list", params, token);
    if (!r.ok) return { error: r.error };
    channels.push(...(r.data.channels || []));
    cursor = r.data.response_metadata?.next_cursor || "";
    if (!cursor) break;
  }

  const mapped = channels.map((c) => ({
    id: c.id,
    name: c.name,
    isPrivate: c.is_private,
    isMember: c.is_member,
    topic: c.topic?.value || "",
    purpose: c.purpose?.value || "",
    numMembers: c.num_members,
  }));
  const memberChannels = mapped.filter((c) => c.isMember);
  const nonMemberNames = mapped
    .filter((c) => !c.isMember)
    .map((c) => c.name)
    .sort();

  // Multiple explicit count fields so the model has anchored numbers to
  // quote rather than paraphrase. Without this the model was rounding
  // (e.g., reporting 83 channels when the actual count was 73).
  return {
    total_channels: mapped.length,
    member_channel_count: memberChannels.length,
    non_member_channel_count: nonMemberNames.length,
    member_channels: memberChannels,
    non_member_channel_names: nonMemberNames,
    instructions_for_model:
      "Quote total_channels and member_channel_count EXACTLY as given. Do not round, do not paraphrase the numbers, do not invent additional channels. List every entry in member_channels when the user asks for their channels.",
  };
}

async function readChannel(input, ctx) {
  const token = await resolveToken(ctx.tenant, "user");
  if (!token) return notConnected();

  const limit = Math.min(input.limit || 20, 100);

  const r = await slackCall(
    "conversations.history",
    {
      channel: input.channel,
      limit,
    },
    token,
  );

  if (!r.ok) return { error: r.error };

  const messages = (r.data.messages || []).map((m) => ({
    ts: m.ts,
    user: m.user || m.username || m.bot_id,
    text: m.text,
    threadTs: m.thread_ts,
    replyCount: m.reply_count,
    reactions: (m.reactions || []).map((rx) => ({
      name: rx.name,
      count: rx.count,
    })),
  }));

  return { channel: input.channel, messages };
}

async function searchMessages(input, ctx) {
  // Search requires user token (bot tokens can't search)
  const token =
    (await getUserToken(ctx.tenant)) || (await getBotToken(ctx.tenant));
  if (!token) return notConnected();

  const r = await slackCall(
    "search.messages",
    {
      query: input.query,
      count: Math.min(input.maxResults || 20, 100),
      sort: "timestamp",
      sort_dir: "desc",
    },
    token,
  );

  if (!r.ok) {
    // search.messages requires user token; bot token returns token_type_invalid
    if (
      r.error === "token_type_invalid" ||
      r.error === "not_allowed_token_type"
    ) {
      return {
        error:
          "Slack message search requires a user token (xoxp-). Bot token insufficient.",
        hint: "connect-user-token",
      };
    }
    return { error: r.error };
  }

  const matches = (r.data.messages?.matches || []).map((m) => ({
    ts: m.ts,
    channel: m.channel?.name || m.channel?.id,
    channelId: m.channel?.id,
    user: m.username || m.user,
    text: m.text,
    permalink: m.permalink,
  }));

  return { query: input.query, total: r.data.messages?.total, matches };
}

async function replyThread(input, ctx) {
  const token = await resolveToken(ctx.tenant, "user");
  if (!token) return notConnected();

  const r = await slackCall(
    "chat.postMessage",
    {
      channel: input.channel,
      thread_ts: input.thread_ts,
      text: input.text,
    },
    token,
  );

  if (!r.ok) return { error: r.error };
  return {
    sent: true,
    ts: r.data.ts,
    channel: r.data.channel,
    threadTs: input.thread_ts,
  };
}

async function setStatus(input, ctx) {
  // Setting status requires user token
  const token = await getUserToken(ctx.tenant);
  if (!token) {
    // Try bot token as last resort (will likely fail for status)
    const botToken = await getBotToken(ctx.tenant);
    if (!botToken) return notConnected();
    return {
      error:
        "Setting Slack status requires a user token (xoxp-). Bot token insufficient.",
      hint: "connect-user-token",
    };
  }

  const expiration = input.expires
    ? Math.floor(new Date(input.expires).getTime() / 1000)
    : 0;

  const r = await slackCall(
    "users.profile.set",
    {
      profile: {
        status_text: input.text,
        status_emoji: input.emoji || "",
        status_expiration: expiration,
      },
    },
    token,
  );

  if (!r.ok) return { error: r.error };
  return {
    set: true,
    statusText: input.text,
    statusEmoji: input.emoji || "",
  };
}

// ── Expansion handlers (PR #163) ──────────────────────────────────────────────
// 23 additional Slack operations covering messaging modification, reactions,
// pins, channel management, user lookup, search, and reminders. Each handler
// is a thin wrapper: resolve token → slackCall → return mapped response.

async function editMessage(input, ctx) {
  const token = await resolveToken(ctx.tenant, "user");
  if (!token) return notConnected();
  const r = await slackCall(
    "chat.update",
    { channel: input.channel, ts: input.ts, text: input.text },
    token,
  );
  if (!r.ok) return { error: r.error };
  return { edited: true, channel: r.data.channel, ts: r.data.ts };
}

async function deleteMessage(input, ctx) {
  const token = await resolveToken(ctx.tenant, "user");
  if (!token) return notConnected();
  const r = await slackCall(
    "chat.delete",
    { channel: input.channel, ts: input.ts },
    token,
  );
  if (!r.ok) return { error: r.error };
  return { deleted: true, channel: r.data.channel, ts: r.data.ts };
}

async function scheduleMessage(input, ctx) {
  const token = await resolveToken(ctx.tenant, "user");
  if (!token) return notConnected();
  const postAt = Math.floor(new Date(input.post_at).getTime() / 1000);
  if (!postAt || isNaN(postAt)) {
    return { error: "invalid_post_at_iso" };
  }
  const r = await slackCall(
    "chat.scheduleMessage",
    { channel: input.channel, text: input.text, post_at: postAt },
    token,
  );
  if (!r.ok) return { error: r.error };
  return {
    scheduled: true,
    channel: r.data.channel,
    scheduled_message_id: r.data.scheduled_message_id,
    post_at: r.data.post_at,
  };
}

async function postEphemeral(input, ctx) {
  // Ephemeral messages must come from the bot identity (Slack rule).
  const token = await resolveToken(ctx.tenant, "bot");
  if (!token) return notConnected();
  const r = await slackCall(
    "chat.postEphemeral",
    { channel: input.channel, user: input.user, text: input.text },
    token,
  );
  if (!r.ok) return { error: r.error };
  return { sent: true, message_ts: r.data.message_ts };
}

async function addReaction(input, ctx) {
  const token = await resolveToken(ctx.tenant, "user");
  if (!token) return notConnected();
  const r = await slackCall(
    "reactions.add",
    { channel: input.channel, timestamp: input.ts, name: input.name },
    token,
  );
  if (!r.ok) return { error: r.error };
  return { added: true, name: input.name };
}

async function removeReaction(input, ctx) {
  const token = await resolveToken(ctx.tenant, "user");
  if (!token) return notConnected();
  const r = await slackCall(
    "reactions.remove",
    { channel: input.channel, timestamp: input.ts, name: input.name },
    token,
  );
  if (!r.ok) return { error: r.error };
  return { removed: true, name: input.name };
}

async function pinMessage(input, ctx) {
  const token = await resolveToken(ctx.tenant, "user");
  if (!token) return notConnected();
  const r = await slackCall(
    "pins.add",
    { channel: input.channel, timestamp: input.ts },
    token,
  );
  if (!r.ok) return { error: r.error };
  return { pinned: true, channel: input.channel, ts: input.ts };
}

async function unpinMessage(input, ctx) {
  const token = await resolveToken(ctx.tenant, "user");
  if (!token) return notConnected();
  const r = await slackCall(
    "pins.remove",
    { channel: input.channel, timestamp: input.ts },
    token,
  );
  if (!r.ok) return { error: r.error };
  return { unpinned: true, channel: input.channel, ts: input.ts };
}

async function listPins(input, ctx) {
  const token = await resolveToken(ctx.tenant, "user");
  if (!token) return notConnected();
  const r = await slackCall("pins.list", { channel: input.channel }, token);
  if (!r.ok) return { error: r.error };
  const items = (r.data.items || []).map((it) => ({
    type: it.type,
    created: it.created,
    created_by: it.created_by,
    message_ts: it.message?.ts,
    text: it.message?.text || it.file?.title || null,
  }));
  return { channel: input.channel, pin_count: items.length, items };
}

async function createChannel(input, ctx) {
  // channels:manage is a bot scope; conversations.create needs it.
  const token = await resolveToken(ctx.tenant, "bot");
  if (!token) return notConnected();
  const r = await slackCall(
    "conversations.create",
    { name: input.name, is_private: !!input.is_private },
    token,
  );
  if (!r.ok) return { error: r.error };
  return {
    created: true,
    id: r.data.channel?.id,
    name: r.data.channel?.name,
    is_private: r.data.channel?.is_private,
  };
}

async function inviteToChannel(input, ctx) {
  const token = await resolveToken(ctx.tenant, "user");
  if (!token) return notConnected();
  const users = Array.isArray(input.users)
    ? input.users.join(",")
    : input.users;
  const r = await slackCall(
    "conversations.invite",
    { channel: input.channel, users },
    token,
  );
  if (!r.ok) return { error: r.error };
  return { invited: true, channel: r.data.channel?.id, users };
}

async function joinChannel(input, ctx) {
  const token = await resolveToken(ctx.tenant, "user");
  if (!token) return notConnected();
  const r = await slackCall(
    "conversations.join",
    { channel: input.channel },
    token,
  );
  if (!r.ok) return { error: r.error };
  return {
    joined: true,
    id: r.data.channel?.id,
    name: r.data.channel?.name,
  };
}

async function leaveChannel(input, ctx) {
  const token = await resolveToken(ctx.tenant, "user");
  if (!token) return notConnected();
  const r = await slackCall(
    "conversations.leave",
    { channel: input.channel },
    token,
  );
  if (!r.ok) return { error: r.error };
  return { left: true };
}

async function setChannelTopic(input, ctx) {
  const token = await resolveToken(ctx.tenant, "user");
  if (!token) return notConnected();
  const r = await slackCall(
    "conversations.setTopic",
    { channel: input.channel, topic: input.topic },
    token,
  );
  if (!r.ok) return { error: r.error };
  return { set: true, topic: r.data.channel?.topic?.value || input.topic };
}

async function getChannelInfo(input, ctx) {
  const token = await resolveToken(ctx.tenant, "user");
  if (!token) return notConnected();
  const r = await slackCall(
    "conversations.info",
    { channel: input.channel, include_num_members: true },
    token,
  );
  if (!r.ok) return { error: r.error };
  const c = r.data.channel || {};
  return {
    id: c.id,
    name: c.name,
    is_private: c.is_private,
    is_member: c.is_member,
    is_archived: c.is_archived,
    num_members: c.num_members,
    topic: c.topic?.value || "",
    purpose: c.purpose?.value || "",
    creator: c.creator,
    created: c.created,
  };
}

async function listChannelMembers(input, ctx) {
  const token = await resolveToken(ctx.tenant, "user");
  if (!token) return notConnected();
  const ids = [];
  let cursor = "";
  for (let page = 0; page < 5; page++) {
    const params = { channel: input.channel, limit: 1000 };
    if (cursor) params.cursor = cursor;
    const r = await slackCall("conversations.members", params, token);
    if (!r.ok) return { error: r.error };
    ids.push(...(r.data.members || []));
    cursor = r.data.response_metadata?.next_cursor || "";
    if (!cursor) break;
  }
  return {
    channel: input.channel,
    member_count: ids.length,
    member_user_ids: ids,
  };
}

async function lookupUserByEmail(input, ctx) {
  const token = await resolveToken(ctx.tenant, "user");
  if (!token) return notConnected();
  const r = await slackCall(
    "users.lookupByEmail",
    { email: input.email },
    token,
  );
  if (!r.ok) return { error: r.error };
  const u = r.data.user || {};
  return {
    id: u.id,
    name: u.name,
    real_name: u.real_name,
    email: u.profile?.email || input.email,
    tz: u.tz,
    is_bot: u.is_bot,
    is_admin: u.is_admin,
  };
}

async function listUsers(input, ctx) {
  const token = await resolveToken(ctx.tenant, "user");
  if (!token) return notConnected();
  const users = [];
  let cursor = "";
  for (let page = 0; page < 5; page++) {
    const params = { limit: 200 };
    if (cursor) params.cursor = cursor;
    const r = await slackCall("users.list", params, token);
    if (!r.ok) return { error: r.error };
    for (const u of r.data.members || []) {
      if (u.deleted) continue;
      users.push({
        id: u.id,
        name: u.name,
        real_name: u.real_name,
        email: u.profile?.email || null,
        is_bot: u.is_bot,
        is_admin: u.is_admin,
      });
    }
    cursor = r.data.response_metadata?.next_cursor || "";
    if (!cursor) break;
  }
  return { total_users: users.length, users };
}

async function getUserInfo(input, ctx) {
  const token = await resolveToken(ctx.tenant, "user");
  if (!token) return notConnected();
  const r = await slackCall("users.info", { user: input.user }, token);
  if (!r.ok) return { error: r.error };
  const u = r.data.user || {};
  return {
    id: u.id,
    name: u.name,
    real_name: u.real_name,
    email: u.profile?.email || null,
    tz: u.tz,
    is_bot: u.is_bot,
    is_admin: u.is_admin,
    title: u.profile?.title || null,
    status_text: u.profile?.status_text || null,
    status_emoji: u.profile?.status_emoji || null,
  };
}

async function openDm(input, ctx) {
  const token = await resolveToken(ctx.tenant, "user");
  if (!token) return notConnected();
  const users = Array.isArray(input.users)
    ? input.users.join(",")
    : input.users;
  const r = await slackCall("conversations.open", { users }, token);
  if (!r.ok) return { error: r.error };
  return {
    channel_id: r.data.channel?.id,
    already_open: !!r.data.already_open,
  };
}

async function searchFiles(input, ctx) {
  const token = await resolveToken(ctx.tenant, "user");
  if (!token) return notConnected();
  const r = await slackCall(
    "search.files",
    {
      query: input.query,
      count: Math.min(input.maxResults || 20, 100),
      sort: "timestamp",
      sort_dir: "desc",
    },
    token,
  );
  if (!r.ok) return { error: r.error };
  const matches = (r.data.files?.matches || []).map((f) => ({
    id: f.id,
    name: f.name,
    title: f.title,
    filetype: f.filetype,
    user: f.user,
    permalink: f.permalink,
    url_private: f.url_private,
    created: f.created,
  }));
  return {
    query: input.query,
    total: r.data.files?.total,
    matches,
  };
}

async function addReminder(input, ctx) {
  const token = await resolveToken(ctx.tenant, "user");
  if (!token) return notConnected();
  // Slack accepts free-form English ("tomorrow at 9am") in `time` OR a
  // Unix timestamp. Default to English-passthrough.
  const r = await slackCall(
    "reminders.add",
    { text: input.text, time: input.time, user: input.user || undefined },
    token,
  );
  if (!r.ok) return { error: r.error };
  const rem = r.data.reminder || {};
  return {
    added: true,
    id: rem.id,
    text: rem.text,
    time: rem.time,
    user: rem.user,
  };
}

async function listReminders(input, ctx) {
  const token = await resolveToken(ctx.tenant, "user");
  if (!token) return notConnected();
  const r = await slackCall("reminders.list", {}, token);
  if (!r.ok) return { error: r.error };
  const reminders = (r.data.reminders || []).map((rem) => ({
    id: rem.id,
    text: rem.text,
    time: rem.time,
    recurring: !!rem.recurring,
    complete_ts: rem.complete_ts || null,
  }));
  return { reminder_count: reminders.length, reminders };
}

// ── Canvas (Tab 30) ───────────────────────────────────────────────────────────
// Long-form output (polished newsletter sections, multi-part docs, recaps)
// belongs in a Slack Canvas, not a 2000-char chat.postMessage wall. Canvas
// creation needs the BOT identity (canvases:write is a bot scope), so this
// resolves the bot token specifically rather than the user-token-preferring
// default. The heavy lifting lives in transports/slack/canvas.js so it stays
// pure + unit-testable; this handler is the per-tenant token wrapper.

async function createCanvas(input, ctx) {
  const token = await resolveToken(ctx.tenant, "bot");
  if (!token) return notConnected();

  const result = await createSlackCanvas({
    botToken: token,
    markdown: input.markdown,
    title: input.title,
    channel: input.channel,
    accessLevel: input.access_level,
  });

  if (!result.ok) {
    const out = { error: result.error };
    if (result.scope_needed) {
      out.scope_needed = result.scope_needed;
      out.hint = `Add the \`${result.scope_needed}\` bot scope at https://api.slack.com/apps then reinstall the app.`;
    }
    return out;
  }

  return {
    created: true,
    canvas_id: result.canvas_id,
    permalink: result.permalink || null,
    shared_to_channel: !!result.shared,
    instructions_for_model: result.permalink
      ? "Reply with a short one-line note and the permalink so the user can open the canvas. Do NOT paste the full markdown body back into chat."
      : "Canvas created. Tell the user it's ready; if no permalink is shown, mention it's accessible from the channel's canvas list.",
  };
}

// ── Tool definitions (Claude format) ─────────────────────────────────────────

export const SLACK_TOOLS = [
  {
    name: "slack_send_message",
    description:
      "Send a message to a Slack channel or DM. Channel can be a name (#general) or ID.",
    input_schema: {
      type: "object",
      properties: {
        channel: {
          type: "string",
          description:
            "Channel name (e.g. '#general') or channel/user ID (e.g. 'C1234567890' or 'U1234567890' for DMs).",
        },
        text: {
          type: "string",
          description: "Message text. Supports Slack mrkdwn formatting.",
        },
      },
      required: ["channel", "text"],
    },
  },
  {
    name: "slack_list_channels",
    description:
      "List all Slack channels the bot is a member of or can see, including private channels.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "slack_read_channel",
    description:
      "Read recent messages from a Slack channel. Returns the latest messages.",
    input_schema: {
      type: "object",
      properties: {
        channel: {
          type: "string",
          description: "Channel name or ID.",
        },
        limit: {
          type: "integer",
          description: "Number of messages to fetch (1-100, default 20).",
        },
      },
      required: ["channel"],
    },
  },
  {
    name: "slack_search_messages",
    description:
      "Search for messages across Slack. Requires a user token (xoxp-).",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search query. Supports Slack search modifiers like in:#channel, from:@user, after:2024-01-01.",
        },
        maxResults: {
          type: "integer",
          description: "Max results to return (1-100, default 20).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "slack_reply_thread",
    description: "Reply to a specific thread in a Slack channel.",
    input_schema: {
      type: "object",
      properties: {
        channel: {
          type: "string",
          description: "Channel name or ID containing the thread.",
        },
        thread_ts: {
          type: "string",
          description:
            "Timestamp of the parent message that started the thread (e.g. '1672531200.123456').",
        },
        text: {
          type: "string",
          description: "Reply text. Supports Slack mrkdwn formatting.",
        },
      },
      required: ["channel", "thread_ts", "text"],
    },
  },
  {
    name: "slack_set_status",
    description:
      "Set the Slack user status (text and emoji). Requires a user token.",
    input_schema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description:
            "Status text (e.g. 'In a meeting', 'Working from home').",
        },
        emoji: {
          type: "string",
          description:
            "Status emoji name without colons (e.g. 'calendar', 'house').",
        },
        expires: {
          type: "string",
          description:
            "ISO 8601 datetime when the status should expire (optional). Omit for no expiry.",
        },
      },
      required: ["text"],
    },
  },
  // ── Expansion tools (PR #163) ───────────────────────────────────────────
  {
    name: "slack_edit_message",
    description:
      "Edit a previously-sent Slack message. Provide the channel and timestamp of the original message.",
    input_schema: {
      type: "object",
      properties: {
        channel: { type: "string", description: "Channel ID or name." },
        ts: {
          type: "string",
          description:
            "Timestamp of the message to edit (e.g. '1672531200.123456').",
        },
        text: { type: "string", description: "New message text." },
      },
      required: ["channel", "ts", "text"],
    },
  },
  {
    name: "slack_delete_message",
    description:
      "Delete a Slack message you sent. Provide the channel and timestamp.",
    input_schema: {
      type: "object",
      properties: {
        channel: { type: "string", description: "Channel ID or name." },
        ts: {
          type: "string",
          description: "Timestamp of the message to delete.",
        },
      },
      required: ["channel", "ts"],
    },
  },
  {
    name: "slack_schedule_message",
    description:
      "Schedule a Slack message to be sent at a future time. Accepts ISO 8601 datetime for post_at.",
    input_schema: {
      type: "object",
      properties: {
        channel: { type: "string", description: "Channel ID or name." },
        text: { type: "string", description: "Message text." },
        post_at: {
          type: "string",
          description:
            "ISO 8601 datetime when the message should post (e.g. '2026-05-27T18:00:00-07:00').",
        },
      },
      required: ["channel", "text", "post_at"],
    },
  },
  {
    name: "slack_post_ephemeral",
    description:
      "Send an ephemeral Slack message only visible to one specific user in a channel. Useful for private nudges in a shared channel.",
    input_schema: {
      type: "object",
      properties: {
        channel: {
          type: "string",
          description: "Channel ID where the message appears.",
        },
        user: {
          type: "string",
          description: "Slack user ID who should see the ephemeral message.",
        },
        text: { type: "string", description: "Message text." },
      },
      required: ["channel", "user", "text"],
    },
  },
  {
    name: "slack_add_reaction",
    description: "Add an emoji reaction to a Slack message.",
    input_schema: {
      type: "object",
      properties: {
        channel: {
          type: "string",
          description: "Channel ID containing the message.",
        },
        ts: {
          type: "string",
          description: "Timestamp of the message to react to.",
        },
        name: {
          type: "string",
          description:
            "Emoji name without colons (e.g. 'thumbsup', 'eyes', 'fire').",
        },
      },
      required: ["channel", "ts", "name"],
    },
  },
  {
    name: "slack_remove_reaction",
    description: "Remove an emoji reaction you added to a Slack message.",
    input_schema: {
      type: "object",
      properties: {
        channel: {
          type: "string",
          description: "Channel ID containing the message.",
        },
        ts: { type: "string", description: "Timestamp of the message." },
        name: { type: "string", description: "Emoji name without colons." },
      },
      required: ["channel", "ts", "name"],
    },
  },
  {
    name: "slack_pin_message",
    description: "Pin a Slack message to its channel.",
    input_schema: {
      type: "object",
      properties: {
        channel: {
          type: "string",
          description: "Channel ID containing the message.",
        },
        ts: { type: "string", description: "Timestamp of the message to pin." },
      },
      required: ["channel", "ts"],
    },
  },
  {
    name: "slack_unpin_message",
    description: "Remove a pin from a Slack message.",
    input_schema: {
      type: "object",
      properties: {
        channel: {
          type: "string",
          description: "Channel ID containing the message.",
        },
        ts: {
          type: "string",
          description: "Timestamp of the message to unpin.",
        },
      },
      required: ["channel", "ts"],
    },
  },
  {
    name: "slack_list_pins",
    description: "List all pinned messages in a Slack channel.",
    input_schema: {
      type: "object",
      properties: {
        channel: { type: "string", description: "Channel ID." },
      },
      required: ["channel"],
    },
  },
  {
    name: "slack_create_channel",
    description:
      "Create a new Slack channel. Names must be lowercase, no spaces, max 80 chars.",
    input_schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Channel name (lowercase, hyphens-allowed, no spaces).",
        },
        is_private: {
          type: "boolean",
          description: "If true, creates a private channel. Default false.",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "slack_invite_to_channel",
    description: "Invite one or more users to a Slack channel by user ID.",
    input_schema: {
      type: "object",
      properties: {
        channel: { type: "string", description: "Channel ID to invite to." },
        users: {
          oneOf: [
            { type: "string", description: "Comma-separated user IDs." },
            {
              type: "array",
              items: { type: "string" },
              description: "Array of user IDs.",
            },
          ],
          description: "User IDs to invite (string with commas or array).",
        },
      },
      required: ["channel", "users"],
    },
  },
  {
    name: "slack_join_channel",
    description: "Join a public Slack channel.",
    input_schema: {
      type: "object",
      properties: {
        channel: { type: "string", description: "Channel ID or name." },
      },
      required: ["channel"],
    },
  },
  {
    name: "slack_leave_channel",
    description: "Leave a Slack channel.",
    input_schema: {
      type: "object",
      properties: {
        channel: { type: "string", description: "Channel ID." },
      },
      required: ["channel"],
    },
  },
  {
    name: "slack_set_channel_topic",
    description: "Set the topic of a Slack channel.",
    input_schema: {
      type: "object",
      properties: {
        channel: { type: "string", description: "Channel ID." },
        topic: {
          type: "string",
          description: "New topic text (max 250 chars).",
        },
      },
      required: ["channel", "topic"],
    },
  },
  {
    name: "slack_get_channel_info",
    description:
      "Get detailed info about a Slack channel: name, topic, purpose, member count, privacy, creator.",
    input_schema: {
      type: "object",
      properties: {
        channel: { type: "string", description: "Channel ID." },
      },
      required: ["channel"],
    },
  },
  {
    name: "slack_list_channel_members",
    description:
      "List all member user IDs of a Slack channel. Returns up to 5000 (paginated).",
    input_schema: {
      type: "object",
      properties: {
        channel: { type: "string", description: "Channel ID." },
      },
      required: ["channel"],
    },
  },
  {
    name: "slack_lookup_user_by_email",
    description:
      "Find a Slack user by their email address. Returns user ID, name, and profile info. Use this before slack_open_dm or slack_invite_to_channel when you only have an email.",
    input_schema: {
      type: "object",
      properties: {
        email: { type: "string", description: "Email address to look up." },
      },
      required: ["email"],
    },
  },
  {
    name: "slack_list_users",
    description:
      "List all active (non-deleted) users in the workspace with their IDs, names, and emails. Paginated up to ~1000.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "slack_get_user_info",
    description:
      "Get detailed info about a Slack user by ID: name, email, timezone, title, status.",
    input_schema: {
      type: "object",
      properties: {
        user: {
          type: "string",
          description: "Slack user ID (e.g. 'U0AEBS2UXRB').",
        },
      },
      required: ["user"],
    },
  },
  {
    name: "slack_open_dm",
    description:
      "Open (or reuse) a Slack DM channel with one or more users. Returns the channel_id you can then use with slack_send_message.",
    input_schema: {
      type: "object",
      properties: {
        users: {
          oneOf: [
            {
              type: "string",
              description:
                "Comma-separated user IDs. Use one for a 1:1 DM, multiple for a group DM.",
            },
            { type: "array", items: { type: "string" } },
          ],
          description: "User IDs to open DM with.",
        },
      },
      required: ["users"],
    },
  },
  {
    name: "slack_search_files",
    description:
      "Search Slack files (uploads, snippets, screenshots). Returns titles, permalinks, and upload metadata.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search query. Supports Slack modifiers like in:#channel, from:@user, after:2024-01-01.",
        },
        maxResults: {
          type: "integer",
          description: "Max results (1-100, default 20).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "slack_add_reminder",
    description:
      "Create a Slack reminder. Accepts free-form English time ('tomorrow at 9am', 'in 30 minutes') or Unix timestamp.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "What to remind about." },
        time: {
          type: "string",
          description: "When to remind: free-form English or Unix timestamp.",
        },
        user: {
          type: "string",
          description: "Slack user ID to remind. Omit to remind self.",
        },
      },
      required: ["text", "time"],
    },
  },
  {
    name: "slack_list_reminders",
    description: "List all upcoming Slack reminders for the user.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "slack_create_canvas",
    description:
      "Create a Slack Canvas (a rich, persistent document) from markdown. Use this for ANY long-form Slack output (a polished newsletter section, a multi-part doc, a meeting recap, a plan) instead of dumping a 1000+ char wall of text into the channel. Returns a clickable canvas link to share. Pass the channel you're replying in so the canvas is shared with that channel's members.",
    input_schema: {
      type: "object",
      properties: {
        markdown: {
          type: "string",
          description:
            "The canvas body in Slack-flavored markdown (headings, lists, bold, links).",
        },
        title: {
          type: "string",
          description:
            "Canvas title (shown at the top and in the canvas list).",
        },
        channel: {
          type: "string",
          description:
            "Channel ID to share the canvas with (the channel you're replying in). Optional, but recommended so the canvas appears for that channel's members.",
        },
        access_level: {
          type: "string",
          enum: ["read", "write"],
          description:
            "Access the shared channel gets. 'write' lets members edit, 'read' is view-only. Default 'write'.",
        },
      },
      required: ["markdown"],
    },
  },
];

// ── Dispatcher ────────────────────────────────────────────────────────────────

/**
 * Execute a Slack tool call from Claude's tool_use block.
 *
 * @param {string} toolName
 * @param {object} input     - Claude's tool input
 * @param {object} ctx       - { tenant }
 * @returns {Promise<object>}
 */
export async function executeSlackTool(toolName, input, ctx) {
  console.log(`[slack] ${toolName}`);
  try {
    switch (toolName) {
      case "slack_send_message":
        return await sendMessage(input, ctx);
      case "slack_list_channels":
        return await listChannels(input, ctx);
      case "slack_read_channel":
        return await readChannel(input, ctx);
      case "slack_search_messages":
        return await searchMessages(input, ctx);
      case "slack_reply_thread":
        return await replyThread(input, ctx);
      case "slack_set_status":
        return await setStatus(input, ctx);
      // ── Expansion (PR #163) ──────────────────────────────────────────
      case "slack_edit_message":
        return await editMessage(input, ctx);
      case "slack_delete_message":
        return await deleteMessage(input, ctx);
      case "slack_schedule_message":
        return await scheduleMessage(input, ctx);
      case "slack_post_ephemeral":
        return await postEphemeral(input, ctx);
      case "slack_add_reaction":
        return await addReaction(input, ctx);
      case "slack_remove_reaction":
        return await removeReaction(input, ctx);
      case "slack_pin_message":
        return await pinMessage(input, ctx);
      case "slack_unpin_message":
        return await unpinMessage(input, ctx);
      case "slack_list_pins":
        return await listPins(input, ctx);
      case "slack_create_channel":
        return await createChannel(input, ctx);
      case "slack_invite_to_channel":
        return await inviteToChannel(input, ctx);
      case "slack_join_channel":
        return await joinChannel(input, ctx);
      case "slack_leave_channel":
        return await leaveChannel(input, ctx);
      case "slack_set_channel_topic":
        return await setChannelTopic(input, ctx);
      case "slack_get_channel_info":
        return await getChannelInfo(input, ctx);
      case "slack_list_channel_members":
        return await listChannelMembers(input, ctx);
      case "slack_lookup_user_by_email":
        return await lookupUserByEmail(input, ctx);
      case "slack_list_users":
        return await listUsers(input, ctx);
      case "slack_get_user_info":
        return await getUserInfo(input, ctx);
      case "slack_open_dm":
        return await openDm(input, ctx);
      case "slack_search_files":
        return await searchFiles(input, ctx);
      case "slack_add_reminder":
        return await addReminder(input, ctx);
      case "slack_list_reminders":
        return await listReminders(input, ctx);
      case "slack_create_canvas":
        return await createCanvas(input, ctx);
      default:
        return { error: `Unknown Slack tool: ${toolName}` };
    }
  } catch (err) {
    console.error(`[slack] ${toolName} failed:`, err?.message);
    return { error: err?.message || "slack-tool-error" };
  }
}
