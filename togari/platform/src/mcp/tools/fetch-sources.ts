/**
 * Read-only source-retrieval MCP tools.
 *
 * These tools FETCH and RETURN raw source data (Gmail messages, Fireflies
 * meetings) for reporting. They are strictly READ ONLY: neither tool writes to
 * BigQuery or the CRM. A bulk 90-day pull for a report therefore cannot flood
 * the production CRM.
 *
 * Tools:
 *   - togari_gmail_list       — list recent Gmail messages for a mailbox.
 *   - togari_fireflies_list   — list recent Fireflies meetings with recording
 *                               links + action items.
 *
 * Follows the ingest.ts ToolModule conventions (zod raw shape, safeParse,
 * textResult, factory builders, registerFetchTools registrant).
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerToolModule, type ToolModule } from "./registry";
import { fetchGmailMessages } from "../../sources/gmail-fetch";
import { fetchFirefliesMeetings } from "../../sources/fireflies-fetch";

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], isError };
}

/** Escape pipe characters so cell content never breaks a markdown table. */
function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

// ── togari_gmail_list ───────────────────────────────────────────────

const gmailListShape = {
  user: z
    .string()
    .optional()
    .describe(
      "Mailbox to read via domain-wide delegation (default GMAIL_INGEST_USER or sagar@bluemodernadvisory.com).",
    ),
  since_days: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("How many days back to search (default 90)."),
  max: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Max messages to return (default 25, capped at 200)."),
  query: z
    .string()
    .optional()
    .describe("Optional Gmail search query appended to the date filter."),
};
const GmailListInput = z.object(gmailListShape);

export function buildGmailListTool(): ToolModule {
  return {
    name: "togari_gmail_list",
    description:
      "List recent Gmail messages for a BMA mailbox (read-only). Returns a markdown table (date, from, subject, snippet) plus compact JSON. Fetches and RETURNS the data only; it does NOT write to the CRM or BigQuery.",
    inputSchema: gmailListShape,
    handler: async (args) => {
      const parsed = GmailListInput.safeParse(args ?? {});
      if (!parsed.success) {
        return textResult(`Invalid arguments: ${parsed.error.message}`, true);
      }

      const result = await fetchGmailMessages({
        user: parsed.data.user,
        sinceDays: parsed.data.since_days,
        max: parsed.data.max,
        query: parsed.data.query,
      });

      if (!result.configured) {
        return textResult(result.note ?? "Gmail not configured.");
      }

      const lines: string[] = [
        `**Gmail messages** (mailbox: ${result.user}, fetched: ${result.fetched})`,
        "",
      ];
      if (result.note) {
        lines.push(result.note, "");
      }
      if (result.messages.length === 0) {
        lines.push("_No messages in the window._");
      } else {
        lines.push("| Date | From | Subject | Snippet |");
        lines.push("| --- | --- | --- | --- |");
        for (const m of result.messages) {
          lines.push(
            `| ${cell(m.date)} | ${cell(m.from)} | ${cell(m.subject)} | ${cell(
              truncate(m.snippet, 120),
            )} |`,
          );
        }
      }
      // Compact minified JSON (essential fields, truncated) so the full result
      // stays well under the model output-token limit. The table above already
      // carries the human-readable view.
      const compact = result.messages.map((m) => ({
        date: m.date,
        from: m.from,
        subject: m.subject,
        snippet: truncate(m.snippet, 140),
      }));
      lines.push("", "```json", JSON.stringify(compact), "```");
      if (result.fetched >= (parsed.data.max ?? 25)) {
        lines.push(
          "",
          "_Result capped. Narrow with a smaller since_days or a query to see more specific messages._",
        );
      }

      return textResult(lines.join("\n"));
    },
  };
}

// ── togari_fireflies_list ───────────────────────────────────────────

const firefliesListShape = {
  since_days: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("How many days back to include (default 90)."),
  max: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Max meetings to fetch (default 12, capped at 100)."),
};
const FirefliesListInput = z.object(firefliesListShape);

export function buildFirefliesListTool(): ToolModule {
  return {
    name: "togari_fireflies_list",
    description:
      "List recent Fireflies meetings (read-only) with recording links and action items. Returns a markdown table (date, title, attendees, action items) plus JSON including recordingUrl and actionItems. Fetches and RETURNS the data only; it does NOT write to the CRM or BigQuery.",
    inputSchema: firefliesListShape,
    handler: async (args) => {
      const parsed = FirefliesListInput.safeParse(args ?? {});
      if (!parsed.success) {
        return textResult(`Invalid arguments: ${parsed.error.message}`, true);
      }

      const result = await fetchFirefliesMeetings({
        sinceDays: parsed.data.since_days,
        max: parsed.data.max,
      });

      if (!result.configured) {
        return textResult(result.note ?? "Fireflies not configured.");
      }

      const lines: string[] = [
        `**Fireflies meetings** (fetched: ${result.fetched})`,
        "",
      ];
      if (result.note) {
        lines.push(result.note, "");
      }
      if (result.meetings.length === 0) {
        lines.push("_No meetings in the window._");
      } else {
        lines.push("| Date | Title | Attendees | Action items |");
        lines.push("| --- | --- | --- | --- |");
        for (const m of result.meetings) {
          const actions =
            m.actionItems.length > 0
              ? `${m.actionItems.length}: ${truncate(
                  m.actionItems.join("; "),
                  100,
                )}`
              : "—";
          lines.push(
            `| ${cell(m.date)} | ${cell(m.title)} | ${cell(
              truncate(m.attendees.join(", "), 80),
            )} | ${cell(actions)} |`,
          );
        }
      }
      // Compact minified JSON: keep recording links + a few action items and a
      // trimmed overview, so the payload stays under the output-token limit.
      const compact = result.meetings.map((m) => ({
        title: m.title,
        date: m.date,
        attendees: m.attendees.slice(0, 8),
        recordingUrl: m.recordingUrl,
        overview: m.overview ? truncate(m.overview, 240) : undefined,
        actionItems: m.actionItems.slice(0, 6),
      }));
      lines.push("", "```json", JSON.stringify(compact), "```");
      if (result.fetched >= (parsed.data.max ?? 12)) {
        lines.push(
          "",
          "_Result capped. Narrow with a smaller since_days to see more._",
        );
      }

      return textResult(lines.join("\n"));
    },
  };
}

// ── Registration ────────────────────────────────────────────────────

export const TOGARI_FETCH_TOOLS: ToolModule[] = [
  buildGmailListTool(),
  buildFirefliesListTool(),
];

/**
 * Register the read-only source-fetch MCP tools on an McpServer. Called by
 * src/transports/mcp/server.ts alongside the other tool-module registrants.
 */
export function registerFetchTools(server: McpServer): void {
  for (const mod of TOGARI_FETCH_TOOLS) {
    registerToolModule(server, mod);
  }
}

/** Alias matching the orchestrator's `ingestTools.register(server)` pattern. */
export const register = registerFetchTools;
