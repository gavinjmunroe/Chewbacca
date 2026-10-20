/**
 * Universal ingestion MCP tools.
 *
 * The "paste any free-form update and it becomes structured CRM data" surface.
 *
 * Tools:
 *   - togari_ingest_text   — paste free-form text; it is stored raw, then the
 *                            model extracts contacts / companies / activities /
 *                            tasks / facts / pipeline updates and routes them
 *                            into the pipeline + CRM tables. Returns markdown.
 *   - togari_ingest_status — read a raw_ingestions row by ingestion_id and
 *                            report its status + extracted count.
 *
 * BigQuery is reached only through BigQueryClient so the smoke harness can
 * intercept every query. Follows the exa.ts / clay.ts ToolModule conventions.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerToolModule, type ToolModule } from "./registry";
import { BigQueryClient } from "../../bigquery/client";
import { resolveDataset } from "../../services/dataset-resolver";
import { UniversalIngestService } from "../../ingest/universal/service";

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";

interface IngestToolDeps {
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

function rawIngestionsTable(): string {
  return `\`${PROJECT_ID}.${resolveDataset()}.raw_ingestions\``;
}

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], isError };
}

// ── togari_ingest_text ──────────────────────────────────────────────

const ingestTextShape = {
  text: z
    .string()
    .min(1)
    .describe(
      "Any free-form update to ingest. The raw is preserved, then contacts, companies, activities, tasks, facts, and pipeline updates are extracted and routed into the CRM/pipeline tables.",
    ),
  source: z
    .string()
    .min(1)
    .optional()
    .describe("Where this update came from (default 'mcp')."),
};
const IngestTextInput = z.object(ingestTextShape);

export function buildIngestTextTool(deps: IngestToolDeps = {}): ToolModule {
  return {
    name: "togari_ingest_text",
    description:
      "Ingest any free-form text update into Togari. The raw submission is stored verbatim, then structured entities (contacts, companies, activities, tasks, facts, pipeline updates) are extracted and routed into the CRM/pipeline tables. Returns a markdown summary.",
    inputSchema: ingestTextShape,
    handler: async (args, ctx) => {
      const parsed = IngestTextInput.safeParse(args ?? {});
      if (!parsed.success) {
        return textResult(`Invalid arguments: ${parsed.error.message}`, true);
      }
      const bq = deps.bq ?? defaultBq();
      const service = new UniversalIngestService({ bq });

      const result = await service.ingest({
        clientId: ctx.tenantId,
        source: parsed.data.source ?? "mcp",
        contentType: "text",
        rawText: parsed.data.text,
      });

      const lines = [
        `**Ingested** (client: ${ctx.tenantId})`,
        "",
        `Raw stored: \`${result.ingestionId}\``,
        `Entities extracted: ${result.extracted}`,
        `Routed — deals: ${result.routed.deals}, contacts: ${result.routed.contacts}, companies: ${result.routed.companies}, activities: ${result.routed.activities}`,
        result.summary ? `Summary: ${result.summary}` : "Summary: (none)",
      ];
      return textResult(lines.join("\n"));
    },
  };
}

// ── togari_ingest_status ────────────────────────────────────────────

const ingestStatusShape = {
  ingestion_id: z
    .string()
    .min(1)
    .describe("The ingestion id returned by togari_ingest_text."),
};
const IngestStatusInput = z.object(ingestStatusShape);

export function buildIngestStatusTool(deps: IngestToolDeps = {}): ToolModule {
  return {
    name: "togari_ingest_status",
    description:
      "Look up a universal-ingestion raw submission by its ingestion id and report its status and extracted entity count.",
    inputSchema: ingestStatusShape,
    handler: async (args, ctx) => {
      const parsed = IngestStatusInput.safeParse(args ?? {});
      if (!parsed.success) {
        return textResult(`Invalid arguments: ${parsed.error.message}`, true);
      }
      const bq = deps.bq ?? defaultBq();

      const sql = `
        SELECT ingestion_id, client_id, source, content_type,
               status, extracted_count, file_name, created_at
          FROM ${rawIngestionsTable()}
         WHERE ingestion_id = @ingestionId
         LIMIT 1
      `.trim();

      const result = await bq.executeQuery(sql, {
        ingestionId: parsed.data.ingestion_id,
      });
      if (result.rows.length === 0) {
        return textResult(
          `No ingestion found for ${parsed.data.ingestion_id} (client: ${ctx.tenantId}).`,
          true,
        );
      }
      const r = result.rows[0];
      const lines = [
        `**Ingestion status** (client: ${ctx.tenantId})`,
        "",
        `ingestion_id: ${r.ingestion_id}`,
        `source: ${r.source ?? "—"}`,
        `content_type: ${r.content_type ?? "—"}`,
        `status: ${r.status ?? "—"}`,
        `extracted_count: ${r.extracted_count ?? 0}`,
        `file_name: ${r.file_name ?? "—"}`,
      ];
      return textResult(lines.join("\n"));
    },
  };
}

// ── Registration ────────────────────────────────────────────────────

export const TOGARI_INGEST_TOOLS: ToolModule[] = [
  buildIngestTextTool(),
  buildIngestStatusTool(),
];

/**
 * Register the universal-ingestion MCP tools on an McpServer. Called by
 * src/transports/mcp/server.ts alongside the other tool-module registrants.
 */
export function registerIngestTools(server: McpServer): void {
  for (const mod of TOGARI_INGEST_TOOLS) {
    registerToolModule(server, mod);
  }
}

/** Alias matching the orchestrator's `import * as ingestTools; ingestTools.register(server)` pattern. */
export const register = registerIngestTools;
