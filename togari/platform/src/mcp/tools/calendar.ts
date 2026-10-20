/**
 * Read-only Google Calendar MCP tool.
 *
 * Surfaces one tool to MCP clients:
 *   - togari_calendar_list — fetch recent events from a BMA user's primary
 *     calendar and return them as a markdown table plus a compact JSON block.
 *
 * This tool is strictly READ ONLY. It calls fetchCalendarEvents, which reads
 * the calendar via GCP domain-wide delegation and returns events; nothing is
 * written to BigQuery, the CRM, or the calendar. When Google is not configured
 * (missing creds) or the calendar.readonly scope is not granted (a 403), the
 * tool returns the explanatory note instead of erroring.
 *
 * Follows the exa.ts / ingest.ts ToolModule conventions.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerToolModule, type ToolModule } from "./registry";
import {
  fetchCalendarEvents,
  type CalendarEvent,
} from "../../sources/calendar-fetch";

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], isError };
}

const calendarListShape = {
  user: z
    .string()
    .optional()
    .describe(
      "BMA user whose primary calendar to read (default GMAIL_INGEST_USER or sagar@bluemodernadvisory.com).",
    ),
  since_days: z
    .number()
    .int()
    .min(1)
    .max(365)
    .optional()
    .describe("How many days back to look for events (default 90)."),
  max: z
    .number()
    .int()
    .min(1)
    .max(250)
    .optional()
    .describe("Maximum number of events to return (default 100, max 250)."),
};
const CalendarListInput = z.object(calendarListShape);

/** Escape pipe characters so a value stays inside one markdown table cell. */
function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

/** Render an event's start time compactly for the table. */
function tableDate(start: string): string {
  return start || "(no date)";
}

function eventsTable(events: CalendarEvent[]): string {
  const header =
    "| Date | Title | Organizer | Attendees | Location |\n" +
    "| --- | --- | --- | --- | --- |";
  const rows = events.map((e) => {
    const attendees = e.attendees.length
      ? `${e.attendees.slice(0, 5).join(", ")}${e.attendees.length > 5 ? ", ..." : ""}`
      : "-";
    return `| ${cell(tableDate(e.start))} | ${cell(e.title)} | ${cell(e.organizer ?? "-")} | ${cell(attendees)} | ${cell(e.location ?? "-")} |`;
  });
  return [header, ...rows].join("\n");
}

export const calendarListTool: ToolModule = {
  name: "togari_calendar_list",
  description:
    "Read-only. List recent Google Calendar events from a BMA user's primary calendar. Returns a markdown table (date, title, organizer, attendees, location) plus a compact JSON block of the events so the model can reason over them. This tool never writes to the calendar or the CRM.",
  inputSchema: calendarListShape,
  handler: async (args) => {
    const parsed = CalendarListInput.safeParse(args ?? {});
    if (!parsed.success) {
      return textResult(`Invalid arguments: ${parsed.error.message}`, true);
    }

    const result = await fetchCalendarEvents({
      user: parsed.data.user,
      sinceDays: parsed.data.since_days ?? 90,
      maxEvents: parsed.data.max ?? 100,
    });

    if (!result.configured || result.note) {
      return textResult(
        result.note ?? `Calendar not available for ${result.user}.`,
      );
    }

    if (result.events.length === 0) {
      return textResult(
        `No calendar events for ${result.user} in the requested window.`,
      );
    }

    const header = `Calendar · ${result.fetched} event(s) for ${result.user}`;
    const table = eventsTable(result.events);
    const json = JSON.stringify(result.events, null, 2);

    return textResult(`${header}\n\n${table}\n\n\`\`\`json\n${json}\n\`\`\``);
  },
};

// ── Registration ────────────────────────────────────────────────────

export const TOGARI_CALENDAR_TOOLS: ToolModule[] = [calendarListTool];

/**
 * Register the read-only calendar MCP tool on an McpServer. Called by
 * src/transports/mcp/server.ts alongside the other tool-module registrants.
 */
export function registerCalendarTools(server: McpServer): void {
  for (const mod of TOGARI_CALENDAR_TOOLS) {
    registerToolModule(server, mod);
  }
}

/** Alias matching the orchestrator's `import * as calendarTools; calendarTools.register(server)` pattern. */
export const register = registerCalendarTools;
