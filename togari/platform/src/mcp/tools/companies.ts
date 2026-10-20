/**
 * Read-only MCP tools for companies in the Togari warehouse.
 *
 * Tools:
 *   - `togari_companies_search`  — paged search across companies, with
 *     optional mandate, tier, and free-text filters.
 *   - `togari_companies_get`     — full company row + datapoint summary
 *     by source_type + recent tier history.
 *
 * Every BQ query filters by `tenant_id` from the tool ctx. The handler
 * is wrapped in `traceCall` so Sentry sees per-tool spans when
 * tracing is initialised.
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

// ── togari_companies_search ─────────────────────────────────────────

const searchInputShape = {
  query: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Free-text match against company name and website (case-insensitive contains).",
    ),
  mandateId: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Only return companies linked to this mandate via mandate_companies.",
    ),
  tier: z
    .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
    .optional()
    .describe(
      "Only return companies whose most recent tier assignment matches. 1 = best fit, 4 = worst.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Max rows to return (1-100, default 25)."),
};

const SearchInput = z.object(searchInputShape);
type SearchInput = z.infer<typeof SearchInput>;

export function buildCompaniesSearchTool(deps: ToolDeps = {}): ToolModule {
  return {
    name: "togari_companies_search",
    description:
      "Search companies in the Togari warehouse for the active tenant. Filter by free-text (name/website), mandate id, or latest tier. Returns a markdown table.",
    inputSchema: searchInputShape,
    handler: (args, ctx) =>
      traceCall("togari_companies_search", async () => {
        const parsed = SearchInput.safeParse(args ?? {});
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
        const input: SearchInput = parsed.data;
        const limit = clamp(input.limit ?? 25, 1, 100);

        const bq = deps.bq ?? defaultBq();

        const params: Record<string, unknown> = {
          tenantId: ctx.tenantId,
          limit,
        };
        const where: string[] = ["c.tenant_id = @tenantId"];
        const joins: string[] = [];

        if (input.mandateId) {
          joins.push(
            `JOIN ${T.mandateCompanies} mc
                ON mc.company_id = c.id
               AND mc.tenant_id = c.tenant_id
               AND mc.mandate_id = @mandateId
               AND mc.removed_at IS NULL`,
          );
          params.mandateId = input.mandateId;
        }

        if (input.tier !== undefined) {
          // Latest tier per company across runs. We pick the highest
          // tiers.created_at per (tenant_id, company_id) and filter to the
          // requested tier value.
          joins.push(
            `JOIN (
                SELECT company_id, tier, created_at,
                       ROW_NUMBER() OVER (PARTITION BY tenant_id, company_id ORDER BY created_at DESC) AS rn
                  FROM ${T.tiers}
                 WHERE tenant_id = @tenantId
              ) latest_tier
                ON latest_tier.company_id = c.id
               AND latest_tier.rn = 1
               AND latest_tier.tier = @tier`,
          );
          params.tier = input.tier;
        }

        if (input.query) {
          where.push(
            "(LOWER(c.name) LIKE LOWER(@queryPattern) OR LOWER(IFNULL(c.website, '')) LIKE LOWER(@queryPattern))",
          );
          params.queryPattern = `%${input.query}%`;
        }

        const sql = `
          SELECT c.id, c.name, c.website, c.address, c.dc_id, c.source_original, c.created_at
            FROM ${T.companies} c
            ${joins.join("\n            ")}
           WHERE ${where.join(" AND ")}
           ORDER BY c.created_at DESC
           LIMIT @limit
        `.trim();

        const result = await bq.executeQuery(sql, params);
        const rows = result.rows;

        const table = markdownTable(
          ["id", "name", "website", "dc_id", "source", "created_at"],
          rows.map((r) => [
            r.id as string,
            r.name as string,
            (r.website as string | null) ?? "—",
            (r.dc_id as string | null) ?? "—",
            (r.source_original as string | null) ?? "—",
            asIso(r.created_at) ?? "—",
          ]),
        );

        const filterParts: string[] = [];
        if (input.query)
          filterParts.push(`query=${JSON.stringify(input.query)}`);
        if (input.mandateId) filterParts.push(`mandate=${input.mandateId}`);
        if (input.tier !== undefined) filterParts.push(`tier=${input.tier}`);
        const filtersLine =
          filterParts.length > 0
            ? `Filters: ${filterParts.join(", ")}`
            : "Filters: (none)";

        const text = [
          `**Companies search** (tenant: ${ctx.tenantId})`,
          filtersLine,
          `Returned ${rows.length} of up to ${limit}.`,
          "",
          table,
        ].join("\n");

        return { content: [{ type: "text", text }] };
      }),
  };
}

// ── togari_companies_get ────────────────────────────────────────────

const getInputShape = {
  id: z.string().min(1).describe("Company UUID."),
};
const GetInput = z.object(getInputShape);
type GetInput = z.infer<typeof GetInput>;

export function buildCompaniesGetTool(deps: ToolDeps = {}): ToolModule {
  return {
    name: "togari_companies_get",
    description:
      "Fetch a single company by id for the active tenant: full row, datapoint summary grouped by source_type, and recent tier history.",
    inputSchema: getInputShape,
    handler: (args, ctx) =>
      traceCall("togari_companies_get", async () => {
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

        const companyResult = await bq.executeQuery(
          `SELECT id, name, website, address, dc_id, source_original, created_at, updated_at
             FROM ${T.companies}
            WHERE id = @id AND tenant_id = @tenantId
            LIMIT 1`,
          { id: input.id, tenantId: ctx.tenantId },
        );
        if (companyResult.rows.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No company found with id=${input.id} for tenant ${ctx.tenantId}.`,
              },
            ],
            isError: true,
          };
        }
        const company = companyResult.rows[0];

        const datapointsResult = await bq.executeQuery(
          `SELECT IFNULL(source_type, 'unknown') AS source_type, COUNT(*) AS count
             FROM ${T.datapoints}
            WHERE company_id = @id AND tenant_id = @tenantId
            GROUP BY source_type
            ORDER BY count DESC`,
          { id: input.id, tenantId: ctx.tenantId },
        );

        const tiersResult = await bq.executeQuery(
          `SELECT t.tier, t.confidence_score, t.rationale, t.created_at, t.tiering_run_id
             FROM ${T.tiers} t
            WHERE t.company_id = @id AND t.tenant_id = @tenantId
            ORDER BY t.created_at DESC
            LIMIT 5`,
          { id: input.id, tenantId: ctx.tenantId },
        );

        const dl = markdownDl([
          ["id", company.id],
          ["name", company.name],
          ["website", company.website],
          ["address", company.address],
          ["dc_id", company.dc_id],
          ["source_original", company.source_original],
          ["created_at", asIso(company.created_at)],
          ["updated_at", asIso(company.updated_at)],
        ]);

        const dpTable = markdownTable(
          ["source_type", "count"],
          datapointsResult.rows.map((r) => [
            r.source_type as string,
            asNumber(r.count) ?? 0,
          ]),
        );

        const tierTable = markdownTable(
          ["tier", "confidence", "run_id", "rationale", "created_at"],
          tiersResult.rows.map((r) => [
            asNumber(r.tier) ?? "—",
            asNumber(r.confidence_score) ?? "—",
            r.tiering_run_id as string,
            r.rationale as string | null,
            asIso(r.created_at) ?? "—",
          ]),
        );

        const text = [
          `**Company** (tenant: ${ctx.tenantId})`,
          "",
          dl,
          "",
          `**Datapoints by source_type** (${datapointsResult.rows.length})`,
          "",
          dpTable,
          "",
          "**Recent tier history (up to 5)**",
          "",
          tierTable,
        ].join("\n");

        return { content: [{ type: "text", text }] };
      }),
  };
}

// ── Module registration ────────────────────────────────────────────

/**
 * Register both companies tools on the given MCP server. The orchestrator
 * calls this from `src/server.ts` after `setupMcpRoutes` once Tab 9 merges.
 */
export function register(server: McpServer, deps: ToolDeps = {}): void {
  registerToolModule(server, buildCompaniesSearchTool(deps));
  registerToolModule(server, buildCompaniesGetTool(deps));
}
