/**
 * microsoft/tools.js: Claude tool definitions + dispatcher for the Microsoft
 * Graph surfaces (Outlook, Calendar, OneDrive, Teams). One consent on
 * medha-id's /v1/oauth/microsoft/init grants tokens that all of these read,
 * via the shared `getMicrosoftAccessToken` helper.
 *
 * The four surfaces split across distinct tool prefixes so a future per-
 * surface disconnect can land without renaming tools, and so the LLM picks
 * the right tool from a user phrase ("send a Teams message" vs "send an
 * email") without a synthetic disambiguation step.
 */

import { registerCapability } from "../../capabilities.js";
import { getSecret } from "../../secrets.js";
import { graphRequest } from "./client.js";

registerCapability(
  "_tools_MicrosoftOutlook",
  "Read inbox messages, search messages by query, send email from the user's Outlook account",
);
registerCapability(
  "_tools_MicrosoftCalendar",
  "List events, check availability, create events, cancel events on the user's Microsoft Calendar",
);
registerCapability(
  "_tools_OneDrive",
  "List and search the user's OneDrive files; fetch file metadata",
);
registerCapability(
  "_tools_MicrosoftTeams",
  "List Teams chats and recent messages, send chat messages, read presence",
);

// Pre-flight: one shared refresh token gates all four surfaces. The split
// prefixes (OUTLOOK_, MSCAL_, ONEDRIVE_, TEAMS_) are read-time overrides
// that don't exist yet on any user, so checking MS_OAUTH_REFRESH is the
// correct presence signal.
async function checkConnected(tenant) {
  const refresh = await getSecret(tenant, "MS_OAUTH_REFRESH");
  return !!refresh;
}

function connectPageUrl() {
  const base = (
    process.env.MEDHA_FRONTEND_URL ||
    "https://www.justarock.ai"
  ).replace(/\/+$/, "");
  return `${base}/connect`;
}

/**
 * Pre-flight NOT_CONNECTED response. Per-surface so the `error` code tells
 * the upstream prompt builder which surface the user was asking about; the
 * `message` is what the agent relays to the user verbatim.
 */
function buildNotConnected(surface) {
  const url = connectPageUrl();
  const surfaceLabel =
    surface === "outlook"
      ? "Outlook"
      : surface === "mscal"
        ? "Microsoft Calendar"
        : surface === "onedrive"
          ? "OneDrive"
          : surface === "teams"
            ? "Microsoft Teams"
            : "Microsoft";
  return {
    error: `${surface}_not_connected`,
    suggestConnect: true,
    connect_url: url,
    message: `${surfaceLabel} isn't connected to your medha-id yet. Connect it here and ask me again: ${url}`,
  };
}

/**
 * Runtime OAuth-required response (refresh failed, scope changed, user
 * revoked in their MS account). Distinct from NOT_CONNECTED so the agent
 * can tell the user "I had your account but something expired" instead of
 * "you never connected".
 */
function oauthRequiredResponse(surface) {
  const url = connectPageUrl();
  const surfaceLabel =
    surface === "outlook"
      ? "Outlook"
      : surface === "mscal"
        ? "Microsoft Calendar"
        : surface === "onedrive"
          ? "OneDrive"
          : surface === "teams"
            ? "Teams"
            : "Microsoft";
  return {
    error: `${surface}_oauth_required`,
    connect_url: url,
    message: `I need to reconnect to your ${surfaceLabel} account before I can do that. Open this link to grant access and then ask me again: ${url}`,
  };
}

// =============================================================================
// Tool schemas (Anthropic Agent API format)
// =============================================================================

const OUTLOOK_TOOLS = [
  {
    name: "outlook_list_inbox",
    description:
      "List the most recent messages in the user's Outlook inbox. Returns id, subject, sender, receivedDateTime, isRead, and a body preview for each.",
    input_schema: {
      type: "object",
      properties: {
        top: {
          type: "integer",
          description: "How many messages to return (default 25, max 50)",
        },
      },
    },
  },
  {
    name: "outlook_search_messages",
    description:
      "Full-text search across the user's Outlook mailbox (subject + body + attendees).",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search string. Microsoft's $search syntax applies.",
        },
        top: {
          type: "integer",
          description: "How many messages to return (default 25, max 50)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "outlook_send_email",
    description:
      "Send an email from the user's Outlook account. Saves to Sent Items by default.",
    input_schema: {
      type: "object",
      properties: {
        to: {
          type: "array",
          items: { type: "string" },
          description: "Recipient email addresses",
        },
        subject: { type: "string", description: "Subject line" },
        body: {
          type: "string",
          description: "Plain-text or HTML body (Graph auto-detects)",
        },
        cc: {
          type: "array",
          items: { type: "string" },
          description: "Optional CC recipients",
        },
        bcc: {
          type: "array",
          items: { type: "string" },
          description: "Optional BCC recipients",
        },
        html: {
          type: "boolean",
          description: "Set true if body is HTML (default false / plain text)",
        },
      },
      required: ["to", "subject", "body"],
    },
  },
];

const MSCAL_TOOLS = [
  {
    name: "mscal_list_events",
    description:
      "List events on the user's Microsoft Calendar over a time window. Defaults to the next 7 days.",
    input_schema: {
      type: "object",
      properties: {
        time_min: {
          type: "string",
          description: "Window start (ISO 8601). Defaults to now.",
        },
        time_max: {
          type: "string",
          description: "Window end (ISO 8601). Defaults to 7 days from now.",
        },
        max_results: {
          type: "integer",
          description: "Cap on events returned (default 10, max 50).",
        },
      },
    },
  },
  {
    name: "mscal_get_availability",
    description:
      "Check freebusy across one or more attendees over a time window. Returns each attendee's busy slots.",
    input_schema: {
      type: "object",
      properties: {
        attendees: {
          type: "array",
          items: { type: "string" },
          description:
            "Email addresses to check (the user is included automatically).",
        },
        time_min: {
          type: "string",
          description: "Window start (ISO 8601).",
        },
        time_max: {
          type: "string",
          description: "Window end (ISO 8601).",
        },
      },
      required: ["time_min", "time_max"],
    },
  },
  {
    name: "mscal_create_event",
    description: "Create an event on the user's Microsoft Calendar.",
    input_schema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "Event title" },
        start: {
          type: "string",
          description:
            "Start time as ISO 8601 (e.g. 2026-05-26T14:00:00-07:00)",
        },
        end: { type: "string", description: "End time as ISO 8601" },
        body: { type: "string", description: "Optional description" },
        location: { type: "string", description: "Optional location" },
        attendees: {
          type: "array",
          items: { type: "string" },
          description: "Optional attendee email addresses",
        },
      },
      required: ["subject", "start", "end"],
    },
  },
  {
    name: "mscal_cancel_event",
    description: "Cancel (delete) an event by its Microsoft Calendar event id.",
    input_schema: {
      type: "object",
      properties: {
        event_id: {
          type: "string",
          description: "Microsoft Calendar event id (from mscal_list_events).",
        },
      },
      required: ["event_id"],
    },
  },
];

const ONEDRIVE_TOOLS = [
  {
    name: "onedrive_list_files",
    description:
      "List files and folders in the user's OneDrive. Defaults to the root.",
    input_schema: {
      type: "object",
      properties: {
        top: {
          type: "integer",
          description: "How many items to return (default 25, max 100).",
        },
      },
    },
  },
  {
    name: "onedrive_search_files",
    description:
      "Search the user's OneDrive for files matching a query string (filename + content).",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search term" },
      },
      required: ["query"],
    },
  },
  {
    name: "onedrive_get_file_metadata",
    description:
      "Get metadata for a single OneDrive item (size, mimeType, lastModifiedDateTime, web URL).",
    input_schema: {
      type: "object",
      properties: {
        file_id: { type: "string", description: "OneDrive item id" },
      },
      required: ["file_id"],
    },
  },
];

const TEAMS_TOOLS = [
  {
    name: "teams_list_chats",
    description:
      "List the user's recent Teams chats (1:1 and group). Returns chat id, topic, and last-message timestamp.",
    input_schema: {
      type: "object",
      properties: {
        top: {
          type: "integer",
          description: "How many chats to return (default 25, max 50).",
        },
      },
    },
  },
  {
    name: "teams_list_recent_messages",
    description: "List recent messages in a specific Teams chat.",
    input_schema: {
      type: "object",
      properties: {
        chat_id: {
          type: "string",
          description: "Teams chat id (from teams_list_chats).",
        },
        top: {
          type: "integer",
          description: "How many messages (default 25, max 50).",
        },
      },
      required: ["chat_id"],
    },
  },
  {
    name: "teams_send_chat_message",
    description: "Post a message into a Teams chat as the user.",
    input_schema: {
      type: "object",
      properties: {
        chat_id: {
          type: "string",
          description: "Teams chat id to post into.",
        },
        body: {
          type: "string",
          description: "Message body (plain text; basic HTML accepted).",
        },
      },
      required: ["chat_id", "body"],
    },
  },
  {
    name: "teams_get_presence",
    description:
      "Read the user's current Teams presence (Available, Busy, DoNotDisturb, Offline, etc).",
    input_schema: { type: "object", properties: {} },
  },
];

export const MICROSOFT_TOOLS = [
  ...OUTLOOK_TOOLS,
  ...MSCAL_TOOLS,
  ...ONEDRIVE_TOOLS,
  ...TEAMS_TOOLS,
];

// Set lookup for the dispatcher and tool-selector.
export const MICROSOFT_TOOL_NAMES = new Set(MICROSOFT_TOOLS.map((t) => t.name));

// =============================================================================
// Handlers (one per tool, grouped by surface)
// =============================================================================

function cap(n, max, fallback) {
  const i = Math.floor(Number(n) || fallback);
  return Math.max(1, Math.min(max, i));
}

function recipientList(addresses) {
  return (addresses || [])
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));
}

function formatMessage(m) {
  return {
    id: m.id,
    subject: m.subject,
    from: m.from?.emailAddress?.address,
    fromName: m.from?.emailAddress?.name,
    receivedDateTime: m.receivedDateTime,
    isRead: m.isRead,
    bodyPreview: m.bodyPreview,
    webLink: m.webLink,
  };
}

function formatEvent(e) {
  return {
    id: e.id,
    subject: e.subject,
    start: e.start?.dateTime,
    end: e.end?.dateTime,
    timeZone: e.start?.timeZone,
    location: e.location?.displayName,
    organizer: e.organizer?.emailAddress?.address,
    attendees: (e.attendees || []).map((a) => a.emailAddress?.address),
    webLink: e.webLink,
  };
}

function formatDriveItem(it) {
  return {
    id: it.id,
    name: it.name,
    isFolder: !!it.folder,
    size: it.size,
    lastModifiedDateTime: it.lastModifiedDateTime,
    webUrl: it.webUrl,
    mimeType: it.file?.mimeType,
  };
}

// ----- Outlook ---------------------------------------------------------------

async function handleOutlookListInbox(input, tenant) {
  const top = cap(input?.top, 50, 25);
  const res = await graphRequest({
    tenant,
    service: "outlook",
    method: "GET",
    path: "/me/mailFolders/inbox/messages",
    query: {
      $top: top,
      $select: "id,subject,from,receivedDateTime,isRead,bodyPreview,webLink",
      $orderby: "receivedDateTime desc",
    },
  });
  if (!res.ok) return { error: res.error || "outlook_list_failed" };
  return {
    success: true,
    messages: (res.data?.value || []).map(formatMessage),
  };
}

async function handleOutlookSearchMessages(input, tenant) {
  const top = cap(input?.top, 50, 25);
  const query = String(input?.query || "").trim();
  if (!query) return { error: "missing_query" };
  const res = await graphRequest({
    tenant,
    service: "outlook",
    method: "GET",
    path: "/me/messages",
    query: {
      $top: top,
      $search: `"${query.replace(/"/g, '\\"')}"`,
      $select: "id,subject,from,receivedDateTime,isRead,bodyPreview,webLink",
    },
  });
  if (!res.ok) return { error: res.error || "outlook_search_failed" };
  return {
    success: true,
    query,
    messages: (res.data?.value || []).map(formatMessage),
  };
}

async function handleOutlookSendEmail(input, tenant) {
  const { to, subject, body, cc, bcc, html } = input || {};
  if (!Array.isArray(to) || to.length === 0) return { error: "missing_to" };
  if (!subject) return { error: "missing_subject" };
  if (!body) return { error: "missing_body" };

  const message = {
    subject,
    body: { contentType: html ? "HTML" : "Text", content: body },
    toRecipients: recipientList(to),
    ccRecipients: recipientList(cc),
    bccRecipients: recipientList(bcc),
  };

  const res = await graphRequest({
    tenant,
    service: "outlook",
    method: "POST",
    path: "/me/sendMail",
    body: { message, saveToSentItems: true },
  });
  if (!res.ok) return { error: res.error || "outlook_send_failed" };
  return { success: true, to, subject };
}

// ----- MS Calendar -----------------------------------------------------------

async function handleMscalListEvents(input, tenant) {
  const now = new Date().toISOString();
  const defaultMax = new Date(
    Date.now() + 7 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const startDateTime = input?.time_min || now;
  const endDateTime = input?.time_max || defaultMax;
  const top = cap(input?.max_results, 50, 10);

  const res = await graphRequest({
    tenant,
    service: "mscal",
    method: "GET",
    path: "/me/calendarView",
    query: {
      startDateTime,
      endDateTime,
      $top: top,
      $orderby: "start/dateTime",
      $select: "id,subject,start,end,location,organizer,attendees,webLink",
    },
  });
  if (!res.ok) return { error: res.error || "mscal_list_failed" };
  return {
    success: true,
    window: { from: startDateTime, to: endDateTime },
    events: (res.data?.value || []).map(formatEvent),
  };
}

async function handleMscalGetAvailability(input, tenant) {
  const { attendees = [], time_min, time_max } = input || {};
  if (!time_min || !time_max) return { error: "missing_window" };

  const res = await graphRequest({
    tenant,
    service: "mscal",
    method: "POST",
    path: "/me/calendar/getSchedule",
    body: {
      schedules: attendees,
      startTime: { dateTime: time_min, timeZone: "UTC" },
      endTime: { dateTime: time_max, timeZone: "UTC" },
      availabilityViewInterval: 30,
    },
  });
  if (!res.ok) return { error: res.error || "mscal_availability_failed" };
  const value = res.data?.value || [];
  return {
    success: true,
    window: { from: time_min, to: time_max },
    schedules: value.map((s) => ({
      scheduleId: s.scheduleId,
      availabilityView: s.availabilityView,
      busyIntervals: (s.scheduleItems || [])
        .filter((it) => it.status === "busy" || it.status === "oof")
        .map((it) => ({
          start: it.start?.dateTime,
          end: it.end?.dateTime,
          status: it.status,
        })),
    })),
  };
}

async function handleMscalCreateEvent(input, tenant) {
  const { subject, start, end, body, location, attendees } = input || {};
  if (!subject || !start || !end) return { error: "missing_fields" };

  const eventBody = {
    subject,
    start: { dateTime: start, timeZone: "UTC" },
    end: { dateTime: end, timeZone: "UTC" },
  };
  if (body) eventBody.body = { contentType: "Text", content: body };
  if (location) eventBody.location = { displayName: location };
  if (Array.isArray(attendees) && attendees.length > 0) {
    eventBody.attendees = attendees.map((address) => ({
      emailAddress: { address },
      type: "required",
    }));
  }

  const res = await graphRequest({
    tenant,
    service: "mscal",
    method: "POST",
    path: "/me/events",
    body: eventBody,
  });
  if (!res.ok) return { error: res.error || "mscal_create_failed" };
  return { success: true, event: formatEvent(res.data) };
}

async function handleMscalCancelEvent(input, tenant) {
  const { event_id } = input || {};
  if (!event_id) return { error: "missing_event_id" };

  const res = await graphRequest({
    tenant,
    service: "mscal",
    method: "DELETE",
    path: `/me/events/${encodeURIComponent(event_id)}`,
  });
  if (!res.ok) return { error: res.error || "mscal_cancel_failed" };
  return { success: true, event_id };
}

// ----- OneDrive --------------------------------------------------------------

async function handleOnedriveListFiles(input, tenant) {
  const top = cap(input?.top, 100, 25);
  const res = await graphRequest({
    tenant,
    service: "onedrive",
    method: "GET",
    path: "/me/drive/root/children",
    query: {
      $top: top,
      $select: "id,name,folder,file,size,lastModifiedDateTime,webUrl",
    },
  });
  if (!res.ok) return { error: res.error || "onedrive_list_failed" };
  return {
    success: true,
    items: (res.data?.value || []).map(formatDriveItem),
  };
}

async function handleOnedriveSearchFiles(input, tenant) {
  const query = String(input?.query || "").trim();
  if (!query) return { error: "missing_query" };
  // Graph search endpoint embeds the query in the path; sanitize quotes.
  const safe = query.replace(/'/g, "''");
  const res = await graphRequest({
    tenant,
    service: "onedrive",
    method: "GET",
    path: `/me/drive/root/search(q='${encodeURIComponent(safe)}')`,
    query: {
      $top: 25,
      $select: "id,name,folder,file,size,lastModifiedDateTime,webUrl",
    },
  });
  if (!res.ok) return { error: res.error || "onedrive_search_failed" };
  return {
    success: true,
    query,
    items: (res.data?.value || []).map(formatDriveItem),
  };
}

async function handleOnedriveGetFileMetadata(input, tenant) {
  const { file_id } = input || {};
  if (!file_id) return { error: "missing_file_id" };
  const res = await graphRequest({
    tenant,
    service: "onedrive",
    method: "GET",
    path: `/me/drive/items/${encodeURIComponent(file_id)}`,
  });
  if (!res.ok) return { error: res.error || "onedrive_get_failed" };
  return { success: true, item: formatDriveItem(res.data || {}) };
}

// ----- Teams -----------------------------------------------------------------

async function handleTeamsListChats(input, tenant) {
  const top = cap(input?.top, 50, 25);
  const res = await graphRequest({
    tenant,
    service: "teams",
    method: "GET",
    path: "/me/chats",
    query: {
      $top: top,
      $orderby: "lastUpdatedDateTime desc",
    },
  });
  if (!res.ok) return { error: res.error || "teams_chats_failed" };
  return {
    success: true,
    chats: (res.data?.value || []).map((c) => ({
      id: c.id,
      topic: c.topic,
      chatType: c.chatType,
      lastUpdatedDateTime: c.lastUpdatedDateTime,
      webUrl: c.webUrl,
    })),
  };
}

async function handleTeamsListRecentMessages(input, tenant) {
  const { chat_id } = input || {};
  if (!chat_id) return { error: "missing_chat_id" };
  const top = cap(input?.top, 50, 25);
  const res = await graphRequest({
    tenant,
    service: "teams",
    method: "GET",
    path: `/me/chats/${encodeURIComponent(chat_id)}/messages`,
    query: { $top: top },
  });
  if (!res.ok) return { error: res.error || "teams_messages_failed" };
  return {
    success: true,
    chat_id,
    messages: (res.data?.value || []).map((m) => ({
      id: m.id,
      createdDateTime: m.createdDateTime,
      from: m.from?.user?.displayName,
      content: m.body?.content,
      contentType: m.body?.contentType,
    })),
  };
}

async function handleTeamsSendChatMessage(input, tenant) {
  const { chat_id, body } = input || {};
  if (!chat_id) return { error: "missing_chat_id" };
  if (!body) return { error: "missing_body" };
  const res = await graphRequest({
    tenant,
    service: "teams",
    method: "POST",
    path: `/me/chats/${encodeURIComponent(chat_id)}/messages`,
    body: { body: { contentType: "text", content: body } },
  });
  if (!res.ok) return { error: res.error || "teams_send_failed" };
  return { success: true, message_id: res.data?.id, chat_id };
}

async function handleTeamsGetPresence(_input, tenant) {
  const res = await graphRequest({
    tenant,
    service: "teams",
    method: "GET",
    path: "/me/presence",
  });
  if (!res.ok) return { error: res.error || "teams_presence_failed" };
  return {
    success: true,
    availability: res.data?.availability,
    activity: res.data?.activity,
  };
}

// =============================================================================
// Dispatcher
// =============================================================================

const SURFACE_BY_PREFIX = {
  outlook_: "outlook",
  mscal_: "mscal",
  onedrive_: "onedrive",
  teams_: "teams",
};

function surfaceForTool(toolName) {
  for (const [prefix, surface] of Object.entries(SURFACE_BY_PREFIX)) {
    if (toolName.startsWith(prefix)) return surface;
  }
  return "ms";
}

/**
 * Route a Microsoft tool_use to the right handler. Pre-flights the
 * connection check, catches the runtime oauth_required throw, and returns
 * shaped errors that the agent loop relays to the user verbatim.
 */
export async function executeMicrosoftTool(toolName, input, ctx) {
  const tenant = ctx?.tenant || ctx;
  const surface = surfaceForTool(toolName);

  const connected = await checkConnected(tenant);
  if (!connected) return buildNotConnected(surface);

  try {
    switch (toolName) {
      case "outlook_list_inbox":
        return await handleOutlookListInbox(input, tenant);
      case "outlook_search_messages":
        return await handleOutlookSearchMessages(input, tenant);
      case "outlook_send_email":
        return await handleOutlookSendEmail(input, tenant);
      case "mscal_list_events":
        return await handleMscalListEvents(input, tenant);
      case "mscal_get_availability":
        return await handleMscalGetAvailability(input, tenant);
      case "mscal_create_event":
        return await handleMscalCreateEvent(input, tenant);
      case "mscal_cancel_event":
        return await handleMscalCancelEvent(input, tenant);
      case "onedrive_list_files":
        return await handleOnedriveListFiles(input, tenant);
      case "onedrive_search_files":
        return await handleOnedriveSearchFiles(input, tenant);
      case "onedrive_get_file_metadata":
        return await handleOnedriveGetFileMetadata(input, tenant);
      case "teams_list_chats":
        return await handleTeamsListChats(input, tenant);
      case "teams_list_recent_messages":
        return await handleTeamsListRecentMessages(input, tenant);
      case "teams_send_chat_message":
        return await handleTeamsSendChatMessage(input, tenant);
      case "teams_get_presence":
        return await handleTeamsGetPresence(input, tenant);
      default:
        return { error: `unknown_microsoft_tool:${toolName}` };
    }
  } catch (err) {
    if (err?.code === "microsoft_oauth_required") {
      return oauthRequiredResponse(surface);
    }
    console.error("[microsoft/tools] Unexpected error in", toolName, err);
    return { error: err.message || "internal_microsoft_error" };
  }
}
