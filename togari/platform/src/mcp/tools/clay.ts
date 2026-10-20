/**
 * Read-only MCP tools for Clay webhook ingestion observability.
 *
 * Tools:
 *   - `togari_clay_list_imports` — paged list of clay_imports rows with
 *     optional mandate + status filters.
 *   - `togari_clay_get_import`   — single row plus linked counts (returns
 *     the same id/clay_run_id, status, hash, counts, error_message).
 *
 * The clay_imports table is the audit log written by the Clay webhook
 * ingestion route in src/ingest/clay/persister.ts. These tools make it
 * inspectable from Claude / ChatGPT.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerToolModule, type ToolModule } from "./registry";
import { traceCall } from "../../lib/tracing";
import {
  T,
  defaultBq,
  markdownTable,
  markdownDl,
  asIso,
  asNumber,
  clamp,
  type ToolDeps,
} from "./_shared";

// ── togari_clay_list_imports ────────────────────────────────────────

const listInputShape = {
  mandateId: z
    .string()
    .min(1)
    .optional()
    .describe("Restrict to imports tagged with this mandate id."),
  status: z
    .enum(["pending", "completed", "failed"])
    .optional()
    .describe("Restrict to a specific clay_imports.status value."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Max rows to return (1-100, default 25)."),
};
const ListInput = z.object(listInputShape);
type ListInput = z.infer<typeof ListInput>;

export function buildClayListImportsTool(deps: ToolDeps = {}): ToolModule {
  return {
    name: "togari_clay_list_imports",
    description:
      "List Clay webhook ingestion audit rows for the active tenant, newest first. Optional filters: mandate id, status (pending/completed/failed). Returns a markdown table.",
    inputSchema: listInputShape,
    handler: (args, ctx) =>
      traceCall("togari_clay_list_imports", async () => {
        const parsed = ListInput.safeParse(args ?? {});
        if (!parsed.success) {
          return {
            content: [
              {
                type: "text",
                text: `Invalid arguments: ${parsed.error.message}`,
              },
            ],
            isError: true,
          };
        }
        const input: ListInput = parsed.data;
        const limit = clamp(input.limit ?? 25, 1, 100);
        const bq = deps.bq ?? defaultBq();

        const params: Record<string, unknown> = {
          tenantId: ctx.tenantId,
          limit,
        };
        const where: string[] = ["tenant_id = @tenantId"];

        if (input.mandateId) {
          where.push("mandate_id = @mandateId");
          params.mandateId = input.mandateId;
        }
        if (input.status) {
          where.push("status = @status");
          params.status = input.status;
        }

        const sql = `
          SELECT id, clay_run_id, mandate_id, status,
                 total_records, company_count, contact_count,
                 received_at, processed_at, error_message
            FROM ${T.clayImports}
           WHERE ${where.join(" AND ")}
           ORDER BY received_at DESC
           LIMIT @limit
        `.trim();

        const result = await bq.executeQuery(sql, params);
        const rows = result.rows;

        const table = markdownTable(
          [
            "id",
            "clay_run_id",
            "mandate",
            "status",
            "records",
            "companies",
            "contacts",
            "received_at",
            "error",
          ],
          rows.map((r) => [
            r.id as string,
            r.clay_run_id as string,
            (r.mandate_id as string | null) ?? "—",
            r.status as string,
            asNumber(r.total_records) ?? "—",
            asNumber(r.company_count) ?? "—",
            asNumber(r.contact_count) ?? "—",
            asIso(r.received_at) ?? "—",
            (r.error_message as string | null) ?? "—",
          ]),
        );

        const filterParts: string[] = [];
        if (input.mandateId) filterParts.push(`mandate=${input.mandateId}`);
        if (input.status) filterParts.push(`status=${input.status}`);
        const filtersLine =
          filterParts.length > 0
            ? `Filters: ${filterParts.join(", ")}`
            : "Filters: (none)";

        const text = [
          `**Clay imports** (tenant: ${ctx.tenantId})`,
          filtersLine,
          `Returned ${rows.length} of up to ${limit}.`,
          "",
          table,
        ].join("\n");

        return { content: [{ type: "text", text }] };
      }),
  };
}

// ── togari_clay_get_import ──────────────────────────────────────────

const getInputShape = {
  id: z
    .string()
    .min(1)
    .optional()
    .describe("clay_imports row id (UUID). Provide either id or clay_run_id."),
  clay_run_id: z
    .string()
    .min(1)
    .optional()
    .describe("Clay-side run id. Provide either id or clay_run_id."),
};
const GetInput = z
  .object(getInputShape)
  .refine((v) => Boolean(v.id) !== Boolean(v.clay_run_id), {
    message: "Provide exactly one of: id, clay_run_id.",
  });
type GetInput = z.infer<typeof GetInput>;

export function buildClayGetImportTool(deps: ToolDeps = {}): ToolModule {
  return {
    name: "togari_clay_get_import",
    description:
      "Fetch a single Clay import audit row by id or clay_run_id. Returns status, counts, payload hash, and any error message.",
    inputSchema: getInputShape,
    handler: (args, ctx) =>
      traceCall("togari_clay_get_import", async () => {
        const parsed = GetInput.safeParse(args ?? {});
        if (!parsed.success) {
          return {
            content: [
              {
                type: "text",
                text: `Invalid arguments: ${parsed.error.message}`,
              },
            ],
            isError: true,
          };
        }
        const input: GetInput = parsed.data;
        const bq = deps.bq ?? defaultBq();

        const params: Record<string, unknown> = { tenantId: ctx.tenantId };
        let whereClause: string;
        let lookupHint: string;
        if (input.id) {
          whereClause = "id = @id AND tenant_id = @tenantId";
          params.id = input.id;
          lookupHint = `id=${input.id}`;
        } else {
          whereClause = "clay_run_id = @clayRunId AND tenant_id = @tenantId";
          params.clayRunId = input.clay_run_id!;
          lookupHint = `clay_run_id=${input.clay_run_id}`;
        }

        const sql = `
          SELECT id, clay_run_id, clay_table_id, mandate_id, payload_hash,
                 total_records, company_count, contact_count, status,
                 error_message, received_at, processed_at
            FROM ${T.clayImports}
           WHERE ${whereClause}
           ORDER BY received_at DESC
           LIMIT 1
        `.trim();

        const result = await bq.executeQuery(sql, params);
        if (result.rows.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No Clay import found for ${lookupHint} (tenant: ${ctx.tenantId}).`,
              },
            ],
            isError: true,
          };
        }
        const r = result.rows[0];

        const dl = markdownDl([
          ["id", r.id],
          ["clay_run_id", r.clay_run_id],
          ["clay_table_id", r.clay_table_id],
          ["mandate_id", r.mandate_id],
          ["status", r.status],
          ["total_records", asNumber(r.total_records)],
          ["company_count", asNumber(r.company_count)],
          ["contact_count", asNumber(r.contact_count)],
          ["payload_hash", r.payload_hash],
          ["error_message", r.error_message],
          ["received_at", asIso(r.received_at)],
          ["processed_at", asIso(r.processed_at)],
        ]);

        const text = [`**Clay import** (tenant: ${ctx.tenantId})`, "", dl].join(
          "\n",
        );
        return { content: [{ type: "text", text }] };
      }),
  };
}

// ── Module registration ────────────────────────────────────────────

export function register(server: McpServer, deps: ToolDeps = {}): void {
  registerToolModule(server, buildClayListImportsTool(deps));
  registerToolModule(server, buildClayGetImportTool(deps));
}
