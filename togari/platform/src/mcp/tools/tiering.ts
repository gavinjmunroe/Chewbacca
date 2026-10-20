/**
 * MCP tool modules for tiering runs.
 *
 *   togari_tiering_start_run
 *     Insert a new tiering_runs row, seed tiering_run_companies for the
 *     mandate's active companies (scope=all | unprocessed), then publish
 *     the initial Pub/Sub batch via Tab 3's scheduler. Returns the runId.
 *
 *   togari_tiering_get_run
 *     Fetch a single tiering run with its company-status counts, tier
 *     distribution, cost summary, and a naive ETA based on current
 *     throughput. Returns markdown.
 *
 *   togari_tiering_list_runs
 *     Paged list of tiering runs for the tenant, optionally narrowed by
 *     mandateId and/or status.
 *
 * All three filter by tenant_id pulled from the MCP auth context.
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

const logger = createLogger("mcp/tools/tiering");

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";
const DATASET = process.env.BIGQUERY_DATASET || "togari_core";

const TIERING_RUNS = `\`${PROJECT_ID}.${DATASET}.${TOGARI_CORE_TABLES.tiering_runs.split(".")[1]}\``;
const TIERING_RUN_COMPANIES = `\`${PROJECT_ID}.${DATASET}.${TOGARI_CORE_TABLES.tiering_run_companies.split(".")[1]}\``;
const TIERS = `\`${PROJECT_ID}.${DATASET}.${TOGARI_CORE_TABLES.tiers.split(".")[1]}\``;
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

export function __resetTieringBigQueryClient(): void {
  cachedBq = null;
}

/**
 * Internal seam: tests stub the scheduler so they don't have to mock Pub/Sub.
 * Production callers go through schedulerStartRun directly.
 */
type StartRunFn = typeof schedulerStartRun;
let startRunImpl: StartRunFn = schedulerStartRun;
export function __setStartRunImpl(fn: StartRunFn | null): void {
  startRunImpl = fn ?? schedulerStartRun;
}

// ─── togari_tiering_start_run ───────────────────────────────────────────────

const startRunInputShape = {
  mandateId: z
    .string()
    .min(1)
    .describe("Mandate to tier. Companies are pulled from mandate_companies."),
  scope: z
    .enum(["all", "unprocessed"])
    .optional()
    .describe(
      "Which companies to enroll. 'all' (default) takes every active mandate_companies row. 'unprocessed' skips any company that already has a tier row in any prior tiering run.",
    ),
  criteriaVersionId: z
    .string()
    .optional()
    .describe(
      "Specific mandate_criteria_versions id to tier against. Defaults to the mandate's active_criteria_version_id.",
    ),
  mode: z
    .enum(["sequential", "agent"])
    .optional()
    .describe(
      "Tiering execution mode. 'sequential' (default) runs deterministic prompts. 'agent' uses the agent loop with tool calls.",
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
  name: "togari_tiering_start_run",
  description:
    "Start a tiering run over a mandate's companies. Inserts a tiering_runs row, seeds tiering_run_companies (one per eligible company), flips the run to 'running', and publishes the initial batch of company messages to the togari_tiering_company Pub/Sub topic. Returns the new runId so callers can poll togari_tiering_get_run.",
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
      mode = "sequential",
      priority,
    } = parsed.data;

    return traceCall("mcp.tiering.start_run", async () => {
      // 1. Resolve the criteria version. If the caller didn't pass one, use
      //    the mandate's active_criteria_version_id.
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

      // 2. Insert the tiering_runs row at status='pending'. The scheduler
      //    flips it to 'running' once we hand off.
      const runId = randomUUID();
      await bq().executeWrite(
        `INSERT INTO ${TIERING_RUNS}
           (id, tenant_id, mandate_id, criteria_version_id, status, mode,
            tool_settings, priority, preempted_by, total_cost_cents,
            cost_breakdown, key_data_points, started_at, finished_at,
            error_message, created_at)
         VALUES
           (@id, @tenant_id, @mandate_id, @criteria_id, 'pending', @mode,
            NULL, @priority, NULL, 0,
            NULL, NULL, NULL, NULL,
            NULL, CURRENT_TIMESTAMP())`,
        {
          id: runId,
          tenant_id: ctx.tenantId,
          mandate_id: mandateId,
          criteria_id: resolvedCriteriaId,
          mode,
          priority: priority ?? null,
        },
      );

      // 3. Seed tiering_run_companies. INSERT...SELECT keeps the per-company
      //    list inside BQ; for 'unprocessed' we LEFT JOIN the tiers table and
      //    filter to rows that have never been tiered.
      const unprocessedFilter =
        scope === "unprocessed"
          ? `
            AND NOT EXISTS (
              SELECT 1 FROM ${TIERS} t
              WHERE t.tenant_id = mc.tenant_id
                AND t.company_id = mc.company_id
            )`
          : "";

      const seedResult = await bq().executeWrite(
        `INSERT INTO ${TIERING_RUN_COMPANIES}
           (id, tenant_id, tiering_run_id, company_id, status, attempts,
            started_at, finished_at, error_message, processing_log, created_at)
         SELECT
           GENERATE_UUID(), @tenant_id, @run_id, mc.company_id, 'pending', 0,
           NULL, NULL, NULL, NULL, CURRENT_TIMESTAMP()
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
        // Mark the run completed immediately so it doesn't show 'pending'
        // forever. Nothing to do.
        await bq().executeWrite(
          `UPDATE ${TIERING_RUNS}
              SET status = 'completed',
                  started_at = CURRENT_TIMESTAMP(),
                  finished_at = CURRENT_TIMESTAMP()
            WHERE tenant_id = @tenant_id AND id = @run_id`,
          { tenant_id: ctx.tenantId, run_id: runId },
        );
        return textResult(
          [
            `Tiering run created but no eligible companies were found.`,
            ``,
            `- **Run ID**: ${runId}`,
            `- **Mandate**: ${mandateId}`,
            `- **Scope**: ${scope}`,
            ``,
            scope === "unprocessed"
              ? "All companies in this mandate have already been tiered at least once. Pass scope='all' to re-tier."
              : "Add companies to mandate_companies first (e.g. via the Clay webhook).",
          ].join("\n"),
        );
      }

      // 4. Hand off to the scheduler. It flips the run to 'running' and
      //    publishes up to concurrencyCap initial Pub/Sub messages.
      let publishedCount = 0;
      try {
        publishedCount = await startRunImpl(
          "tiering",
          ctx.tenantId,
          runId,
          mode,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await bq().executeWrite(
          `UPDATE ${TIERING_RUNS}
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
          "tiering.start_run scheduler failure",
          err instanceof Error ? err : new Error(message),
        );
        return errorResult(
          `Run row created (${runId}) but scheduler failed to publish initial messages: ${message}`,
        );
      }

      logger.info("tiering.run.started", {
        tenantId: ctx.tenantId,
        runId,
        mandateId,
        seededRowCount,
        publishedCount,
      });

      return textResult(
        [
          `Tiering run started.`,
          ``,
          `- **Run ID**: ${runId}`,
          `- **Mandate**: ${mandateId}`,
          `- **Criteria version**: ${resolvedCriteriaId ?? "—"}`,
          `- **Mode**: ${mode}`,
          `- **Scope**: ${scope}`,
          `- **Companies enrolled**: ${seededRowCount}`,
          `- **Initial Pub/Sub messages published**: ${publishedCount}`,
          ``,
          `Poll status with togari_tiering_get_run({ runId: "${runId}" }).`,
        ].join("\n"),
      );
    });
  },
};

// ─── togari_tiering_get_run ─────────────────────────────────────────────────

const getRunInputShape = {
  runId: z.string().min(1).describe("Tiering run id."),
};
const getRunInputSchema = z.object(getRunInputShape);

const getRunTool: ToolModule = {
  name: "togari_tiering_get_run",
  description:
    "Fetch one tiering run: status, mandate id, mode, started_at/finished_at, per-company status breakdown, tier distribution (1-4), cost summary, and a rough ETA computed from elapsed time and remaining work. Returns markdown.",
  inputSchema: getRunInputShape,
  handler: async (args, ctx: ToolCallContext): Promise<ToolCallResult> => {
    const parsed = getRunInputSchema.safeParse(args ?? {});
    if (!parsed.success) {
      return errorResult(
        `Invalid input: ${JSON.stringify(parsed.error.flatten())}`,
      );
    }
    const { runId } = parsed.data;

    return traceCall("mcp.tiering.get_run", async () => {
      const runQuery = await bq().executeQuery(
        `SELECT id, mandate_id, criteria_version_id, status, mode, priority,
                total_cost_cents, started_at, finished_at, error_message,
                created_at
           FROM ${TIERING_RUNS}
          WHERE tenant_id = @tenant_id AND id = @run_id
          LIMIT 1`,
        { tenant_id: ctx.tenantId, run_id: runId },
      );
      const run = runQuery.rows[0];
      if (!run) {
        return errorResult(
          `Tiering run '${runId}' not found for tenant ${ctx.tenantId}.`,
        );
      }

      const statusQuery = await bq().executeQuery(
        `SELECT status, COUNT(*) AS n
           FROM ${TIERING_RUN_COMPANIES}
          WHERE tenant_id = @tenant_id AND tiering_run_id = @run_id
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

      const tierQuery = await bq().executeQuery(
        `SELECT tier, COUNT(*) AS n
           FROM ${TIERS}
          WHERE tenant_id = @tenant_id AND tiering_run_id = @run_id
          GROUP BY tier
          ORDER BY tier`,
        { tenant_id: ctx.tenantId, run_id: runId },
      );

      const costQuery = await bq().executeQuery(
        `SELECT service_type, SUM(total_cost_cents) AS cents
           FROM ${COST_LOGS}
          WHERE tenant_id = @tenant_id AND tiering_run_id = @run_id
          GROUP BY service_type
          ORDER BY cents DESC`,
        { tenant_id: ctx.tenantId, run_id: runId },
      );

      // Naive ETA: (remaining / completed-per-second) seconds.
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
        `# Tiering run ${runId}`,
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
        `## Tier distribution`,
        ``,
      ];

      if (tierQuery.rows.length === 0) {
        lines.push("_(no tier rows yet)_");
      } else {
        for (const r of tierQuery.rows) {
          lines.push(`- Tier ${r.tier}: ${Number(r.n ?? 0)}`);
        }
      }

      lines.push("", "## Cost by service");
      lines.push("");
      if (costQuery.rows.length === 0) {
        lines.push("_(no cost logs yet)_");
      } else {
        for (const r of costQuery.rows) {
          lines.push(`- ${String(r.service_type)}: ${formatCents(r.cents)}`);
        }
      }

      return textResult(
        lines.filter((x): x is string => x !== null).join("\n"),
      );
    });
  },
};

// ─── togari_tiering_list_runs ───────────────────────────────────────────────

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
  name: "togari_tiering_list_runs",
  description:
    "List tiering runs for the tenant, newest first. Optional filters on mandateId + status. Returns a markdown table.",
  inputSchema: listRunsInputShape,
  handler: async (args, ctx: ToolCallContext): Promise<ToolCallResult> => {
    const parsed = listRunsInputSchema.safeParse(args ?? {});
    if (!parsed.success) {
      return errorResult(
        `Invalid input: ${JSON.stringify(parsed.error.flatten())}`,
      );
    }
    const { mandateId, status, limit = 20 } = parsed.data;

    return traceCall("mcp.tiering.list_runs", async () => {
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
          FROM ${TIERING_RUNS}
         WHERE ${filters.join(" AND ")}
         ORDER BY created_at DESC
         LIMIT @limit
      `;
      const { rows } = await bq().executeQuery(sql, params);

      if (rows.length === 0) {
        return textResult(
          `No tiering runs found for tenant ${ctx.tenantId}${mandateId ? ` (mandate ${mandateId})` : ""}${status ? ` (status ${status})` : ""}.`,
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

export const TOGARI_TIERING_TOOLS: ToolModule[] = [
  startRunTool,
  getRunTool,
  listRunsTool,
];

export function registerTieringTools(server: McpServer): void {
  for (const mod of TOGARI_TIERING_TOOLS) {
    registerToolModule(server, mod);
  }
}

/** Alias matching the plan's `register(server)` convention. */
export const register = registerTieringTools;

// Re-exports for test access.
export { startRunTool, getRunTool, listRunsTool };
