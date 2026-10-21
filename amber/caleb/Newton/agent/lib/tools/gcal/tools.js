/**
 * gcal/tools.js — Claude tool definitions and dispatcher for Google Calendar.
 *
 * Tools exposed to Claude:
 *   schedule_event     — create an event on a dimension's calendar
 *   get_availability   — freebusy across all six dimension calendars
 *   list_events        — list upcoming events (one or all dimensions)
 *   reschedule_event   — update an event's start/end time
 *   cancel_event       — delete an event
 *
 * Also exports:
 *   freebusyFor(tenant, dimension, window) — s2s helper for check-in scheduler
 */

import { registerCapability } from "../../capabilities.js";
import { getSecret } from "../../secrets.js";
import { MEDHA_ID_URL } from "../../constants.js";
import {
  resolveCalendarId,
  DIMENSIONS,
  provisionHealthCalendars,
} from "./provisioner.js";
import {
  listEvents as apiListEvents,
  insertEvent,
  patchEvent,
  deleteEvent,
  queryFreebusy,
  resolveAccessToken,
  listCalendarList,
} from "./client.js";
import {
  hasExplicitOffset as hasExplicitOffsetImpl,
  normalizeWindowBound,
} from "./window.js";

// ── Capability registration ───────────────────────────────────────────────────

registerCapability(
  "_tools_GoogleCalendar",
  "Schedule, reschedule, and cancel events on dimension-specific Google Calendars",
);
registerCapability(
  "_tools_GoogleCalendar",
  "Check availability (freebusy) across all six life dimensions",
);
registerCapability(
  "_tools_GoogleCalendar",
  "List upcoming events for any or all life dimensions",
);

// ── Utility ───────────────────────────────────────────────────────────────────

/**
 * Build the connect-page URL on medha-frontend. This is where the user
 * clicks Connect Google to grant Calendar/Gmail/Drive in one consent.
 * The 5f4f deploy is the canonical user-facing surface (the bare
 * medha-frontend-production hostname is a different app).
 */
function connectPageUrl() {
  const base = (
    process.env.MEDHA_FRONTEND_URL ||
    "https://www.justarock.ai"
  ).replace(/\/+$/, "");
  return `${base}/connect`;
}

/**
 * Canonical "not connected" response — never throw.
 *
 * The `message` field is the FINAL user-facing text. The agent loop is
 * instructed (see prompts.js) to relay this verbatim rather than rewrite it,
 * so keep it warm, brief, no jargon, no em dashes, no emojis. The link
 * points the user at /connect on medha-frontend so they self-serve instead
 * of having to text Caleb.
 */
function buildNotConnected() {
  const url = connectPageUrl();
  return {
    error: "calendar_not_connected",
    suggestConnect: true,
    connect_url: url,
    message: `Google Calendar isn't connected to your medha-id yet. Connect it here and ask me again: ${url}`,
  };
}

const NOT_CONNECTED = buildNotConnected();

/** Check that the tenant has a refresh token. */
async function checkConnected(tenant) {
  const refreshToken = await getSecret(tenant, "GCAL_OAUTH_REFRESH");
  return !!refreshToken;
}

/**
 * Build the user-facing connect-page URL. Points at medha-frontend
 * /connect, which renders the Connect Google button that triggers
 * medha-id's /v1/oauth/google/init (the actually-implemented init
 * route). The OAuth state is bound to the signed-in user's medha-id
 * session, so the `tenant` argument is no longer needed here — kept
 * in the signature for backward compatibility with callers.
 */
function buildConnectUrl(tenant) {
  void tenant;
  return connectPageUrl();
}

/**
 * Structured response for the runtime OAuth failure path — the refresh
 * token is missing or invalid and we need the user to grant access again.
 * Distinct from NOT_CONNECTED (pre-flight check, "text Caleb to set it
 * up") because here we can hand the user a direct reconnect link.
 *
 * The agent loop is instructed (see prompts.js) to relay the `message`
 * field verbatim including the URL.
 */
function oauthRequiredResponse(tenant) {
  const connectUrl = buildConnectUrl(tenant);
  return {
    error: "calendar_oauth_required",
    message: `I need to connect to your Google Calendar before I can do that. Open this link to grant access and then ask me again: ${connectUrl}`,
    connect_url: connectUrl,
  };
}

/**
 * Resolve the calendar to write events into.
 *
 * Caleb 2026-05-26: 'Just have it always add to the default calendar.'
 * The six-dimension calendar provisioning (financial / intellectual /
 * social / spiritual / emotional / physical) is a future ergonomics
 * layer; today every event goes to the user's primary Google calendar.
 * "primary" is Google's reserved alias for the user's main calendar, so
 * no extra lookup is needed.
 *
 * The dimension arg is retained in the tool schemas (so the LLM still
 * tags events semantically) but is ignored for routing here.
 */
async function getCalId(tenant, dimension) {
  void tenant;
  void dimension;
  return "primary";
}

// Default IANA timezone for date strings without explicit offset. Caleb
// is in PST/PDT — interpreting "11pm tomorrow" as UTC would shove the
// event 8 hours off. When the model passes a naked datetime ("2026-05-28T23:00:00"
// with no Z and no offset), Google will treat it as the calendar's
// timezone. Setting timeZone explicitly removes the ambiguity.
const DEFAULT_EVENT_TIMEZONE = "America/Los_Angeles";

// Re-export of the canonical implementation in ./window.js so existing call
// sites in this file keep working without a second regex copy drifting.
const hasExplicitOffset = hasExplicitOffsetImpl;

/** Convert a simple date string or ISO timestamp to a Google event dateTime object. */
function toGoogleDateTime(isoString, allDay = false) {
  if (allDay) {
    // All-day: just the date part
    return { date: isoString.substring(0, 10) };
  }
  // When the input has no explicit Z or offset, attach PT as the
  // interpretation timezone so "11pm tomorrow" lands at 11pm Pacific,
  // not 11pm UTC.
  if (!hasExplicitOffset(isoString)) {
    return { dateTime: isoString, timeZone: DEFAULT_EVENT_TIMEZONE };
  }
  return { dateTime: isoString };
}

/** Format a Google Calendar event for Claude. */
function formatEvent(ev) {
  return {
    id: ev.id,
    summary: ev.summary,
    description: ev.description,
    start: ev.start?.dateTime || ev.start?.date,
    end: ev.end?.dateTime || ev.end?.date,
    location: ev.location,
    status: ev.status,
    htmlLink: ev.htmlLink,
  };
}

// ── Tool schemas ──────────────────────────────────────────────────────────────

export const GCAL_TOOLS = [
  {
    name: "schedule_event",
    description:
      "Create a calendar event on one of the six life-dimension calendars. Use this when the user wants to schedule something. Always specify the dimension that best matches the event's nature.",
    input_schema: {
      type: "object",
      properties: {
        dimension: {
          type: "string",
          enum: DIMENSIONS,
          description:
            "Which dimension calendar to add the event to (financial, intellectual, social, spiritual, emotional, physical)",
        },
        summary: {
          type: "string",
          description: "Event title",
        },
        description: {
          type: "string",
          description: "Optional event description or notes",
        },
        start: {
          type: "string",
          description:
            "Start time as ISO 8601 string (e.g. 2025-07-15T14:00:00-07:00)",
        },
        end: {
          type: "string",
          description: "End time as ISO 8601 string",
        },
        location: {
          type: "string",
          description: "Optional location or video call URL",
        },
        all_day: {
          type: "boolean",
          description: "If true, treat start/end as YYYY-MM-DD date strings",
        },
        attendees: {
          type: "array",
          items: { type: "string" },
          description: "List of attendee email addresses",
        },
      },
      required: ["dimension", "summary", "start", "end"],
    },
  },
  {
    name: "get_availability",
    description:
      "Check freebusy (availability) across all six dimension calendars for a time window. Returns busy slots so you can suggest free times.",
    input_schema: {
      type: "object",
      properties: {
        time_min: {
          type: "string",
          description: "Start of window as ISO 8601 string",
        },
        time_max: {
          type: "string",
          description: "End of window as ISO 8601 string",
        },
        dimensions: {
          type: "array",
          items: { type: "string", enum: DIMENSIONS },
          description:
            "Which dimension calendars to check. Omit to check all six.",
        },
      },
      required: ["time_min", "time_max"],
    },
  },
  {
    name: "list_events",
    description:
      "List upcoming events across every Google Calendar the user has access to (primary, work, shared, subscribed). Use to show what's scheduled.",
    input_schema: {
      type: "object",
      properties: {
        time_min: {
          type: "string",
          description:
            "Start of window. Accepts either YYYY-MM-DD (interpreted as start of that day in the user's Pacific timezone) or a full ISO 8601 string with offset (e.g. 2026-05-28T00:00:00-07:00). Defaults to now if omitted.",
        },
        time_max: {
          type: "string",
          description:
            "End of window. Accepts either YYYY-MM-DD (interpreted as end of that day in Pacific time) or a full ISO 8601 string with offset. Defaults to 7 days from now.",
        },
        max_results: {
          type: "integer",
          description: "Max events per calendar (default 10, max 50).",
        },
      },
    },
  },
  {
    name: "reschedule_event",
    description:
      "Update an existing calendar event's start and/or end time. Requires the event ID and the calendar dimension.",
    input_schema: {
      type: "object",
      properties: {
        dimension: {
          type: "string",
          enum: DIMENSIONS,
          description: "The dimension calendar the event lives on",
        },
        event_id: {
          type: "string",
          description: "Google Calendar event ID",
        },
        start: {
          type: "string",
          description: "New start time as ISO 8601 string",
        },
        end: {
          type: "string",
          description: "New end time as ISO 8601 string",
        },
        summary: {
          type: "string",
          description: "Optionally update the event title too",
        },
        description: {
          type: "string",
          description: "Optionally update the event description",
        },
      },
      required: ["dimension", "event_id"],
    },
  },
  {
    name: "cancel_event",
    description:
      "Delete (cancel) a calendar event. Requires the event ID and dimension.",
    input_schema: {
      type: "object",
      properties: {
        dimension: {
          type: "string",
          enum: DIMENSIONS,
          description: "The dimension calendar the event lives on",
        },
        event_id: {
          type: "string",
          description: "Google Calendar event ID to delete",
        },
      },
      required: ["dimension", "event_id"],
    },
  },
];

// ── Tool implementations ──────────────────────────────────────────────────────

async function handleScheduleEvent(input, tenant) {
  const {
    dimension,
    summary,
    description,
    start,
    end,
    location,
    all_day = false,
    attendees = [],
  } = input;

  const calId = await getCalId(tenant, dimension);
  if (!calId) {
    return {
      error: `Could not resolve calendar ID for dimension: ${dimension}`,
    };
  }

  const eventBody = {
    summary,
    description,
    location,
    start: toGoogleDateTime(start, all_day),
    end: toGoogleDateTime(end, all_day),
  };

  if (attendees.length > 0) {
    eventBody.attendees = attendees.map((email) => ({ email }));
  }

  let res;
  try {
    res = await insertEvent(tenant, calId, eventBody);
  } catch (err) {
    if (err?.code === "calendar_oauth_required")
      return oauthRequiredResponse(tenant);
    throw err;
  }
  if (!res.ok) {
    if (res.error === "gcal-not-connected") return NOT_CONNECTED;
    return { error: `Failed to create event: ${res.error}` };
  }

  return {
    success: true,
    event: formatEvent(res.data),
    dimension,
    calendarId: calId,
  };
}

async function handleGetAvailability(input, tenant) {
  const { time_min, time_max, dimensions } = input;
  const targetDims = dimensions?.length ? dimensions : DIMENSIONS;

  // Same PT-offset normalization as list_events. Without it, a naked
  // "2026-05-28T00:00:00" gets read as UTC and the freebusy window slides
  // off the user's actual day.
  const normalizedMin = normalizeWindowBound(time_min, "min");
  const normalizedMax = normalizeWindowBound(time_max, "max");

  // Resolve all calendar IDs
  const dimIds = await Promise.all(
    targetDims.map(async (dim) => {
      const id = await getCalId(tenant, dim);
      return { dim, id };
    }),
  );

  const validDimIds = dimIds.filter((d) => d.id);
  if (validDimIds.length === 0) {
    return {
      error: "No calendars provisioned. Run provisionHealthCalendars first.",
    };
  }

  const calendarIds = validDimIds.map((d) => d.id);
  let res;
  try {
    res = await queryFreebusy(
      tenant,
      calendarIds,
      normalizedMin || time_min,
      normalizedMax || time_max,
    );
  } catch (err) {
    if (err?.code === "calendar_oauth_required")
      return oauthRequiredResponse(tenant);
    throw err;
  }

  if (!res.ok) {
    if (res.error === "gcal-not-connected") return NOT_CONNECTED;
    return { error: `Freebusy query failed: ${res.error}` };
  }

  // Map calendar IDs back to dimension names for readability
  const idToDim = {};
  for (const { dim, id } of validDimIds) {
    idToDim[id] = dim;
  }

  const busyByDimension = {};
  const calendarsData = res.data?.calendars || {};
  for (const [calId, calData] of Object.entries(calendarsData)) {
    const dim = idToDim[calId] || calId;
    busyByDimension[dim] = calData.busy || [];
  }

  return {
    success: true,
    window: { from: time_min, to: time_max },
    busy: busyByDimension,
  };
}

async function handleListEvents(input, tenant) {
  const { time_min, time_max, max_results = 10 } = input;

  const now = new Date().toISOString();
  const defaultMax = new Date(
    Date.now() + 7 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const capped = Math.min(Math.max(1, max_results), 50);

  // Normalize naked datetimes / date-only strings to PT before Google sees
  // them. Without this, "2026-05-28T00:00:00" hits Google as UTC and the
  // window becomes PT May 27 5pm → PT May 28 4:59pm, dropping PT-evening
  // events on the asked-for day. See gcal/window.js for the rules.
  const normalizedMin = normalizeWindowBound(time_min, "min");
  const normalizedMax = normalizeWindowBound(time_max, "max");

  // Enumerate every calendar the user has access to (not just "primary") so
  // events on secondary, shared, or work calendars surface in the answer.
  // Previously this iterated DIMENSIONS and always resolved each to
  // "primary", producing the same primary results six times and missing
  // every other calendar the user owns or subscribes to.
  let calendarList;
  try {
    calendarList = await listCalendarList(tenant);
  } catch (err) {
    if (err?.code === "calendar_oauth_required") {
      return oauthRequiredResponse(tenant);
    }
    throw err;
  }
  if (!calendarList.ok) {
    if (calendarList.error === "gcal-not-connected") return NOT_CONNECTED;
    return { error: `Failed to list calendars: ${calendarList.error}` };
  }

  // Skip hidden / deleted / declined calendars — those reflect intent that
  // the user does not want them surfaced in "what's on my calendar."
  const calendars = (calendarList.data?.items || []).filter(
    (c) => !c.hidden && !c.deleted && c.selected !== false,
  );

  if (calendars.length === 0) {
    return {
      success: true,
      events: [],
      count: 0,
      calendars_checked: 0,
      message: "No calendars accessible on this Google account.",
    };
  }

  const seen = new Set();
  const results = [];
  let oauthRequired = false;

  await Promise.all(
    calendars.map(async (cal) => {
      let res;
      try {
        res = await apiListEvents(tenant, cal.id, {
          timeMin: normalizedMin || now,
          timeMax: normalizedMax || defaultMax,
          maxResults: capped,
          singleEvents: "true",
          orderBy: "startTime",
        });
      } catch (err) {
        if (err?.code === "calendar_oauth_required") {
          oauthRequired = true;
          return;
        }
        throw err;
      }

      if (!res.ok) return;

      for (const ev of res.data?.items || []) {
        // Recurring events split across calendars (or a single event the
        // user is invited to from two angles) would otherwise duplicate.
        if (seen.has(ev.id)) continue;
        seen.add(ev.id);
        results.push({
          ...formatEvent(ev),
          calendar: cal.summary || cal.id,
        });
      }
    }),
  );

  if (oauthRequired && results.length === 0) {
    return oauthRequiredResponse(tenant);
  }

  results.sort((a, b) => {
    const aTime = a.start || "";
    const bTime = b.start || "";
    return aTime.localeCompare(bTime);
  });

  return {
    success: true,
    events: results,
    count: results.length,
    calendars_checked: calendars.length,
  };
}

async function handleRescheduleEvent(input, tenant) {
  const { dimension, event_id, start, end, summary, description } = input;

  const calId = await getCalId(tenant, dimension);
  if (!calId) {
    return {
      error: `Could not resolve calendar ID for dimension: ${dimension}`,
    };
  }

  const patch = {};
  if (start) patch.start = toGoogleDateTime(start);
  if (end) patch.end = toGoogleDateTime(end);
  if (summary) patch.summary = summary;
  if (description) patch.description = description;

  if (Object.keys(patch).length === 0) {
    return { error: "No fields to update provided." };
  }

  let res;
  try {
    res = await patchEvent(tenant, calId, event_id, patch);
  } catch (err) {
    if (err?.code === "calendar_oauth_required")
      return oauthRequiredResponse(tenant);
    throw err;
  }
  if (!res.ok) {
    if (res.error === "gcal-not-connected") return NOT_CONNECTED;
    return { error: `Failed to reschedule event: ${res.error}` };
  }

  return {
    success: true,
    event: formatEvent(res.data),
    dimension,
  };
}

async function handleCancelEvent(input, tenant) {
  const { dimension, event_id } = input;

  const calId = await getCalId(tenant, dimension);
  if (!calId) {
    return {
      error: `Could not resolve calendar ID for dimension: ${dimension}`,
    };
  }

  let res;
  try {
    res = await deleteEvent(tenant, calId, event_id);
  } catch (err) {
    if (err?.code === "calendar_oauth_required")
      return oauthRequiredResponse(tenant);
    throw err;
  }
  if (!res.ok) {
    if (res.error === "gcal-not-connected") return NOT_CONNECTED;
    return { error: `Failed to cancel event: ${res.error}` };
  }

  return { success: true, eventId: event_id, dimension };
}

// ── Main dispatcher ───────────────────────────────────────────────────────────

/**
 * Execute a Google Calendar tool call from the Claude tool_use loop.
 *
 * @param {string} toolName  One of: schedule_event, get_availability, list_events,
 *                           reschedule_event, cancel_event
 * @param {object} input     Tool input from Claude
 * @param {object} ctx       Context object containing { tenant }
 * @returns {Promise<object>}
 */
export async function executeGcalTool(toolName, input, ctx) {
  const tenant = ctx?.tenant || ctx;

  // Guard: check connectivity before any operation
  const connected = await checkConnected(tenant);
  if (!connected) return NOT_CONNECTED;

  try {
    switch (toolName) {
      case "schedule_event":
        return await handleScheduleEvent(input, tenant);
      case "get_availability":
        return await handleGetAvailability(input, tenant);
      case "list_events":
        return await handleListEvents(input, tenant);
      case "reschedule_event":
        return await handleRescheduleEvent(input, tenant);
      case "cancel_event":
        return await handleCancelEvent(input, tenant);
      default:
        return { error: `Unknown gcal tool: ${toolName}` };
    }
  } catch (err) {
    // Safety net for the runtime OAuth-required path. The per-handler
    // try/catch should catch this first, but if a new caller forgets
    // we still surface the connect URL instead of a raw error string.
    if (err?.code === "calendar_oauth_required") {
      return oauthRequiredResponse(tenant);
    }
    console.error("[gcal/tools] Unexpected error in", toolName, err);
    return { error: err.message || "Internal gcal error" };
  }
}

// ── Service-to-service helpers ────────────────────────────────────────────────

/**
 * freebusyFor — service-to-service helper for check-in scheduler and
 * calendar_grants feature. Does not go through the Claude tool layer.
 *
 * @param {object} tenant     Tenant object
 * @param {string} dimension  One of the six dimensions (or "all")
 * @param {{ from: string, to: string }} window  ISO 8601 strings
 * @returns {Promise<Array<{start: string, end: string}>>}  Array of busy slots
 */
export async function freebusyFor(tenant, dimension, window) {
  const targetDims =
    !dimension || dimension === "all" ? DIMENSIONS : [dimension.toLowerCase()];

  const dimIds = await Promise.all(
    targetDims.map(async (dim) => {
      const id = await getCalId(tenant, dim);
      return { dim, id };
    }),
  );

  const validIds = dimIds.filter((d) => d.id).map((d) => d.id);
  if (validIds.length === 0) return [];

  const res = await queryFreebusy(tenant, validIds, window.from, window.to);
  if (!res.ok) return [];

  // Flatten all busy slots into a single array
  const allBusy = [];
  const calendarsData = res.data?.calendars || {};
  for (const calData of Object.values(calendarsData)) {
    for (const slot of calData.busy || []) {
      allBusy.push({ start: slot.start, end: slot.end });
    }
  }

  // Sort chronologically
  allBusy.sort((a, b) => a.start.localeCompare(b.start));
  return allBusy;
}
