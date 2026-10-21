/**
 * calendar-block.js — Block scheduling + focus time on Google Calendar.
 *
 * Tab 25 (Amber Dispatch 2026-05-29). The existing gcal tools cover
 * read + create-event + freebusy. This layer adds the higher-intent
 * scheduling moves the LLM needs for "block 2 hours tomorrow morning
 * for writing":
 *
 *   find_free_block      — read the calendar, return the best free windows
 *                          that fit a requested duration, optionally narrowed
 *                          to a time of day and bounded by a deadline date.
 *   schedule_focus_block — create a defended focus event (opaque so it shows
 *                          busy, private visibility, emoji-free title).
 *   propose_reschedule   — for a conflicting event, draft a polite reschedule
 *                          message the user (or the gmail tool) can send. It
 *                          drafts only; it never deletes or moves the event.
 *
 * All three reuse the per-tenant OAuth client in ./gcal/client.js and the
 * PT-offset helpers in ./gcal/window.js, so timezone handling matches the
 * rest of the calendar surface (Caleb is in PT; naked datetimes are read as
 * Pacific, not UTC).
 *
 * Scope: Medha tenant only. No Togari coupling.
 */

import { getSecret } from "../secrets.js";
import {
  listCalendarList,
  queryFreebusy,
  insertEvent,
  getEvent,
  listEvents as apiListEvents,
} from "./gcal/client.js";
import { getPtOffsetForDate, hasExplicitOffset } from "./gcal/window.js";

const DEFAULT_EVENT_TIMEZONE = "America/Los_Angeles";
const PT_TIMEZONE = "America/Los_Angeles";

// Working-day bounds (PT, 24h). Free-block search never proposes a window
// outside these unless a time-of-day band explicitly extends past them.
const WORK_START_HOUR = 9;
const WORK_END_HOUR = 18;

// Time-of-day bands the LLM can pass. "any" spans the full working day.
const TIME_OF_DAY_BANDS = {
  morning: [9, 12],
  afternoon: [12, 17],
  evening: [17, 21],
  any: [WORK_START_HOUR, WORK_END_HOUR],
};

// How far ahead to scan when no deadline (by_date) is supplied.
const DEFAULT_SCAN_DAYS = 14;
// Never scan past this many days even if by_date is far out.
const MAX_SCAN_DAYS = 60;
// Don't propose a block starting in the next few minutes — leave runway.
const START_BUFFER_MS = 15 * 60 * 1000;
// Cap on how many free windows we return.
const MAX_WINDOWS = 3;

// ── Connect / OAuth helpers (kept local so this module is self-contained) ──────

function connectPageUrl() {
  const base = (
    process.env.MEDHA_FRONTEND_URL || "https://www.justarock.ai"
  ).replace(/\/+$/, "");
  return `${base}/connect`;
}

function buildNotConnected() {
  const url = connectPageUrl();
  return {
    error: "calendar_not_connected",
    suggestConnect: true,
    connect_url: url,
    message: `Google Calendar isn't connected to your medha-id yet. Connect it here and ask me again: ${url}`,
  };
}

function oauthRequiredResponse() {
  const url = connectPageUrl();
  return {
    error: "calendar_oauth_required",
    connect_url: url,
    message: `I need to connect to your Google Calendar before I can do that. Open this link to grant access and then ask me again: ${url}`,
  };
}

async function checkConnected(tenant) {
  const refreshToken = await getSecret(tenant, "GCAL_OAUTH_REFRESH");
  return !!refreshToken;
}

// ── Date / time helpers ────────────────────────────────────────────────────────

/** Strip emoji and pictographic characters from a title. CLAUDE rules: no emojis. */
export function stripEmoji(text) {
  if (typeof text !== "string") return text;
  return text
    .replace(
      /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{200D}]/gu,
      "",
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** YYYY-MM-DD for a Date in PT. */
export function ptDateString(date) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: PT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // en-CA yields YYYY-MM-DD directly.
  return fmt.format(date);
}

/** The hour-of-day (0-23) in PT for a Date. */
export function ptHour(date) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: PT_TIMEZONE,
    hour: "2-digit",
    hour12: false,
  });
  const h = Number(fmt.format(date));
  // "24" can appear for midnight in some environments; normalize to 0.
  return h === 24 ? 0 : h;
}

/** Add n calendar days to a YYYY-MM-DD string (DST-safe, plain date math). */
export function addDaysToDateStr(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/**
 * Build the epoch-ms boundary for a given PT calendar day + hour. Hour can be
 * fractional? No — we only pass whole hours. The PT offset is resolved for
 * that day so PST/PDT is handled without month math.
 */
export function ptDayHourMs(dateStr, hour) {
  const offset = getPtOffsetForDate(dateStr);
  const hh = String(Math.floor(hour)).padStart(2, "0");
  const iso = `${dateStr}T${hh}:00:00${offset}`;
  return new Date(iso).getTime();
}

/** ISO 8601 (with PT offset) for a PT calendar day + whole hour. */
function ptDayHourIso(dateStr, hour) {
  const offset = getPtOffsetForDate(dateStr);
  const hh = String(Math.floor(hour)).padStart(2, "0");
  return `${dateStr}T${hh}:00:00${offset}`;
}

/** Human-friendly PT label, e.g. "Fri May 30, 9:00 AM". */
export function ptLabel(date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: PT_TIMEZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

/** Convert an ISO string or naked datetime to a Google event start/end object. */
function toGoogleDateTime(isoString) {
  if (!hasExplicitOffset(isoString)) {
    return { dateTime: isoString, timeZone: DEFAULT_EVENT_TIMEZONE };
  }
  return { dateTime: isoString };
}

// ── Free-block search core ─────────────────────────────────────────────────────

/**
 * Merge overlapping/adjacent busy intervals (epoch-ms pairs) into a sorted,
 * non-overlapping list. Exported for tests.
 *
 * @param {Array<{start: number, end: number}>} intervals
 * @returns {Array<{start: number, end: number}>}
 */
export function mergeBusy(intervals) {
  const sorted = intervals
    .filter(
      (i) =>
        Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start,
    )
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const cur of sorted) {
    const last = merged[merged.length - 1];
    if (last && cur.start <= last.end) {
      last.end = Math.max(last.end, cur.end);
    } else {
      merged.push({ start: cur.start, end: cur.end });
    }
  }
  return merged;
}

/**
 * Find free gaps of at least durationMs inside [windowStart, windowEnd] given
 * a list of busy intervals. Exported for tests.
 *
 * @returns {Array<{start: number, end: number}>}  free windows (ms), each
 *          exactly durationMs long, anchored at the start of each gap.
 */
export function freeGapsInWindow(windowStart, windowEnd, busy, durationMs) {
  if (windowEnd - windowStart < durationMs) return [];
  const merged = mergeBusy(busy);
  const gaps = [];
  let cursor = windowStart;
  for (const slot of merged) {
    if (slot.end <= windowStart || slot.start >= windowEnd) continue;
    const slotStart = Math.max(slot.start, windowStart);
    if (slotStart - cursor >= durationMs) {
      gaps.push({ start: cursor, end: cursor + durationMs });
    }
    cursor = Math.max(cursor, Math.min(slot.end, windowEnd));
  }
  if (windowEnd - cursor >= durationMs) {
    gaps.push({ start: cursor, end: cursor + durationMs });
  }
  return gaps;
}

/**
 * Pull all busy intervals (epoch-ms) for the tenant across every visible
 * calendar over [timeMinIso, timeMaxIso]. Returns { ok, busy } or an error
 * shape the dispatcher relays.
 */
async function collectBusy(tenant, timeMinIso, timeMaxIso) {
  let calendarList;
  try {
    calendarList = await listCalendarList(tenant);
  } catch (err) {
    if (err?.code === "calendar_oauth_required") return { oauth: true };
    throw err;
  }
  if (!calendarList.ok) {
    if (calendarList.error === "gcal-not-connected")
      return { notConnected: true };
    return { error: `Failed to list calendars: ${calendarList.error}` };
  }

  const calendars = (calendarList.data?.items || []).filter(
    (c) => !c.hidden && !c.deleted && c.selected !== false,
  );
  if (calendars.length === 0) return { ok: true, busy: [] };

  // Google freeBusy caps at 50 calendar items per request.
  const calendarIds = calendars.slice(0, 50).map((c) => c.id);

  let res;
  try {
    res = await queryFreebusy(tenant, calendarIds, timeMinIso, timeMaxIso);
  } catch (err) {
    if (err?.code === "calendar_oauth_required") return { oauth: true };
    throw err;
  }
  if (!res.ok) {
    if (res.error === "gcal-not-connected") return { notConnected: true };
    return { error: `Freebusy query failed: ${res.error}` };
  }

  const busy = [];
  const calendarsData = res.data?.calendars || {};
  for (const calData of Object.values(calendarsData)) {
    for (const slot of calData.busy || []) {
      const start = new Date(slot.start).getTime();
      const end = new Date(slot.end).getTime();
      if (Number.isFinite(start) && Number.isFinite(end)) {
        busy.push({ start, end });
      }
    }
  }
  return { ok: true, busy };
}

// ── Tool: find_free_block ──────────────────────────────────────────────────────

async function handleFindFreeBlock(input, tenant) {
  const { duration_min, preferred_time_of_day = "any", by_date } = input;

  const duration = Math.round(Number(duration_min));
  if (!Number.isFinite(duration) || duration <= 0) {
    return { error: "duration_min must be a positive number of minutes." };
  }
  if (duration > 12 * 60) {
    return { error: "duration_min cannot exceed 12 hours (720 minutes)." };
  }
  const durationMs = duration * 60 * 1000;

  const band =
    TIME_OF_DAY_BANDS[String(preferred_time_of_day).toLowerCase()] ||
    TIME_OF_DAY_BANDS.any;
  const [bandStartHour, bandEndHour] = band;

  const now = new Date();
  const todayStr = ptDateString(now);
  const startDateStr = todayStr;

  // Determine the last day to scan (inclusive).
  let endDateStr;
  if (by_date && /^\d{4}-\d{2}-\d{2}$/.test(String(by_date).trim())) {
    endDateStr = String(by_date).trim();
    // Clamp absurd ranges.
    if (addDaysToDateStr(startDateStr, MAX_SCAN_DAYS) < endDateStr) {
      endDateStr = addDaysToDateStr(startDateStr, MAX_SCAN_DAYS);
    }
    // A past deadline yields nothing.
    if (endDateStr < startDateStr) {
      return {
        success: true,
        windows: [],
        message: `The deadline ${by_date} is in the past, so there's no time left to block.`,
      };
    }
  } else {
    endDateStr = addDaysToDateStr(startDateStr, DEFAULT_SCAN_DAYS - 1);
  }

  // One freebusy call spanning the whole scan range, then partition per day.
  const scanMinIso = ptDayHourIso(startDateStr, 0);
  const scanMaxIso = ptDayHourIso(addDaysToDateStr(endDateStr, 1), 0);
  const collected = await collectBusy(tenant, scanMinIso, scanMaxIso);
  if (collected.oauth) return oauthRequiredResponse();
  if (collected.notConnected) return buildNotConnected();
  if (collected.error) return { error: collected.error };

  const busy = collected.busy;
  const windows = [];
  const earliestStartMs = now.getTime() + START_BUFFER_MS;

  let dayStr = startDateStr;
  while (dayStr <= endDateStr && windows.length < MAX_WINDOWS) {
    let windowStart = ptDayHourMs(dayStr, bandStartHour);
    const windowEnd = ptDayHourMs(dayStr, bandEndHour);
    // On the first day, never propose a window that has already started.
    if (windowStart < earliestStartMs) windowStart = earliestStartMs;

    if (windowEnd - windowStart >= durationMs) {
      const gaps = freeGapsInWindow(windowStart, windowEnd, busy, durationMs);
      for (const gap of gaps) {
        if (windows.length >= MAX_WINDOWS) break;
        const startDate = new Date(gap.start);
        const endDate = new Date(gap.end);
        windows.push({
          start: startDate.toISOString(),
          end: endDate.toISOString(),
          duration_min: duration,
          label: `${ptLabel(startDate)} to ${ptLabel(endDate)}`,
        });
      }
    }
    dayStr = addDaysToDateStr(dayStr, 1);
  }

  if (windows.length === 0) {
    return {
      success: true,
      windows: [],
      message: `I couldn't find a free ${duration}-minute window ${
        preferred_time_of_day && preferred_time_of_day !== "any"
          ? `in the ${preferred_time_of_day} `
          : ""
      }${by_date ? `before ${by_date}` : "in the next two weeks"}. Your calendar is packed in that range.`,
    };
  }

  return {
    success: true,
    duration_min: duration,
    preferred_time_of_day,
    windows,
  };
}

// ── Tool: schedule_focus_block ─────────────────────────────────────────────────

async function handleScheduleFocusBlock(input, tenant) {
  const { start, duration, title, description } = input;

  if (!start || typeof start !== "string") {
    return { error: "start (ISO 8601 datetime) is required." };
  }
  const durationMin = Math.round(Number(duration));
  if (!Number.isFinite(durationMin) || durationMin <= 0) {
    return { error: "duration must be a positive number of minutes." };
  }

  const startMs = new Date(
    hasExplicitOffset(start) ? start : `${start}${getPtOffsetForDate(start)}`,
  ).getTime();
  if (!Number.isFinite(startMs)) {
    return { error: `Could not parse start time: ${start}` };
  }
  const endIso = new Date(startMs + durationMin * 60 * 1000).toISOString();

  const cleanTitle = stripEmoji(title || "Focus block") || "Focus block";

  const eventBody = {
    summary: cleanTitle,
    description: description ? stripEmoji(description) : undefined,
    // opaque → shows as Busy so auto-schedulers and other people see the hold.
    transparency: "opaque",
    // private → the block's details aren't shared on shared calendars.
    visibility: "private",
    start: toGoogleDateTime(start),
    end: toGoogleDateTime(endIso),
  };

  let res;
  try {
    res = await insertEvent(tenant, "primary", eventBody);
  } catch (err) {
    if (err?.code === "calendar_oauth_required") return oauthRequiredResponse();
    throw err;
  }
  if (!res.ok) {
    if (res.error === "gcal-not-connected") return buildNotConnected();
    return { error: `Failed to create focus block: ${res.error}` };
  }

  const ev = res.data;
  return {
    success: true,
    event: {
      id: ev.id,
      summary: ev.summary,
      start: ev.start?.dateTime || ev.start?.date,
      end: ev.end?.dateTime || ev.end?.date,
      htmlLink: ev.htmlLink,
      transparency: ev.transparency || "opaque",
      visibility: ev.visibility || "private",
    },
    defended: true,
  };
}

// ── Tool: propose_reschedule ───────────────────────────────────────────────────

/**
 * Locate an event by id. Tries the primary calendar first (the common case),
 * then falls back to scanning the user's other visible calendars. Returns
 * { ok, calendarId, event } or a relay-able error / oauth / notConnected.
 */
async function locateEvent(tenant, eventId) {
  let res;
  try {
    res = await getEvent(tenant, "primary", eventId);
  } catch (err) {
    if (err?.code === "calendar_oauth_required") return { oauth: true };
    throw err;
  }
  if (res.ok && res.data) {
    return { ok: true, calendarId: "primary", event: res.data };
  }
  if (res.error === "gcal-not-connected") return { notConnected: true };

  // Not on primary — scan other calendars.
  let calendarList;
  try {
    calendarList = await listCalendarList(tenant);
  } catch (err) {
    if (err?.code === "calendar_oauth_required") return { oauth: true };
    throw err;
  }
  if (!calendarList.ok)
    return { error: "Event not found on primary calendar." };

  const calendars = (calendarList.data?.items || []).filter(
    (c) => !c.hidden && !c.deleted && c.id !== "primary",
  );
  for (const cal of calendars) {
    let evRes;
    try {
      evRes = await getEvent(tenant, cal.id, eventId);
    } catch {
      continue;
    }
    if (evRes.ok && evRes.data) {
      return { ok: true, calendarId: cal.id, event: evRes.data };
    }
  }
  return { error: `Could not find an event with id ${eventId}.` };
}

async function handleProposeReschedule(input, tenant) {
  const { event_id, reason, tone = "warm" } = input;
  if (!event_id) return { error: "event_id is required." };

  const located = await locateEvent(tenant, event_id);
  if (located.oauth) return oauthRequiredResponse();
  if (located.notConnected) return buildNotConnected();
  if (located.error) return { error: located.error };

  const ev = located.event;
  const summary = ev.summary || "our meeting";
  const startRaw = ev.start?.dateTime || ev.start?.date;
  const startDate = startRaw ? new Date(startRaw) : null;
  const whenLabel =
    startDate && Number.isFinite(startDate.getTime())
      ? ptLabel(startDate)
      : "the scheduled time";

  const attendees = (ev.attendees || [])
    .filter((a) => a.email && !a.self && !a.resource)
    .map((a) => ({ email: a.email, name: a.displayName }));

  // Draft a short, courteous reschedule note. No em dashes, no emojis.
  const reasonClause = reason
    ? ` ${reason.trim().replace(/\.+$/, "")}.`
    : " Something came up on my end.";
  const greeting =
    attendees.length === 1 && attendees[0].name
      ? `Hi ${attendees[0].name.split(" ")[0]},`
      : "Hi,";

  const closingByTone =
    tone === "formal"
      ? "Thank you for understanding."
      : "Really appreciate the flexibility, and looking forward to connecting.";

  const body = [
    greeting,
    "",
    `I need to move ${summary} originally set for ${whenLabel}.${reasonClause} Could we find another time that works for you?`,
    "",
    "I'm happy to send a few options, or let me know what's open on your side and I'll make it work.",
    "",
    closingByTone,
  ].join("\n");

  const subject = `Reschedule: ${summary}`;

  return {
    success: true,
    draft: {
      subject,
      body,
      to: attendees.map((a) => a.email),
    },
    event: {
      id: ev.id,
      calendarId: located.calendarId,
      summary,
      start: startRaw,
      when: whenLabel,
    },
    // The agent should relay the draft and, if the user confirms, hand it to
    // a send tool (gmail) or send via iMessage. This tool does not send.
    note: "Draft only. The event has not been moved or cancelled.",
  };
}

// ── Tool schemas ────────────────────────────────────────────────────────────────

export const CALENDAR_BLOCK_TOOLS = [
  {
    name: "find_free_block",
    description:
      "Find the best open time windows on the user's calendar that fit a requested duration. Use this when the user wants to block or protect time ('block 2 hours for writing', 'when am I free for a deep work session') before creating the event. Returns up to three free windows with ISO start/end times you can pass to schedule_focus_block.",
    input_schema: {
      type: "object",
      properties: {
        duration_min: {
          type: "integer",
          description:
            "How long the block needs to be, in minutes (e.g. 120 for 2 hours).",
        },
        preferred_time_of_day: {
          type: "string",
          enum: ["morning", "afternoon", "evening", "any"],
          description:
            "Narrow the search to a part of the day. morning=9-12, afternoon=12-17, evening=17-21, any=full working day. Defaults to any.",
        },
        by_date: {
          type: "string",
          description:
            "Optional deadline as YYYY-MM-DD. The search only proposes windows on or before this date. Omit to scan the next two weeks.",
        },
      },
      required: ["duration_min"],
    },
  },
  {
    name: "schedule_focus_block",
    description:
      "Create a defended focus-time event on the user's primary calendar. The event is marked Busy (opaque) so it blocks auto-accept and shows as unavailable to others, and Private so its details stay hidden on shared calendars. Use after find_free_block, or directly when the user gives an explicit start time.",
    input_schema: {
      type: "object",
      properties: {
        start: {
          type: "string",
          description:
            "Start time as ISO 8601 (e.g. 2026-05-31T09:00:00-07:00). A naked datetime without offset is interpreted as Pacific time.",
        },
        duration: {
          type: "integer",
          description: "Block length in minutes.",
        },
        title: {
          type: "string",
          description: "Event title. Emojis are stripped automatically.",
        },
        description: {
          type: "string",
          description: "Optional notes for the block.",
        },
      },
      required: ["start", "duration", "title"],
    },
  },
  {
    name: "propose_reschedule",
    description:
      "Draft a polite message to reschedule an existing calendar event (for example when it conflicts with a focus block). Returns a subject, body, and attendee email list. This DRAFTS ONLY: it does not move, cancel, or send anything. Relay the draft to the user; if they confirm, send it via the email tool or iMessage.",
    input_schema: {
      type: "object",
      properties: {
        event_id: {
          type: "string",
          description: "Google Calendar event ID of the meeting to reschedule.",
        },
        reason: {
          type: "string",
          description:
            "Optional one-line reason for the reschedule, woven into the draft (e.g. 'I have a hard conflict that morning').",
        },
        tone: {
          type: "string",
          enum: ["warm", "formal"],
          description: "Tone of the draft. Defaults to warm.",
        },
      },
      required: ["event_id"],
    },
  },
];

export const CALENDAR_BLOCK_TOOL_NAMES = new Set(
  CALENDAR_BLOCK_TOOLS.map((t) => t.name),
);

// ── Dispatcher ──────────────────────────────────────────────────────────────────

/**
 * Execute a calendar-block tool call from the Claude tool_use loop.
 *
 * @param {string} toolName  find_free_block | schedule_focus_block | propose_reschedule
 * @param {object} input     Tool input from Claude
 * @param {object} ctx       Context object containing { tenant }
 */
export async function executeCalendarBlockTool(toolName, input, ctx) {
  const tenant = ctx?.tenant || ctx;

  const connected = await checkConnected(tenant);
  if (!connected) return buildNotConnected();

  try {
    switch (toolName) {
      case "find_free_block":
        return await handleFindFreeBlock(input, tenant);
      case "schedule_focus_block":
        return await handleScheduleFocusBlock(input, tenant);
      case "propose_reschedule":
        return await handleProposeReschedule(input, tenant);
      default:
        return { error: `Unknown calendar-block tool: ${toolName}` };
    }
  } catch (err) {
    if (err?.code === "calendar_oauth_required") {
      return oauthRequiredResponse();
    }
    console.error("[calendar-block] Unexpected error in", toolName, err);
    return { error: err.message || "Internal calendar-block error" };
  }
}
