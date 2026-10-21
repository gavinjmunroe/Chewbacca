/**
 * weekly.js — Weekly digest tools built on top of native Gmail + GCal.
 *
 * Mirrors the spirit of googleworkspace/apps-script-samples/solutions/
 * automations/agenda-maker, but adapted to Medha's native OAuth path
 * (per-tenant GCAL_OAUTH_REFRESH via amber-id secrets) instead of
 * DriveApp + DocumentApp + CalendarApp running inside Apps Script.
 *
 * Tools exposed:
 *   summarize_week — pull last 7 days (or custom range) of primary
 *                    calendar events + inbox snapshot, return a
 *                    structured agenda the model can paraphrase or feed
 *                    into another tool (e.g. send_email).
 *
 * Future tool in the same family:
 *   weekly_recap   — Sunday-night cron wrapper that calls
 *                    summarize_week + gmail_send_email automatically.
 *
 * Connect link path is identical to the calendar tools — if the user
 * hasn't connected Google yet, return the canonical buildNotConnected()
 * shape so the agent loop surfaces the /connect URL verbatim.
 */

import { registerCapability } from "../capabilities.js";
import { getSecret } from "../secrets.js";
import { listEvents as gcalListEvents } from "./gcal/client.js";
import { gmailRequest } from "./gmail.js";

registerCapability(
  "_tools_WeeklyDigest",
  "Summarize the past week's calendar events and inbox activity in one shot",
);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ── Connect-link helper (mirrors gcal/tools.js) ──────────────────────────────

function connectPageUrl() {
  const base = (
    process.env.MEDHA_FRONTEND_URL ||
    "https://www.justarock.ai"
  ).replace(/\/+$/, "");
  return `${base}/connect`;
}

function notConnected() {
  const url = connectPageUrl();
  return {
    error: "google_not_connected",
    suggestConnect: true,
    connect_url: url,
    message: `Google isn't connected to your medha-id yet. Connect it here and ask me again: ${url}`,
  };
}

// ── Date helpers ─────────────────────────────────────────────────────────────

function toIso(date) {
  return new Date(date).toISOString();
}

function toGmailDate(date) {
  const d = new Date(date);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

function dayKey(isoDateTime) {
  return (isoDateTime || "").substring(0, 10) || "unknown";
}

// ── Event + email shaping ────────────────────────────────────────────────────

function shapeEvent(ev) {
  const start = ev.start?.dateTime || ev.start?.date || "";
  const end = ev.end?.dateTime || ev.end?.date || "";
  const startMs = start ? new Date(start).getTime() : 0;
  const endMs = end ? new Date(end).getTime() : 0;
  const durationMin =
    startMs && endMs ? Math.max(0, Math.round((endMs - startMs) / 60000)) : 0;
  return {
    id: ev.id,
    title: ev.summary || "(no title)",
    start,
    end,
    durationMin,
    location: ev.location || null,
    attendees: (ev.attendees || []).map((a) => a.email).filter(Boolean),
  };
}

function header(headers, name) {
  return (
    headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ||
    ""
  );
}

function parseSender(fromHeader) {
  const match = /<([^>]+)>/.exec(fromHeader || "");
  return (match ? match[1] : fromHeader || "").trim().toLowerCase();
}

// ── Core handler ─────────────────────────────────────────────────────────────

async function handleSummarizeWeek(input, ctx) {
  const { tenant } = ctx;

  // Pre-flight: refuse early if Google isn't connected. Either GMAIL or
  // GCAL refresh token will do — they share scope on the user's grant.
  const [gmailRefresh, gcalRefresh] = await Promise.all([
    getSecret(tenant, "GMAIL_OAUTH_REFRESH"),
    getSecret(tenant, "GCAL_OAUTH_REFRESH"),
  ]);
  if (!gmailRefresh && !gcalRefresh) return notConnected();

  // Date window resolution.
  const now = Date.now();
  const endMs = input.end_date ? new Date(input.end_date).getTime() : now;
  const defaultStart = endMs - 7 * MS_PER_DAY;
  const startMs = input.start_date
    ? new Date(input.start_date).getTime()
    : defaultStart;

  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    startMs >= endMs
  ) {
    return {
      error: "invalid_date_range",
      message: "Pass start_date before end_date (ISO 8601).",
    };
  }

  const timeMin = toIso(startMs);
  const timeMax = toIso(endMs);
  const includeEmails = input.include_emails !== false;

  // ── Calendar: primary calendar over the window ────────────────────────────
  let events = [];
  try {
    const r = await gcalListEvents(tenant, "primary", {
      timeMin,
      timeMax,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: 250,
    });
    if (r.ok) {
      events = (r.data?.items || []).map(shapeEvent);
    } else if (r.error === "gcal-not-connected") {
      return notConnected();
    }
  } catch (err) {
    if (err?.code === "calendar_oauth_required") return notConnected();
    throw err;
  }

  // ── Email: inbox snapshot over the window ─────────────────────────────────
  //
  // Degrade gracefully: if Gmail auth fails (e.g. shared-cache race where a
  // prior gcal request consumed GCAL_OAUTH_CLIENT_ID lookup and the
  // secrets-bag cache returned null instead of falling through to env on the
  // second lookup), we still want to return the calendar half. Surface the
  // failure in `emailStatus` so the model can mention it instead of pretending
  // the inbox is empty.
  let emails = [];
  let emailTotal = 0;
  let emailStatus = "ok";
  if (includeEmails) {
    const q = `in:inbox after:${toGmailDate(startMs)} before:${toGmailDate(endMs + MS_PER_DAY)}`;
    const list = await gmailRequest({
      tenant,
      method: "GET",
      path: "/messages",
      query: { q, maxResults: 50 },
    });
    if (list.ok) {
      emailTotal = list.data?.resultSizeEstimate || 0;
      const ids = (list.data?.messages || []).slice(0, 25);
      const detailed = await Promise.all(
        ids.map((m) =>
          gmailRequest({
            tenant,
            method: "GET",
            path: `/messages/${m.id}`,
            query: {
              format: "metadata",
              metadataHeaders: ["From", "Subject", "Date"],
            },
          }),
        ),
      );
      emails = detailed
        .filter((d) => d.ok)
        .map((d) => {
          const hdrs = d.data?.payload?.headers || [];
          return {
            from: parseSender(header(hdrs, "From")),
            subject: header(hdrs, "Subject"),
            date: header(hdrs, "Date"),
          };
        });
    } else if (list.error === "gmail-not-connected") {
      emailStatus = "not_connected";
    } else {
      emailStatus = `error:${list.error || "unknown"}`;
    }
  } else {
    emailStatus = "skipped";
  }

  // ── Aggregate ─────────────────────────────────────────────────────────────
  const eventsByDay = {};
  let totalMeetingMinutes = 0;
  for (const ev of events) {
    const key = dayKey(ev.start);
    (eventsByDay[key] ||= []).push(ev);
    totalMeetingMinutes += ev.durationMin;
  }

  const senderCounts = new Map();
  for (const e of emails) {
    if (!e.from) continue;
    senderCounts.set(e.from, (senderCounts.get(e.from) || 0) + 1);
  }
  const topSenders = [...senderCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([from, count]) => ({ from, count }));

  return {
    success: true,
    window: { from: timeMin, to: timeMax },
    totals: {
      events: events.length,
      meetingMinutes: totalMeetingMinutes,
      meetingHours: Math.round((totalMeetingMinutes / 60) * 10) / 10,
      emailsReceived: emailTotal,
      emailsSampled: emails.length,
    },
    emailStatus,
    eventsByDay,
    topSenders,
    recentSubjects: emails
      .slice(0, 10)
      .map((e) => e.subject)
      .filter(Boolean),
  };
}

// ── Tool schema ──────────────────────────────────────────────────────────────

export const WEEKLY_TOOLS = [
  {
    name: "summarize_week",
    description:
      "Build a one-shot weekly recap: calendar events grouped by day, total meeting hours, inbox count, top senders, and recent subjects. Defaults to the last 7 days when no dates are passed. Use this when the user asks for a weekly summary, 'how did my week look', or before drafting a weekly review email.",
    input_schema: {
      type: "object",
      properties: {
        start_date: {
          type: "string",
          description:
            "Start of the window as ISO 8601 (e.g. 2026-05-19T00:00:00Z). Defaults to 7 days before end_date.",
        },
        end_date: {
          type: "string",
          description: "End of the window as ISO 8601. Defaults to now.",
        },
        include_emails: {
          type: "boolean",
          description:
            "Include inbox snapshot (default true). Set false to skip Gmail entirely.",
        },
      },
    },
  },
];

// ── Dispatcher ───────────────────────────────────────────────────────────────

export async function executeWeeklyTool(toolName, input, ctx) {
  console.log(`[weekly] ${toolName}`);
  try {
    switch (toolName) {
      case "summarize_week":
        return await handleSummarizeWeek(input, ctx);
      default:
        return { error: `Unknown weekly tool: ${toolName}` };
    }
  } catch (err) {
    console.error(`[weekly] ${toolName} failed:`, err?.message);
    return { error: err?.message || "weekly-tool-error" };
  }
}
