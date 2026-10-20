/**
 * Read-only MCP tool for inspecting datapoints (EAV rows) on a company.
 *
 * Tool:
 *   - `togari_datapoints_get` — list datapoints for a company id, optionally
 *     filtered to specific keys. Groups output by source_type so the caller
 *     can see provenance at a glance.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerToolModule, type ToolModule } from "./registry";
import { traceCall } from "../../lib/tracing";
import { T, defaultBq, markdownTable, asIso, type ToolDeps } from "./_shared";

const getInputShape = {
  companyId: z.string().min(1).describe("Company UUID."),
  keys: z
    .array(z.string().min(1))
    .optional()
    .describe(
      "Optional allowlist of datapoint keys (e.g. ['revenue_estimate', 'industry']). If omitted, returns all keys.",
    ),
};
const GetInput = z.object(getInputShape);
type GetInput = z.infer<typeof GetInput>;

export function buildDatapointsGetTool(deps: ToolDeps = {}): ToolModule {
  return {
    name: "togari_datapoints_get",
    description:
      "Fetch datapoints for a company in the active tenant. Returns rows grouped by source_type, with key, value, evidence url, and created_at.",
    inputSchema: getInputShape,
    handler: (args, ctx) =>
      traceCall("togari_datapoints_get", async () => {
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

        const params: Record<string, unknown> = {
          companyId: input.companyId,
          tenantId: ctx.tenantId,
        };
        let keyFilter = "";
        if (input.keys && input.keys.length > 0) {
          keyFilter = "AND key IN UNNEST(@keys)";
          params.keys = input.keys;
        }

        const sql = `
          SELECT key, value, source_type, source_evidence_url, created_at
            FROM ${T.datapoints}
           WHERE company_id = @companyId
             AND tenant_id = @tenantId
             ${keyFilter}
           ORDER BY IFNULL(source_type, 'zzz') ASC, key ASC, created_at DESC
        `.trim();

        const result = await bq.executeQuery(sql, params);
        const rows = result.rows;

        if (rows.length === 0) {
          const tail =
            input.keys && input.keys.length > 0
              ? ` matching keys: ${input.keys.join(", ")}`
              : "";
          return {
            content: [
              {
                type: "text",
                text: `**Datapoints** (tenant: ${ctx.tenantId}, company: ${input.companyId})\n\nNo datapoints found${tail}.`,
              },
            ],
          };
        }

        // Group by source_type.
        const groups = new Map<string, typeof rows>();
        for (const r of rows) {
          const sourceType = (r.source_type as string | null) ?? "unknown";
          if (!groups.has(sourceType))
            groups.set(sourceType, [] as typeof rows);
          groups.get(sourceType)!.push(r);
        }

        const sections: string[] = [];
        for (const [sourceType, group] of groups) {
          const table = markdownTable(
            ["key", "value", "evidence", "created_at"],
            group.map((r) => [
              r.key as string,
              r.value as string | null,
              r.source_evidence_url as string | null,
              asIso(r.created_at) ?? "—",
            ]),
          );
          sections.push(
            `**Source: ${sourceType}** (${group.length})\n\n${table}`,
          );
        }

        const filterLine =
          input.keys && input.keys.length > 0
            ? `Key filter: ${input.keys.join(", ")}`
            : "Key filter: (none)";

        const text = [
          `**Datapoints** (tenant: ${ctx.tenantId}, company: ${input.companyId})`,
          filterLine,
          `Total: ${rows.length} across ${groups.size} source types.`,
          "",
          sections.join("\n\n"),
        ].join("\n");

        return { content: [{ type: "text", text }] };
      }),
  };
}

// ── Module registration ────────────────────────────────────────────

export function register(server: McpServer, deps: ToolDeps = {}): void {
  registerToolModule(server, buildDatapointsGetTool(deps));
}
