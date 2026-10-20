/**
 * Pipeline / CRM MCP tools for Togari.
 *
 * Lets BMA manage its deal pipeline conversationally through Perplexity
 * (or any MCP client): list and seed pipeline stages, move deals between
 * stages, log and read activities, and surface overdue follow-ups.
 *
 * All reads/writes are scoped to the caller's tenant via `client_id`
 * (the canonical tenancy key, default "bma") and run against the deployed
 * togari_data_lake tables:
 *   - togari_structured_deals  (deals)
 *   - pipeline_stages          (per-client stage config)
 *   - activities               (deal / contact activity log)
 *
 * Writes go through BigQueryClient.executeWrite (INSERT/UPDATE/MERGE only;
 * DELETE/DROP/ALTER are blocked). Every handler returns a markdown text
 * block per the Togari MCP output convention and validates its input with
 * zod safeParse.
 */

import crypto from "crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BigQueryClient } from "../../bigquery/client";
import { resolveDataset } from "../../services/dataset-resolver";
import {
  normalizeStage,
  VALID_STAGES as ALL_STAGES,
} from "../../core/config/stage-aliases";
import { createLogger } from "../../observability/logger";
import {
  registerToolModule,
  type ToolModule,
  type ToolCallContext,
} from "./registry";
import { markdownTable, asIso, clamp } from "./_shared";

const logger = createLogger("mcp/pipeline");

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";
const DEFAULT_CLIENT_ID = "bma";

/** Canonical deal stages, in default pipeline order. */
const CANONICAL_STAGES = [
  "lead",
  "qualified",
  "proposal_sent",
  "negotiation",
  "in_progress",
  "closed_won",
] as const;

/** Every valid stage a deal can occupy (superset of the seedable order). */
const VALID_STAGES = [
  "lead",
  "qualified",
  "proposal_sent",
  "negotiation",
  "in_progress",
  "closed_won",
  "closed_lost",
  "closed_engagement",
] as const;

const VALID_PIPELINES = [
  "inbound",
  "outbound",
  "partnership",
  "fundraising",
] as const;

function dealsTable(): string {
  return `\`${PROJECT_ID}.${resolveDataset()}.togari_structured_deals\``;
}
function stagesTable(): string {
  return `\`${PROJECT_ID}.${resolveDataset()}.pipeline_stages\``;
}
function activitiesTable(): string {
  return `\`${PROJECT_ID}.${resolveDataset()}.activities\``;
}

export interface PipelineDeps {
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

/** Resolve the tenant's client_id from tool context (defaults to "bma"). */
function clientIdOf(ctx: ToolCallContext): string {
  return ctx.tenantId || DEFAULT_CLIENT_ID;
}

function textResult(text: string, isError = false) {
  return {
    content: [{ type: "text" as const, text }],
    ...(isError ? { isError: true } : {}),
  };
}

function invalidArgs(message: string) {
  return textResult(`Invalid arguments: ${message}`, true);
}

// ── togari_pipeline_list_stages ─────────────────────────────────────

const listStagesShape = {
  pipeline: z
    .enum(VALID_PIPELINES)
    .optional()
    .describe(
      "Restrict to one pipeline (inbound/outbound/partnership/fundraising).",
    ),
};
const ListStagesInput = z.object(listStagesShape);

export function buildListStagesTool(deps: PipelineDeps = {}): ToolModule {
  return {
    name: "togari_pipeline_list_stages",
    description:
      "List the configured pipeline stages for the active tenant, in pipeline + stage order. Optional filter: pipeline. Returns a markdown table. If none are configured, says so (call togari_pipeline_seed_default_stages to populate).",
    inputSchema: listStagesShape,
    handler: async (args, ctx) => {
      const parsed = ListStagesInput.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);
      const bq = deps.bq ?? defaultBq();
      const clientId = clientIdOf(ctx);

      const params: Record<string, unknown> = { clientId };
      const where: string[] = ["client_id = @clientId"];
      if (parsed.data.pipeline) {
        where.push("pipeline = @pipeline");
        params.pipeline = parsed.data.pipeline;
      }

      const sql = `
        SELECT stage_id, stage_name, pipeline, stage_order, is_active
          FROM ${stagesTable()}
         WHERE ${where.join(" AND ")}
         ORDER BY pipeline, stage_order
      `.trim();

      const result = await bq.executeQuery(sql, params);
      if (result.rows.length === 0) {
        return textResult(
          `No stages configured for tenant ${clientId}${
            parsed.data.pipeline ? ` (pipeline: ${parsed.data.pipeline})` : ""
          }. Call togari_pipeline_seed_default_stages to populate them.`,
        );
      }

      const table = markdownTable(
        ["stage_id", "stage_name", "pipeline", "order", "active"],
        result.rows.map((r) => [
          r.stage_id as string,
          r.stage_name as string,
          r.pipeline as string,
          r.stage_order as number,
          String(r.is_active),
        ]),
      );

      const text = [
        `**Pipeline stages** (tenant: ${clientId})`,
        `Returned ${result.rows.length}.`,
        "",
        table,
      ].join("\n");
      return textResult(text);
    },
  };
}

// ── togari_pipeline_seed_default_stages ─────────────────────────────

const seedStagesShape = {
  pipeline: z
    .enum(VALID_PIPELINES)
    .describe("Pipeline to seed with the canonical six stages."),
};
const SeedStagesInput = z.object(seedStagesShape);

export function buildSeedDefaultStagesTool(
  deps: PipelineDeps = {},
): ToolModule {
  return {
    name: "togari_pipeline_seed_default_stages",
    description:
      "Seed the canonical stages (lead -> qualified -> proposal_sent -> negotiation -> in_progress -> closed_won, order 1..6) for a pipeline. Idempotent: if the tenant already has stages for that pipeline, it skips and reports.",
    inputSchema: seedStagesShape,
    handler: async (args, ctx) => {
      const parsed = SeedStagesInput.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);
      const bq = deps.bq ?? defaultBq();
      const clientId = clientIdOf(ctx);
      const pipeline = parsed.data.pipeline;

      const countSql = `
        SELECT COUNT(*) AS cnt
          FROM ${stagesTable()}
         WHERE client_id = @clientId AND pipeline = @pipeline
      `.trim();
      const countResult = await bq.executeQuery(countSql, {
        clientId,
        pipeline,
      });
      const existing = Number(
        (countResult.rows[0] as { cnt?: unknown } | undefined)?.cnt ?? 0,
      );

      if (existing > 0) {
        return textResult(
          `Pipeline "${pipeline}" already has ${existing} stage(s) for tenant ${clientId}. Skipped seeding.`,
        );
      }

      const valuesSql = CANONICAL_STAGES.map((_, i) => {
        const n = i + 1;
        return `(@stageId${n}, @clientId, @stageName${n}, @pipeline, ${n}, TRUE, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`;
      }).join(",\n        ");

      const params: Record<string, unknown> = { clientId, pipeline };
      CANONICAL_STAGES.forEach((name, i) => {
        const n = i + 1;
        params[`stageId${n}`] = crypto.randomUUID();
        params[`stageName${n}`] = name;
      });

      const insertSql = `
        INSERT INTO ${stagesTable()}
          (stage_id, client_id, stage_name, pipeline, stage_order, is_active, created_at, updated_at)
        VALUES
        ${valuesSql}
      `.trim();

      await bq.executeWrite(insertSql, params);

      logger.info("pipeline.stages.seeded", {
        clientId,
        pipeline,
        count: CANONICAL_STAGES.length,
      });

      const table = markdownTable(
        ["order", "stage_name"],
        CANONICAL_STAGES.map((name, i) => [i + 1, name]),
      );
      const text = [
        `Seeded ${CANONICAL_STAGES.length} stages for pipeline "${pipeline}" (tenant: ${clientId}).`,
        "",
        table,
      ].join("\n");
      return textResult(text);
    },
  };
}

// ── togari_pipeline_move_deal ───────────────────────────────────────

const moveDealShape = {
  deal_id: z.string().min(1).describe("Deal id to move."),
  to_stage: z
    .string()
    .min(1)
    .describe(
      `Target stage. Canonical or colloquial (e.g. "verbal yes" -> verbal_commit). Canonical set: ${ALL_STAGES.join(", ")}.`,
    ),
};
const MoveDealInput = z.object(moveDealShape);

export function buildMoveDealTool(deps: PipelineDeps = {}): ToolModule {
  return {
    name: "togari_pipeline_move_deal",
    description:
      "Move a deal to a new stage and log a 'stage_change' activity. Validates the target stage against the canonical set. Scoped to the active tenant. Returns confirmation.",
    inputSchema: moveDealShape,
    handler: async (args, ctx) => {
      const parsed = MoveDealInput.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);
      const bq = deps.bq ?? defaultBq();
      const clientId = clientIdOf(ctx);
      const { deal_id } = parsed.data;

      // Accept canonical or colloquial stage names, mapped to the one canonical
      // vocabulary that create_deal and the deals table use.
      const to_stage = normalizeStage(parsed.data.to_stage);
      if (!to_stage) {
        return invalidArgs(
          `Unknown stage "${parsed.data.to_stage}". Use one of: ${ALL_STAGES.join(", ")}.`,
        );
      }

      // Confirm the deal exists in scope BEFORE updating, so the result message
      // is truthful (numDmlAffectedRows is not reliably populated on the DML
      // job metadata and was producing false "no row updated" warnings).
      const found = await bq.executeQuery(
        `SELECT deal_id FROM ${dealsTable()}
          WHERE deal_id = @dealId
            AND (client_brand = @clientId OR client_id = @clientId)
          LIMIT 1`,
        { dealId: deal_id, clientId },
      );
      if (found.rows.length === 0) {
        return textResult(
          `No deal "${deal_id}" found for tenant ${clientId}. Nothing was moved.`,
          true,
        );
      }

      const updateSql = `
        UPDATE ${dealsTable()}
           SET stage = @stage, updated_at = CURRENT_TIMESTAMP()
         WHERE deal_id = @dealId
           AND (client_brand = @clientId OR client_id = @clientId)
      `.trim();
      await bq.executeWrite(updateSql, {
        stage: to_stage,
        dealId: deal_id,
        clientId,
      });

      const activityId = crypto.randomUUID();
      const activitySql = `
        INSERT INTO ${activitiesTable()}
          (activity_id, deal_id, client_id, type, content, timestamp)
        VALUES
          (@activityId, @dealId, @clientId, 'stage_change', @content, CURRENT_TIMESTAMP())
      `.trim();
      await bq.executeWrite(activitySql, {
        activityId,
        dealId: deal_id,
        clientId,
        content: `moved to ${to_stage}`,
      });

      logger.info("pipeline.deal.moved", {
        clientId,
        dealId: deal_id,
        toStage: to_stage,
      });

      return textResult(
        `Moved deal ${deal_id} to stage "${to_stage}" for tenant ${clientId} and logged a stage_change activity.`,
      );
    },
  };
}

// ── togari_activity_log ─────────────────────────────────────────────

const activityLogShape = {
  deal_id: z
    .string()
    .min(1)
    .optional()
    .describe("Deal this activity relates to."),
  contact_id: z
    .string()
    .min(1)
    .optional()
    .describe("Contact this activity relates to."),
  type: z
    .string()
    .min(1)
    .describe(
      "Activity type, e.g. 'note', 'call', 'email', 'meeting', 'stage_change'.",
    ),
  content: z.string().min(1).describe("Free-text activity content."),
};
const ActivityLogInput = z.object(activityLogShape);

export function buildActivityLogTool(deps: PipelineDeps = {}): ToolModule {
  return {
    name: "togari_activity_log",
    description:
      "Log an activity against a deal and/or contact for the active tenant. Provide a type (note/call/email/meeting/...) and content. Returns confirmation.",
    inputSchema: activityLogShape,
    handler: async (args, ctx) => {
      const parsed = ActivityLogInput.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);
      const bq = deps.bq ?? defaultBq();
      const clientId = clientIdOf(ctx);
      const { deal_id, contact_id, type, content } = parsed.data;

      const activityId = crypto.randomUUID();
      const sql = `
        INSERT INTO ${activitiesTable()}
          (activity_id, deal_id, client_id, contact_id, type, content, timestamp)
        VALUES
          (@activityId, @dealId, @clientId, @contactId, @type, @content, CURRENT_TIMESTAMP())
      `.trim();
      await bq.executeWrite(sql, {
        activityId,
        dealId: deal_id ?? null,
        clientId,
        contactId: contact_id ?? null,
        type,
        content,
      });

      logger.info("activity.logged", {
        clientId,
        dealId: deal_id,
        contactId: contact_id,
        type,
      });

      const target =
        deal_id && contact_id
          ? `deal ${deal_id} / contact ${contact_id}`
          : deal_id
            ? `deal ${deal_id}`
            : contact_id
              ? `contact ${contact_id}`
              : "tenant";
      return textResult(
        `Logged ${type} activity for ${target} (tenant: ${clientId}).`,
      );
    },
  };
}

// ── togari_activity_recent ──────────────────────────────────────────

const activityRecentShape = {
  deal_id: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Restrict to activities on this deal. Omit for all tenant activity.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Max rows to return (1-100, default 20)."),
};
const ActivityRecentInput = z.object(activityRecentShape);

export function buildActivityRecentTool(deps: PipelineDeps = {}): ToolModule {
  return {
    name: "togari_activity_recent",
    description:
      "List recent activities for the active tenant, newest first. Optional filter: deal_id. Returns a markdown table.",
    inputSchema: activityRecentShape,
    handler: async (args, ctx) => {
      const parsed = ActivityRecentInput.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);
      const bq = deps.bq ?? defaultBq();
      const clientId = clientIdOf(ctx);
      const limit = clamp(parsed.data.limit ?? 20, 1, 100);

      const params: Record<string, unknown> = { clientId, limit };
      const where: string[] = ["client_id = @clientId"];
      if (parsed.data.deal_id) {
        where.push("deal_id = @dealId");
        params.dealId = parsed.data.deal_id;
      }

      const sql = `
        SELECT activity_id, deal_id, contact_id, type, content, timestamp
          FROM ${activitiesTable()}
         WHERE ${where.join(" AND ")}
         ORDER BY timestamp DESC
         LIMIT @limit
      `.trim();

      const result = await bq.executeQuery(sql, params);
      if (result.rows.length === 0) {
        return textResult(
          `No activities found for tenant ${clientId}${
            parsed.data.deal_id ? ` (deal: ${parsed.data.deal_id})` : ""
          }.`,
        );
      }

      const table = markdownTable(
        ["timestamp", "type", "deal_id", "contact_id", "content"],
        result.rows.map((r) => [
          asIso(r.timestamp) ?? "—",
          r.type as string,
          (r.deal_id as string | null) ?? "—",
          (r.contact_id as string | null) ?? "—",
          r.content as string,
        ]),
      );

      const text = [
        `**Recent activity** (tenant: ${clientId})`,
        `Returned ${result.rows.length} of up to ${limit}.`,
        "",
        table,
      ].join("\n");
      return textResult(text);
    },
  };
}

// ── togari_pipeline_overdue ─────────────────────────────────────────

const overdueShape = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe("Max overdue deals to return (1-100, default 20)."),
};
const OverdueInput = z.object(overdueShape);

export function buildOverdueTool(deps: PipelineDeps = {}): ToolModule {
  return {
    name: "togari_pipeline_overdue",
    description:
      "Surface deals whose next_action_date is in the past and are not yet closed, oldest overdue first. A priority signal for follow-ups. Scoped to the active tenant. Returns a markdown table.",
    inputSchema: overdueShape,
    handler: async (args, ctx) => {
      const parsed = OverdueInput.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);
      const bq = deps.bq ?? defaultBq();
      const clientId = clientIdOf(ctx);
      const limit = clamp(parsed.data.limit ?? 20, 1, 100);

      // Catch two kinds of neglected deals:
      //   1. Truly overdue: a next_action_date in the past.
      //   2. Stale: an active deal with NO next_action_date that has not been
      //      touched in 30+ days (most deals lack a structured date, so a
      //      pure date filter would surface nothing and miss real neglect).
      // Client scope matches on client_brand (the org, e.g. 'bma') OR client_id
      // (a specific client), so an org-scoped operator sees all its deals.
      const sql = `
        SELECT deal_id, deal_name, company, stage, owner,
               next_action, next_action_date, value, updated_at
          FROM ${dealsTable()}
         WHERE (client_brand = @clientId OR client_id = @clientId)
           AND stage NOT LIKE 'closed%'
           AND (
             (next_action_date IS NOT NULL AND DATE(next_action_date) < CURRENT_DATE())
             OR (next_action_date IS NULL AND DATE(updated_at) < DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY))
           )
         ORDER BY next_action_date ASC NULLS LAST, updated_at ASC
         LIMIT @limit
      `.trim();

      const result = await bq.executeQuery(sql, { clientId, limit });
      if (result.rows.length === 0) {
        return textResult(
          `No overdue or stale follow-ups for tenant ${clientId}. Pipeline is current.`,
        );
      }

      const table = markdownTable(
        [
          "next_action_date",
          "deal_id",
          "deal_name",
          "company",
          "stage",
          "owner",
          "next_action",
        ],
        result.rows.map((r) => [
          asIso(r.next_action_date) ?? "—",
          r.deal_id as string,
          (r.deal_name as string | null) ?? "—",
          (r.company as string | null) ?? "—",
          r.stage as string,
          (r.owner as string | null) ?? "—",
          (r.next_action as string | null) ?? "—",
        ]),
      );

      const text = [
        `**Overdue follow-ups** (tenant: ${clientId})`,
        `${result.rows.length} deal(s) past their next_action_date.`,
        "",
        table,
      ].join("\n");
      return textResult(text);
    },
  };
}

// ── Registration ────────────────────────────────────────────────────

export function buildPipelineTools(deps: PipelineDeps = {}): ToolModule[] {
  return [
    buildListStagesTool(deps),
    buildSeedDefaultStagesTool(deps),
    buildMoveDealTool(deps),
    buildActivityLogTool(deps),
    buildActivityRecentTool(deps),
    buildOverdueTool(deps),
  ];
}

/**
 * Register all pipeline / CRM MCP tools on an `McpServer`. Called by the
 * MCP transport setup alongside the other tool-module registrants.
 */
export function registerPipelineTools(
  server: McpServer,
  deps: PipelineDeps = {},
): void {
  for (const mod of buildPipelineTools(deps)) {
    registerToolModule(server, mod);
  }
}

/** Alias matching the orchestrator's `import * as pipelineTools; pipelineTools.register(server)` pattern. */
export const register = registerPipelineTools;
