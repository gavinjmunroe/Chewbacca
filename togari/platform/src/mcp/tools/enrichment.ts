/**
 * MCP tool modules for enrichment runs.
 *
 *   togari_enrichment_start_run
 *     Insert a new enrichment_runs row, seed enrichment_run_companies for the
 *     mandate's active companies (scope=all | unprocessed), then hand off to
 *     Tab 3's scheduler. Returns the runId.
 *
 *   togari_enrichment_get_run
 *     Fetch one enrichment run with per-company status counts, cost summary,
 *     and an ETA estimate.
 *
 *   togari_enrichment_list_runs
 *     Paged list of enrichment runs for the tenant.
 *
 * 'unprocessed' scope for enrichment skips any company that's been touched by
 * a prior enrichment run (i.e. has a row in any enrichment_run_companies). This
 * differs from tiering, which uses the tiers table.
 */

import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerToolModule,
  type ToolModule,
  type ToolCallContext,
  type ToolCallResult,
} from "./registry";
import { BigQueryClient } from "../../bigquery/client";
import { TOGARI_CORE_TABLES } from "../../bigquery/schema";
import { traceCall } from "../../lib/tracing";
import { startRun as schedulerStartRun } from "../../worker/scheduler";
import { createLogger } from "../../observability/logger";
import { formatTimestamp } from "./mandates";

const logger = createLogger("mcp/tools/enrichment");

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";
const DATASET = process.env.BIGQUERY_DATASET || "togari_core";

const ENRICHMENT_RUNS = `\`${PROJECT_ID}.${DATASET}.${TOGARI_CORE_TABLES.enrichment_runs.split(".")[1]}\``;
const ENRICHMENT_RUN_COMPANIES = `\`${PROJECT_ID}.${DATASET}.${TOGARI_CORE_TABLES.enrichment_run_companies.split(".")[1]}\``;
const MANDATE_COMPANIES = `\`${PROJECT_ID}.${DATASET}.${TOGARI_CORE_TABLES.mandate_companies.split(".")[1]}\``;
const MANDATES = `\`${PROJECT_ID}.${DATASET}.${TOGARI_CORE_TABLES.mandates.split(".")[1]}\``;
const COST_LOGS = `\`${PROJECT_ID}.${DATASET}.${TOGARI_CORE_TABLES.cost_logs.split(".")[1]}\``;

function textResult(text: string): ToolCallResult {
  return { content: [{ type: "text", text }] };
}

function errorResult(message: string): ToolCallResult {
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

let cachedBq: BigQueryClient | null = null;
function bq(): BigQueryClient {
  if (!cachedBq) {
    cachedBq = new BigQueryClient(
      PROJECT_ID,
      null,
      process.env.GCP_CREDENTIALS_BASE64 ||
        process.env.GOOGLE_CREDENTIALS_BASE64 ||
        null,
    );
  }
  return cachedBq;
}

export function __resetEnrichmentBigQueryClient(): void {
  cachedBq = null;
}

type StartRunFn = typeof schedulerStartRun;
let startRunImpl: StartRunFn = schedulerStartRun;
export function __setStartRunImpl(fn: StartRunFn | null): void {
  startRunImpl = fn ?? schedulerStartRun;
}

// ─── togari_enrichment_start_run ────────────────────────────────────────────

const startRunInputShape = {
  mandateId: z
    .string()
    .min(1)
    .describe("Mandate to enrich. Companies pulled from mandate_companies."),
  scope: z
    .enum(["all", "unprocessed"])
    .optional()
    .describe(
      "Which companies to enroll. 'all' (default) takes every active mandate_companies row. 'unprocessed' skips any company that's already been touched by a previous enrichment run.",
    ),
  criteriaVersionId: z
    .string()
    .optional()
    .describe(
      "Specific mandate_criteria_versions id to enrich against. Defaults to the mandate's active_criteria_version_id.",
    ),
  mode: z
    .enum(["sequential", "agent"])
    .optional()
    .describe(
      "Enrichment execution mode. 'sequential' runs deterministic prompts. 'agent' (default) uses the agent loop with Exa / CrustData / Perplexity / Grata tool calls.",
    ),
  priority: z
    .number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .describe("Run priority hint propagated on Pub/Sub messages (0-100)."),
};

const startRunInputSchema = z.object(startRunInputShape);

const startRunTool: ToolModule = {
  name: "togari_enrichment_start_run",
  description:
    "Start an enrichment run over a mandate's companies. Inserts an enrichment_runs row, seeds enrichment_run_companies, flips the run to 'running', and publishes the initial batch of company messages to togari_enrichment_company. Returns the new runId.",
  inputSchema: startRunInputShape,
  handler: async (args, ctx: ToolCallContext): Promise<ToolCallResult> => {
    const parsed = startRunInputSchema.safeParse(args ?? {});
    if (!parsed.success) {
      return errorResult(
        `Invalid input: ${JSON.stringify(parsed.error.flatten())}`,
      );
    }
    const {
      mandateId,
      scope = "all",
      criteriaVersionId,
      mode = "agent",
      priority,
    } = parsed.data;

    return traceCall("mcp.enrichment.start_run", async () => {
      const mandateLookup = await bq().executeQuery(
        `SELECT active_criteria_version_id
           FROM ${MANDATES}
          WHERE tenant_id = @tenant_id AND id = @mandate_id
          LIMIT 1`,
        { tenant_id: ctx.tenantId, mandate_id: mandateId },
      );
      if (mandateLookup.rows.length === 0) {
        return errorResult(
          `Mandate '${mandateId}' not found for tenant ${ctx.tenantId}.`,
        );
      }
      const resolvedCriteriaId =
        criteriaVersionId ??
        (mandateLookup.rows[0]?.active_criteria_version_id as string | null) ??
        null;

      const runId = randomUUID();
      await bq().executeWrite(
        `INSERT INTO ${ENRICHMENT_RUNS}
           (id, tenant_id, mandate_id, criteria_version_id, status, mode,
            tool_settings, priority, preempted_by, total_cost_cents,
            cost_breakdown, key_data_points, agent_summary,
            started_at, finished_at, error_message, created_at)
         VALUES
           (@id, @tenant_id, @mandate_id, @criteria_id, 'pending', @mode,
            NULL, @priority, NULL, 0,
            NULL, NULL, NULL,
            NULL, NULL, NULL, CURRENT_TIMESTAMP())`,
        {
          id: runId,
          tenant_id: ctx.tenantId,
          mandate_id: mandateId,
          criteria_id: resolvedCriteriaId,
          mode,
          priority: priority ?? null,
        },
      );

      // 'unprocessed' for enrichment: company has no prior enrichment_run_companies row.
      const unprocessedFilter =
        scope === "unprocessed"
          ? `
            AND NOT EXISTS (
              SELECT 1 FROM ${ENRICHMENT_RUN_COMPANIES} erc
              WHERE erc.tenant_id = mc.tenant_id
                AND erc.company_id = mc.company_id
            )`
          : "";

      const seedResult = await bq().executeWrite(
        `INSERT INTO ${ENRICHMENT_RUN_COMPANIES}
           (id, tenant_id, enrichment_run_id, company_id, status, attempts,
            started_at, finished_at, error_message, processing_log,
            agent_summary, created_at)
         SELECT
           GENERATE_UUID(), @tenant_id, @run_id, mc.company_id, 'pending', 0,
           NULL, NULL, NULL, NULL, NULL, CURRENT_TIMESTAMP()
         FROM ${MANDATE_COMPANIES} mc
         WHERE mc.tenant_id = @tenant_id
           AND mc.mandate_id = @mandate_id
           AND mc.removed_at IS NULL
           ${unprocessedFilter}`,
        {
          tenant_id: ctx.tenantId,
          run_id: runId,
          mandate_id: mandateId,
        },
      );

      const seededRowCount = Number(seedResult.numDmlAffectedRows ?? 0) || 0;
      if (seededRowCount === 0) {
        await bq().executeWrite(
          `UPDATE ${ENRICHMENT_RUNS}
              SET status = 'completed',
                  started_at = CURRENT_TIMESTAMP(),
                  finished_at = CURRENT_TIMESTAMP()
            WHERE tenant_id = @tenant_id AND id = @run_id`,
          { tenant_id: ctx.tenantId, run_id: runId },
        );
        return textResult(
          [
            `Enrichment run created but no eligible companies were found.`,
            ``,
            `- **Run ID**: ${runId}`,
            `- **Mandate**: ${mandateId}`,
            `- **Scope**: ${scope}`,
            ``,
            scope === "unprocessed"
              ? "All companies in this mandate have already been enriched at least once. Pass scope='all' to re-enrich."
              : "Add companies to mandate_companies first.",
          ].join("\n"),
        );
      }

      let publishedCount = 0;
      try {
        publishedCount = await startRunImpl(
          "enrichment",
          ctx.tenantId,
          runId,
          mode,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await bq().executeWrite(
          `UPDATE ${ENRICHMENT_RUNS}
              SET status = 'failed',
                  finished_at = CURRENT_TIMESTAMP(),
                  error_message = @error
            WHERE tenant_id = @tenant_id AND id = @run_id`,
          {
            tenant_id: ctx.tenantId,
            run_id: runId,
            error: `scheduler.startRun failed: ${message}`,
          },
        );
        logger.error(
          "enrichment.start_run scheduler failure",
          err instanceof Error ? err : new Error(message),
        );
        return errorResult(
          `Run row created (${runId}) but scheduler failed to publish initial messages: ${message}`,
        );
      }

      logger.info("enrichment.run.started", {
        tenantId: ctx.tenantId,
        runId,
        mandateId,
        seededRowCount,
        publishedCount,
      });

      return textResult(
        [
          `Enrichment run started.`,
          ``,
          `- **Run ID**: ${runId}`,
          `- **Mandate**: ${mandateId}`,
          `- **Criteria version**: ${resolvedCriteriaId ?? "—"}`,
          `- **Mode**: ${mode}`,
          `- **Scope**: ${scope}`,
          `- **Companies enrolled**: ${seededRowCount}`,
          `- **Initial Pub/Sub messages published**: ${publishedCount}`,
          ``,
          `Poll status with togari_enrichment_get_run({ runId: "${runId}" }).`,
        ].join("\n"),
      );
    });
  },
};

// ─── togari_enrichment_get_run ──────────────────────────────────────────────

const getRunInputShape = {
  runId: z.string().min(1).describe("Enrichment run id."),
};
const getRunInputSchema = z.object(getRunInputShape);

const getRunTool: ToolModule = {
  name: "togari_enrichment_get_run",
  description:
    "Fetch one enrichment run: status, mandate, mode, per-company status breakdown, cost summary, ETA, and agent_summary text if present.",
  inputSchema: getRunInputShape,
  handler: async (args, ctx: ToolCallContext): Promise<ToolCallResult> => {
    const parsed = getRunInputSchema.safeParse(args ?? {});
    if (!parsed.success) {
      return errorResult(
        `Invalid input: ${JSON.stringify(parsed.error.flatten())}`,
      );
    }
    const { runId } = parsed.data;

    return traceCall("mcp.enrichment.get_run", async () => {
      const runQuery = await bq().executeQuery(
        `SELECT id, mandate_id, criteria_version_id, status, mode, priority,
                total_cost_cents, agent_summary, started_at, finished_at,
                error_message, created_at
           FROM ${ENRICHMENT_RUNS}
          WHERE tenant_id = @tenant_id AND id = @run_id
          LIMIT 1`,
        { tenant_id: ctx.tenantId, run_id: runId },
      );
      const run = runQuery.rows[0];
      if (!run) {
        return errorResult(
          `Enrichment run '${runId}' not found for tenant ${ctx.tenantId}.`,
        );
      }

      const statusQuery = await bq().executeQuery(
        `SELECT status, COUNT(*) AS n
           FROM ${ENRICHMENT_RUN_COMPANIES}
          WHERE tenant_id = @tenant_id AND enrichment_run_id = @run_id
          GROUP BY status`,
        { tenant_id: ctx.tenantId, run_id: runId },
      );
      const statusCounts: Record<string, number> = {};
      for (const r of statusQuery.rows) {
        statusCounts[String(r.status)] = Number(r.n ?? 0) || 0;
      }
      const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);
      const completed = statusCounts.completed ?? 0;
      const failed = statusCounts.failed ?? 0;
      const pending = statusCounts.pending ?? 0;
      const queued = statusCounts.queued ?? 0;
      const running = statusCounts.running ?? 0;
      const remaining = pending + queued + running;

      const costQuery = await bq().executeQuery(
        `SELECT service_type, SUM(total_cost_cents) AS cents
           FROM ${COST_LOGS}
          WHERE tenant_id = @tenant_id AND enrichment_run_id = @run_id
          GROUP BY service_type
          ORDER BY cents DESC`,
        { tenant_id: ctx.tenantId, run_id: runId },
      );

      const startedAtStr = formatTimestamp(run.started_at);
      const startedAtMs =
        startedAtStr === "—" ? null : Date.parse(startedAtStr) || null;
      let etaText = "—";
      if (startedAtMs && completed > 0 && remaining > 0) {
        const elapsedSec = Math.max(1, (Date.now() - startedAtMs) / 1000);
        const ratePerSec = completed / elapsedSec;
        if (ratePerSec > 0) {
          const secsRemaining = Math.round(remaining / ratePerSec);
          etaText = formatDuration(secsRemaining);
        }
      } else if (remaining === 0) {
        etaText = "complete";
      }

      const lines: Array<string | null> = [
        `# Enrichment run ${runId}`,
        ``,
        `- **Tenant**: ${ctx.tenantId}`,
        `- **Mandate**: ${run.mandate_id}`,
        `- **Criteria version**: ${run.criteria_version_id ?? "—"}`,
        `- **Status**: ${run.status}`,
        `- **Mode**: ${run.mode ?? "—"}`,
        `- **Priority**: ${run.priority ?? "—"}`,
        `- **Started**: ${formatTimestamp(run.started_at)}`,
        `- **Finished**: ${formatTimestamp(run.finished_at)}`,
        `- **Created**: ${formatTimestamp(run.created_at)}`,
        `- **Total cost**: ${formatCents(run.total_cost_cents)}`,
        run.error_message ? `- **Error**: ${String(run.error_message)}` : null,
        ``,
        `## Companies (${total})`,
        ``,
        `- pending: ${pending}`,
        `- queued: ${queued}`,
        `- running: ${running}`,
        `- completed: ${completed}`,
        `- failed: ${failed}`,
        `- skipped: ${statusCounts.skipped ?? 0}`,
        ``,
        `**ETA**: ${etaText}`,
        ``,
        `## Cost by service`,
        ``,
      ];

      if (costQuery.rows.length === 0) {
        lines.push("_(no cost logs yet)_");
      } else {
        for (const r of costQuery.rows) {
          lines.push(`- ${String(r.service_type)}: ${formatCents(r.cents)}`);
        }
      }

      if (run.agent_summary) {
        lines.push("", "## Agent summary", "", String(run.agent_summary));
      }

      return textResult(
        lines.filter((x): x is string => x !== null).join("\n"),
      );
    });
  },
};

// ─── togari_enrichment_list_runs ────────────────────────────────────────────

const listRunsInputShape = {
  mandateId: z.string().optional().describe("Filter to one mandate."),
  status: z
    .enum([
      "pending",
      "queued",
      "running",
      "completed",
      "failed",
      "paused",
      "stopped",
    ])
    .optional()
    .describe("Filter by run status."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Maximum runs to return (default 20, max 100)."),
};
const listRunsInputSchema = z.object(listRunsInputShape);

const listRunsTool: ToolModule = {
  name: "togari_enrichment_list_runs",
  description:
    "List enrichment runs for the tenant, newest first. Optional filters on mandateId + status. Returns a markdown table.",
  inputSchema: listRunsInputShape,
  handler: async (args, ctx: ToolCallContext): Promise<ToolCallResult> => {
    const parsed = listRunsInputSchema.safeParse(args ?? {});
    if (!parsed.success) {
      return errorResult(
        `Invalid input: ${JSON.stringify(parsed.error.flatten())}`,
      );
    }
    const { mandateId, status, limit = 20 } = parsed.data;

    return traceCall("mcp.enrichment.list_runs", async () => {
      const params: Record<string, unknown> = {
        tenant_id: ctx.tenantId,
        limit,
      };
      const filters: string[] = ["tenant_id = @tenant_id"];
      if (mandateId) {
        filters.push("mandate_id = @mandate_id");
        params.mandate_id = mandateId;
      }
      if (status) {
        filters.push("status = @status");
        params.status = status;
      }

      const sql = `
        SELECT id, mandate_id, status, mode, total_cost_cents,
               started_at, finished_at, created_at
          FROM ${ENRICHMENT_RUNS}
         WHERE ${filters.join(" AND ")}
         ORDER BY created_at DESC
         LIMIT @limit
      `;
      const { rows } = await bq().executeQuery(sql, params);

      if (rows.length === 0) {
        return textResult(
          `No enrichment runs found for tenant ${ctx.tenantId}${mandateId ? ` (mandate ${mandateId})` : ""}${status ? ` (status ${status})` : ""}.`,
        );
      }

      const header =
        "| Run ID | Mandate | Status | Mode | Cost | Started | Finished |";
      const sep = "| --- | --- | --- | --- | --- | --- | --- |";
      const body = rows.map(
        (r) =>
          `| ${String(r.id)} | ${String(r.mandate_id)} | ${String(r.status)} | ${r.mode ?? "—"} | ${formatCents(r.total_cost_cents)} | ${formatTimestamp(r.started_at)} | ${formatTimestamp(r.finished_at)} |`,
      );
      const summary = `${rows.length} run${rows.length === 1 ? "" : "s"} (tenant=${ctx.tenantId}).`;
      return textResult([summary, "", header, sep, ...body].join("\n"));
    });
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatCents(value: unknown): string {
  if (value == null) return "—";
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number(value);
  if (!Number.isFinite(n)) return "—";
  return `$${(n / 100).toFixed(2)}`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMin = mins % 60;
  return remMin ? `${hours}h ${remMin}m` : `${hours}h`;
}

// ─── Bundled registration helper ────────────────────────────────────────────

export const TOGARI_ENRICHMENT_TOOLS: ToolModule[] = [
  startRunTool,
  getRunTool,
  listRunsTool,
];

export function registerEnrichmentTools(server: McpServer): void {
  for (const mod of TOGARI_ENRICHMENT_TOOLS) {
    registerToolModule(server, mod);
  }
}

/** Alias matching the plan's `register(server)` convention. */
export const register = registerEnrichmentTools;

export { startRunTool, getRunTool, listRunsTool };
