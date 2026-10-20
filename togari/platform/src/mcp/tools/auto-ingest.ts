/**
 * Auto-ingestion MCP tools.
 *
 * On-demand connectors that pull from external systems and route each item
 * through the EXISTING universal ingestion pipeline (raw-preserve, AI-extract,
 * route into CRM/pipeline). No new storage path: these just fetch and hand off
 * to UniversalIngestService via the source helpers.
 *
 * Tools:
 *   - togari_ingest_gmail      — pull recent emails and ingest each.
 *   - togari_ingest_fireflies  — pull recent meeting transcripts and ingest each.
 *
 * BigQuery is reached only through BigQueryClient so the smoke harness can
 * intercept every query. Follows the ingest.ts ToolModule conventions.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerToolModule, type ToolModule } from "./registry";
import { BigQueryClient } from "../../bigquery/client";
import { ingestGmail } from "../../ingest/sources/gmail-ingest";
import { ingestFireflies } from "../../ingest/sources/fireflies-ingest";

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";

interface AutoIngestToolDeps {
  bq?: BigQueryClient;
}

function defaultBq(): BigQueryClient {
  return new BigQueryClient(
    PROJECT_ID,
    null,
    process.env.GCP_CREDENTIALS_BASE64 ||
      process.env.GOOGLE_CREDENTIALS_BASE64 ||
      null,
  );
}

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], isError };
}

// ── togari_ingest_gmail ─────────────────────────────────────────────

const ingestGmailShape = {
  max: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .describe("Maximum number of recent emails to ingest (default 10)."),
  query: z
    .string()
    .optional()
    .describe("Optional Gmail search filter hint for the pull."),
};
const IngestGmailInput = z.object(ingestGmailShape);

export function buildIngestGmailTool(
  deps: AutoIngestToolDeps = {},
): ToolModule {
  return {
    name: "togari_ingest_gmail",
    description:
      "Pull recent emails from the configured BMA mailbox and ingest each one through Togari's universal pipeline: raw is preserved, then contacts, companies, and activities are extracted and routed into the CRM/pipeline tables. Returns a markdown summary. If Gmail is not configured, reports that cleanly.",
    inputSchema: ingestGmailShape,
    handler: async (args, ctx) => {
      const parsed = IngestGmailInput.safeParse(args ?? {});
      if (!parsed.success) {
        return textResult(`Invalid arguments: ${parsed.error.message}`, true);
      }
      const bq = deps.bq ?? defaultBq();

      const result = await ingestGmail({
        bq,
        clientId: ctx.tenantId,
        maxMessages: parsed.data.max,
        query: parsed.data.query,
      });

      if (!result.configured) {
        return textResult(
          `**Gmail ingest** (client: ${ctx.tenantId})\n\n${result.note ?? "Not configured."}`,
        );
      }

      const lines = [
        `**Gmail ingest** (client: ${ctx.tenantId})`,
        "",
        `Fetched: ${result.fetched}`,
        `Ingested: ${result.ingested}`,
      ];
      if (result.note) lines.push(`Note: ${result.note}`);
      for (const r of result.results) {
        lines.push(
          `- ${r.messageId}: extracted ${r.extracted}, routed ${r.routed}`,
        );
      }
      if (result.results.length === 0 && !result.note) {
        lines.push("(no messages to ingest)");
      }
      return textResult(lines.join("\n"));
    },
  };
}

// ── togari_ingest_fireflies ─────────────────────────────────────────

const ingestFirefliesShape = {
  max: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .describe("Maximum number of recent transcripts to ingest (default 10)."),
};
const IngestFirefliesInput = z.object(ingestFirefliesShape);

export function buildIngestFirefliesTool(
  deps: AutoIngestToolDeps = {},
): ToolModule {
  return {
    name: "togari_ingest_fireflies",
    description:
      "Pull recent Fireflies meeting transcripts and ingest each one through Togari's universal pipeline: raw transcript is preserved, then contacts, companies, and activities are extracted and routed into the CRM/pipeline tables. Returns a markdown summary. If Fireflies is not configured, reports that cleanly.",
    inputSchema: ingestFirefliesShape,
    handler: async (args, ctx) => {
      const parsed = IngestFirefliesInput.safeParse(args ?? {});
      if (!parsed.success) {
        return textResult(`Invalid arguments: ${parsed.error.message}`, true);
      }
      const bq = deps.bq ?? defaultBq();

      const result = await ingestFireflies({
        bq,
        clientId: ctx.tenantId,
        maxMeetings: parsed.data.max,
      });

      if (!result.configured) {
        return textResult(
          `**Fireflies ingest** (client: ${ctx.tenantId})\n\n${result.note ?? "Not configured."}`,
        );
      }

      const lines = [
        `**Fireflies ingest** (client: ${ctx.tenantId})`,
        "",
        `Fetched: ${result.fetched}`,
        `Ingested: ${result.ingested}`,
      ];
      if (result.note) lines.push(`Note: ${result.note}`);
      for (const r of result.results) {
        lines.push(
          `- ${r.meetingId}: extracted ${r.extracted}, routed ${r.routed}`,
        );
      }
      if (result.results.length === 0 && !result.note) {
        lines.push("(no transcripts to ingest)");
      }
      return textResult(lines.join("\n"));
    },
  };
}

// ── Registration ────────────────────────────────────────────────────

export const TOGARI_AUTO_INGEST_TOOLS: ToolModule[] = [
  buildIngestGmailTool(),
  buildIngestFirefliesTool(),
];

/**
 * Register the auto-ingestion MCP tools on an McpServer. Called by
 * src/transports/mcp/server.ts alongside the other tool-module registrants.
 */
export function registerAutoIngestTools(server: McpServer): void {
  for (const mod of TOGARI_AUTO_INGEST_TOOLS) {
    registerToolModule(server, mod);
  }
}

/** Alias matching the orchestrator's `import * as tools; tools.register(server)` pattern. */
export const register = registerAutoIngestTools;
