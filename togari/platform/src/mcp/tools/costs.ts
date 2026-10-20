/**
 * Read-only MCP tools for cost summarisation.
 *
 * Tools:
 *   - `togari_costs_summary_for_run`     — aggregate cost_logs for a single
 *     tiering or enrichment run. Breakdown by service_type plus per-company
 *     average across completed companies on the run.
 *   - `togari_costs_summary_for_mandate` — rollup across all runs for the
 *     mandate, optionally filtered to created_at >= @since.
 *
 * All amounts are stored as integer cents in cost_logs.total_cost_cents.
 * The markdown output renders both cents and a dollar approximation
 * (cents / 100) for human readability.
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
  asNumber,
  type ToolDeps,
} from "./_shared";

function centsToDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// ── togari_costs_summary_for_run ────────────────────────────────────

const runInputShape = {
  runId: z.string().min(1).describe("tiering_runs.id or enrichment_runs.id."),
  kind: z
    .enum(["tiering", "enrichment"])
    .describe("Which run table the runId belongs to."),
};
const RunInput = z.object(runInputShape);
type RunInput = z.infer<typeof RunInput>;

export function buildCostsSummaryForRunTool(deps: ToolDeps = {}): ToolModule {
  return {
    name: "togari_costs_summary_for_run",
    description:
      "Cost breakdown for a single tiering or enrichment run: total cents, total dollars, breakdown by service_type, and per-company average across completed companies.",
    inputSchema: runInputShape,
    handler: (args, ctx) =>
      traceCall("togari_costs_summary_for_run", async () => {
        const parsed = RunInput.safeParse(args ?? {});
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
        const input: RunInput = parsed.data;
        const bq = deps.bq ?? defaultBq();

        const runField =
          input.kind === "tiering" ? "tiering_run_id" : "enrichment_run_id";
        const runTable =
          input.kind === "tiering" ? T.tieringRuns : T.enrichmentRuns;
        const runCompaniesTable =
          input.kind === "tiering"
            ? T.tieringRunCompanies
            : T.enrichmentRunCompanies;
        const runFkOnRunCompanies =
          input.kind === "tiering" ? "tiering_run_id" : "enrichment_run_id";

        // Validate the run exists for this tenant and fetch the persisted summary.
        const runResult = await bq.executeQuery(
          `SELECT id, status, total_cost_cents, mandate_id, started_at, finished_at
             FROM ${runTable}
            WHERE id = @runId AND tenant_id = @tenantId
            LIMIT 1`,
          { runId: input.runId, tenantId: ctx.tenantId },
        );
        if (runResult.rows.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No ${input.kind} run found with id=${input.runId} for tenant ${ctx.tenantId}.`,
              },
            ],
            isError: true,
          };
        }
        const run = runResult.rows[0];

        // Breakdown by service_type from cost_logs.
        const breakdownResult = await bq.executeQuery(
          `SELECT service_type,
                  COUNT(*) AS call_count,
                  SUM(total_cost_cents) AS total_cents,
                  SUM(IFNULL(input_tokens, 0)) AS input_tokens,
                  SUM(IFNULL(output_tokens, 0)) AS output_tokens
             FROM ${T.costLogs}
            WHERE ${runField} = @runId AND tenant_id = @tenantId
            GROUP BY service_type
            ORDER BY total_cents DESC`,
          { runId: input.runId, tenantId: ctx.tenantId },
        );

        // Completed-company count on the run, for per-company average.
        const completedResult = await bq.executeQuery(
          `SELECT COUNT(*) AS completed
             FROM ${runCompaniesTable}
            WHERE ${runFkOnRunCompanies} = @runId
              AND tenant_id = @tenantId
              AND status = 'completed'`,
          { runId: input.runId, tenantId: ctx.tenantId },
        );

        const totalCents = breakdownResult.rows.reduce(
          (acc, r) => acc + (asNumber(r.total_cents) ?? 0),
          0,
        );
        const completed = asNumber(completedResult.rows[0]?.completed) ?? 0;
        const perCompanyCents =
          completed > 0 ? Math.round(totalCents / completed) : null;

        const summaryDl = markdownDl([
          ["run id", run.id],
          ["kind", input.kind],
          ["mandate_id", run.mandate_id],
          ["status", run.status],
          ["persisted total_cost_cents", asNumber(run.total_cost_cents) ?? "—"],
          ["computed total (cents)", totalCents],
          ["computed total ($)", centsToDollars(totalCents)],
          ["completed companies", completed],
          [
            "per-company average (cents)",
            perCompanyCents === null ? "—" : perCompanyCents,
          ],
          [
            "per-company average ($)",
            perCompanyCents === null ? "—" : centsToDollars(perCompanyCents),
          ],
        ]);

        const breakdownTable = markdownTable(
          ["service_type", "calls", "cents", "$", "in_tokens", "out_tokens"],
          breakdownResult.rows.map((r) => {
            const cents = asNumber(r.total_cents) ?? 0;
            return [
              r.service_type as string,
              asNumber(r.call_count) ?? 0,
              cents,
              centsToDollars(cents),
              asNumber(r.input_tokens) ?? 0,
              asNumber(r.output_tokens) ?? 0,
            ];
          }),
        );

        const text = [
          `**Cost summary** (tenant: ${ctx.tenantId})`,
          "",
          summaryDl,
          "",
          `**Breakdown by service_type** (${breakdownResult.rows.length})`,
          "",
          breakdownTable,
        ].join("\n");

        return { content: [{ type: "text", text }] };
      }),
  };
}

// ── togari_costs_summary_for_mandate ────────────────────────────────

const mandateInputShape = {
  mandateId: z.string().min(1).describe("Mandate UUID."),
  since: z
    .string()
    .datetime()
    .optional()
    .describe(
      "ISO-8601 timestamp. Only count cost_logs with created_at >= since.",
    ),
};
const MandateInput = z.object(mandateInputShape);
type MandateInput = z.infer<typeof MandateInput>;

export function buildCostsSummaryForMandateTool(
  deps: ToolDeps = {},
): ToolModule {
  return {
    name: "togari_costs_summary_for_mandate",
    description:
      "Total spend across all tiering and enrichment runs for a mandate, broken down by service_type. Optional `since` (ISO-8601) restricts to recent activity.",
    inputSchema: mandateInputShape,
    handler: (args, ctx) =>
      traceCall("togari_costs_summary_for_mandate", async () => {
        const parsed = MandateInput.safeParse(args ?? {});
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
        const input: MandateInput = parsed.data;
        const bq = deps.bq ?? defaultBq();

        const params: Record<string, unknown> = {
          tenantId: ctx.tenantId,
          mandateId: input.mandateId,
        };
        let sinceClause = "";
        if (input.since) {
          sinceClause = "AND cl.created_at >= TIMESTAMP(@since)";
          params.since = input.since;
        }

        const sql = `
          SELECT cl.service_type,
                 COUNT(*) AS call_count,
                 SUM(cl.total_cost_cents) AS total_cents,
                 SUM(IFNULL(cl.input_tokens, 0)) AS input_tokens,
                 SUM(IFNULL(cl.output_tokens, 0)) AS output_tokens
            FROM ${T.costLogs} cl
           WHERE cl.tenant_id = @tenantId
             AND (
               cl.tiering_run_id IN (
                 SELECT id FROM ${T.tieringRuns}
                  WHERE mandate_id = @mandateId AND tenant_id = @tenantId
               )
               OR cl.enrichment_run_id IN (
                 SELECT id FROM ${T.enrichmentRuns}
                  WHERE mandate_id = @mandateId AND tenant_id = @tenantId
               )
             )
             ${sinceClause}
           GROUP BY cl.service_type
           ORDER BY total_cents DESC
        `.trim();

        const result = await bq.executeQuery(sql, params);
        const totalCents = result.rows.reduce(
          (acc, r) => acc + (asNumber(r.total_cents) ?? 0),
          0,
        );

        const table = markdownTable(
          ["service_type", "calls", "cents", "$", "in_tokens", "out_tokens"],
          result.rows.map((r) => {
            const cents = asNumber(r.total_cents) ?? 0;
            return [
              r.service_type as string,
              asNumber(r.call_count) ?? 0,
              cents,
              centsToDollars(cents),
              asNumber(r.input_tokens) ?? 0,
              asNumber(r.output_tokens) ?? 0,
            ];
          }),
        );

        const summaryDl = markdownDl([
          ["mandate_id", input.mandateId],
          ["since", input.since ?? "(all time)"],
          ["total (cents)", totalCents],
          ["total ($)", centsToDollars(totalCents)],
          ["service types", result.rows.length],
        ]);

        const text = [
          `**Mandate cost summary** (tenant: ${ctx.tenantId})`,
          "",
          summaryDl,
          "",
          "**Breakdown by service_type**",
          "",
          table,
        ].join("\n");

        return { content: [{ type: "text", text }] };
      }),
  };
}

// ── Module registration ────────────────────────────────────────────

export function register(server: McpServer, deps: ToolDeps = {}): void {
  registerToolModule(server, buildCostsSummaryForRunTool(deps));
  registerToolModule(server, buildCostsSummaryForMandateTool(deps));
}
