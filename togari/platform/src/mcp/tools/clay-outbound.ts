/**
 * Clay OUTBOUND MCP tools.
 *
 * These let an operator drive Clay FROM an MCP client (Perplexity,
 * Claude.ai, ChatGPT): select warehouse rows for the active client and
 * push them into a Clay table webhook for enrichment / outreach.
 *
 * Tools registered:
 *   - togari_clay_push          — select companies/contacts and push to a Clay table
 *   - togari_clay_enrich        — push specific row_ids to Clay for enrichment
 *   - togari_clay_list_pushable — read-only preview of what would be pushed
 *
 * Warehouse source tables (raw Clay passthrough, mostly STRING columns):
 *   togari_data_lake.companies  — company_name, website, domain, industry, row_id, _imported_at
 *   togari_data_lake.contacts   — full_name, email, company, title, linkedin_url, row_id, _imported_at
 *
 * Client isolation: rows are filtered by a `tag` column = ctx.tenantId when
 * present. The passthrough ingest stamps `tag` per client, so this scopes
 * the push to the caller's client_id (default "bma").
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerToolModule, type ToolModule } from "./registry";
import { BigQueryClient } from "../../bigquery/client";
import { resolveDataset } from "../../services/dataset-resolver";
import {
  pushRowsToClayTable,
  enrichViaClay,
} from "../../integrations/clay/client";
import { createLogger } from "../../observability/logger";

const logger = createLogger("mcp/clay-outbound");

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";

function moduleBq(): BigQueryClient {
  return new BigQueryClient(
    PROJECT_ID,
    null,
    process.env.GCP_CREDENTIALS_BASE64 ||
      process.env.GOOGLE_CREDENTIALS_BASE64 ||
      null,
  );
}

/** Columns selected per entity — only what a Clay push needs. */
const ENTITY_COLUMNS: Record<"companies" | "contacts", string[]> = {
  companies: ["row_id", "company_name", "website", "domain", "industry"],
  contacts: [
    "row_id",
    "full_name",
    "email",
    "company",
    "title",
    "linkedin_url",
  ],
};

function qualified(table: string): string {
  return `\`${PROJECT_ID}.${resolveDataset()}.${table}\``;
}

function textResult(
  text: string,
  isError = false,
): {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
} {
  return isError
    ? { content: [{ type: "text", text }], isError: true }
    : { content: [{ type: "text", text }] };
}

function invalidArgs(message: string) {
  return textResult(`Invalid arguments: ${message}`, true);
}

/**
 * Turn a raw BQ row (all-STRING passthrough) into a plain object with only
 * defined, non-empty string/number/boolean values — safe to POST to Clay.
 */
function toPushRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined || v === "") continue;
    out[k] = v;
  }
  return out;
}

// ── togari_clay_push ────────────────────────────────────────────────

const SIMPLE_WHERE = /^([a-zA-Z0-9_]+)\s*=\s*(.+)$/;

const pushInputShape = {
  table_webhook_url: z
    .string()
    .url()
    .describe(
      "The Clay table's 'Send Webhook to a Table' URL to push rows to.",
    ),
  entity: z
    .enum(["companies", "contacts"])
    .describe("Which warehouse table to pull rows from."),
  where: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Simple equality filter 'column=value' (e.g. 'industry=Software'). Only column=value is supported.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe("Max rows to select and push (default 100, max 500)."),
};
const PushInput = z.object(pushInputShape);

export function buildClayPushTool(
  deps: { bq?: BigQueryClient } = {},
): ToolModule {
  return {
    name: "togari_clay_push",
    description:
      "Select companies or contacts for the active client from the warehouse and push them into a Clay table webhook. Optional simple 'column=value' filter. Returns a summary of rows selected, pushed, and failed.",
    inputSchema: pushInputShape,
    handler: async (args, ctx) => {
      const parsed = PushInput.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);
      const input = parsed.data;
      const limit = input.limit ?? 100;
      const bq = deps.bq ?? moduleBq();

      const cols = ENTITY_COLUMNS[input.entity];
      const params: Record<string, unknown> = { clientId: ctx.tenantId, limit };
      const where: string[] = ["tag = @clientId"];
      let tagNote = "";

      if (input.where) {
        const m = SIMPLE_WHERE.exec(input.where.trim());
        if (!m) {
          return invalidArgs(
            "where must be a simple 'column=value' expression.",
          );
        }
        const col = m[1];
        if (!cols.includes(col)) {
          return invalidArgs(
            `where column '${col}' is not selectable for ${input.entity}. Allowed: ${cols.join(", ")}.`,
          );
        }
        where.push(`${col} = @whereValue`);
        params.whereValue = m[2].trim().replace(/^['"]|['"]$/g, "");
      }

      const sql = `
        SELECT ${cols.join(", ")}
          FROM ${qualified(input.entity)}
         WHERE ${where.join(" AND ")}
         LIMIT @limit
      `.trim();

      let selected: Record<string, unknown>[];
      try {
        const result = await bq.executeQuery(sql, params);
        selected = result.rows;
      } catch (err) {
        // Fall back without the tag filter if the tag column is absent.
        const message = err instanceof Error ? err.message : String(err);
        if (/tag/i.test(message)) {
          const fallbackWhere = input.where
            ? where.filter((w) => !w.startsWith("tag")).join(" AND ")
            : "1 = 1";
          const fbParams = { ...params };
          delete (fbParams as Record<string, unknown>).clientId;
          const fbSql = `
            SELECT ${cols.join(", ")}
              FROM ${qualified(input.entity)}
             WHERE ${fallbackWhere}
             LIMIT @limit
          `.trim();
          const result = await bq.executeQuery(fbSql, fbParams);
          selected = result.rows;
          tagNote = " (note: no `tag` column found, client filter skipped)";
        } else {
          throw err;
        }
      }

      if (selected.length === 0) {
        return textResult(
          `No ${input.entity} rows matched for client ${ctx.tenantId}${tagNote}. Nothing pushed.`,
        );
      }

      const rows = selected.map(toPushRow);
      const push = await pushRowsToClayTable(input.table_webhook_url, rows);

      logger.info("clay.push.tool", {
        entity: input.entity,
        clientId: ctx.tenantId,
        selected: selected.length,
        pushed: push.pushed,
        failed: push.failed,
      });

      const lines = [
        `**Clay push** (client: ${ctx.tenantId}, entity: ${input.entity})${tagNote}`,
        `Selected: ${selected.length} · Pushed: ${push.pushed} · Failed: ${push.failed}`,
      ];
      if (push.truncated) {
        lines.push(
          `Truncated: input exceeded the outbound cap; only the first ${push.pushed + push.failed} were sent.`,
        );
      }
      if (push.errors.length > 0) {
        lines.push("", "Errors:");
        for (const e of push.errors.slice(0, 10)) lines.push(`  - ${e}`);
      }
      return textResult(lines.join("\n"), push.failed > 0 && push.pushed === 0);
    },
  };
}

// ── togari_clay_enrich ──────────────────────────────────────────────

const enrichInputShape = {
  table_webhook_url: z
    .string()
    .url()
    .describe("The Clay table webhook URL to push rows to for enrichment."),
  entity: z
    .enum(["companies", "contacts"])
    .describe("Which warehouse table the ids belong to."),
  ids: z
    .array(z.string().min(1))
    .min(1)
    .max(500)
    .describe("row_id values to fetch and push to Clay for enrichment."),
};
const EnrichInput = z.object(enrichInputShape);

export function buildClayEnrichTool(
  deps: { bq?: BigQueryClient } = {},
): ToolModule {
  return {
    name: "togari_clay_enrich",
    description:
      "Fetch specific warehouse rows by row_id and push them to a Clay table for enrichment. Enriched values return asynchronously via the inbound Clay webhook, not in this response.",
    inputSchema: enrichInputShape,
    handler: async (args, ctx) => {
      const parsed = EnrichInput.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);
      const input = parsed.data;
      const bq = deps.bq ?? moduleBq();

      const cols = ENTITY_COLUMNS[input.entity];
      const sql = `
        SELECT ${cols.join(", ")}
          FROM ${qualified(input.entity)}
         WHERE row_id IN UNNEST(@ids)
         LIMIT 500
      `.trim();

      const result = await bq.executeQuery(sql, { ids: input.ids });
      const selected = result.rows;
      if (selected.length === 0) {
        return textResult(
          `No ${input.entity} rows found for the ${input.ids.length} id(s) provided. Nothing pushed.`,
        );
      }

      const rows = selected.map(toPushRow);
      const enrich = await enrichViaClay(input.table_webhook_url, rows);

      logger.info("clay.enrich.tool", {
        entity: input.entity,
        clientId: ctx.tenantId,
        requested: input.ids.length,
        selected: selected.length,
        pushed: enrich.pushed,
        failed: enrich.failed,
      });

      const lines = [
        `**Clay enrich** (client: ${ctx.tenantId}, entity: ${input.entity})`,
        `Requested ids: ${input.ids.length} · Matched: ${selected.length} · Pushed: ${enrich.pushed} · Failed: ${enrich.failed}`,
        enrich.note,
      ];
      if (enrich.errors.length > 0) {
        lines.push("", "Errors:");
        for (const e of enrich.errors.slice(0, 10)) lines.push(`  - ${e}`);
      }
      return textResult(
        lines.join("\n"),
        enrich.failed > 0 && enrich.pushed === 0,
      );
    },
  };
}

// ── togari_clay_list_pushable ───────────────────────────────────────

const listInputShape = {
  entity: z
    .enum(["companies", "contacts"])
    .describe("Which warehouse table to preview."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Max rows to preview (default 20, max 100)."),
};
const ListInput = z.object(listInputShape);

export function buildClayListPushableTool(
  deps: { bq?: BigQueryClient } = {},
): ToolModule {
  return {
    name: "togari_clay_list_pushable",
    description:
      "Read-only preview of the warehouse rows that a Clay push would send for the active client. Returns a small markdown table. Pushes nothing.",
    inputSchema: listInputShape,
    handler: async (args, ctx) => {
      const parsed = ListInput.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);
      const input = parsed.data;
      const limit = input.limit ?? 20;
      const bq = deps.bq ?? moduleBq();

      const cols = ENTITY_COLUMNS[input.entity];
      const params: Record<string, unknown> = { clientId: ctx.tenantId, limit };

      const sql = `
        SELECT ${cols.join(", ")}
          FROM ${qualified(input.entity)}
         WHERE tag = @clientId
         LIMIT @limit
      `.trim();

      let selected: Record<string, unknown>[];
      let tagNote = "";
      try {
        const result = await bq.executeQuery(sql, params);
        selected = result.rows;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/tag/i.test(message)) {
          const fbSql = `
            SELECT ${cols.join(", ")}
              FROM ${qualified(input.entity)}
             LIMIT @limit
          `.trim();
          const result = await bq.executeQuery(fbSql, { limit });
          selected = result.rows;
          tagNote = " (note: no `tag` column found, client filter skipped)";
        } else {
          throw err;
        }
      }

      if (selected.length === 0) {
        return textResult(
          `No pushable ${input.entity} rows for client ${ctx.tenantId}${tagNote}.`,
        );
      }

      const header = `| ${cols.join(" | ")} |`;
      const sep = `| ${cols.map(() => "---").join(" | ")} |`;
      const dataLines = selected.map(
        (r) =>
          `| ${cols
            .map((c) => {
              const v = r[c];
              const s = v === null || v === undefined ? "—" : String(v);
              return s.length > 60 ? s.slice(0, 59) + "…" : s;
            })
            .join(" | ")} |`,
      );

      const text = [
        `**Pushable ${input.entity}** (client: ${ctx.tenantId})${tagNote}`,
        `Previewing ${selected.length} of up to ${limit}.`,
        "",
        [header, sep, ...dataLines].join("\n"),
      ].join("\n");

      return textResult(text);
    },
  };
}

// ── togari_clay_push_clients (V1 source of truth -> Clay) ───────────

const pushClientsShape = {
  table_webhook_url: z
    .string()
    .min(1)
    .describe("The Clay table's webhook URL to push clients into."),
  stage: z
    .string()
    .optional()
    .describe("Optional: only push clients in this stage."),
  status: z
    .string()
    .optional()
    .describe("Optional: only push clients with this status."),
  limit: z.number().int().min(1).max(500).optional(),
};
const PushClientsInput = z.object(pushClientsShape);

const CLIENT_PUSH_COLUMNS = [
  "client_id",
  "name",
  "primary_email",
  "primary_domain",
  "stage",
  "pipeline",
  "owner",
  "status",
  "summary",
];

export function buildClayPushClientsTool(
  deps: { bq?: BigQueryClient } = {},
): ToolModule {
  return {
    name: "togari_clay_push_clients",
    description:
      "Push clients from the Togari source of truth into a Clay table webhook (for enrichment or outreach). Optionally filter by stage or status. This is the outbound half of the bidirectional Clay flow: Clay rows come into Togari via the /clay/v1/sync connector (action=client), and this sends clients back out.",
    inputSchema: pushClientsShape,
    handler: async (args, ctx) => {
      const parsed = PushClientsInput.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);
      const input = parsed.data;
      const limit = input.limit ?? 100;
      const bq = deps.bq ?? moduleBq();

      const where: string[] = ["client_brand = @brand"];
      const params: Record<string, unknown> = { brand: ctx.tenantId, limit };
      if (input.stage) {
        where.push("LOWER(stage) = @stage");
        params.stage = input.stage.trim().toLowerCase();
      }
      if (input.status) {
        where.push("LOWER(status) = @status");
        params.status = input.status.trim().toLowerCase();
      }

      const sql = `
        SELECT ${CLIENT_PUSH_COLUMNS.join(", ")}
          FROM ${qualified("clients")}
         WHERE ${where.join(" AND ")}
         ORDER BY updated_at DESC
         LIMIT @limit
      `.trim();

      const { rows: selected } = await bq.executeQuery(sql, params);
      if (selected.length === 0) {
        return textResult(
          `No clients matched for ${ctx.tenantId}. Nothing pushed.`,
        );
      }

      const rows = selected.map(toPushRow);
      const push = await pushRowsToClayTable(input.table_webhook_url, rows);

      logger.info("clay.push_clients.tool", {
        clientId: ctx.tenantId,
        selected: selected.length,
        pushed: push.pushed,
        failed: push.failed,
      });

      const lines = [
        `**Clay push clients** (org: ${ctx.tenantId})`,
        `Selected: ${selected.length} · Pushed: ${push.pushed} · Failed: ${push.failed}`,
      ];
      if (push.truncated)
        lines.push(
          `Truncated: input exceeded the outbound cap; only the first ${push.pushed + push.failed} were sent.`,
        );
      if (push.errors.length > 0) {
        lines.push("", "Errors:");
        for (const e of push.errors.slice(0, 10)) lines.push(`  - ${e}`);
      }
      return textResult(lines.join("\n"), push.failed > 0 && push.pushed === 0);
    },
  };
}

// ── Registration ────────────────────────────────────────────────────

const TOOLS: ToolModule[] = [
  buildClayPushClientsTool(),
  buildClayPushTool(),
  buildClayEnrichTool(),
  buildClayListPushableTool(),
];

/**
 * Register all Clay OUTBOUND MCP tools on an `McpServer`. Called by
 * `src/transports/mcp/server.ts` alongside the other tool-module registrants.
 */
export function registerClayOutboundTools(server: McpServer): void {
  for (const mod of TOOLS) {
    registerToolModule(server, mod);
  }
}
