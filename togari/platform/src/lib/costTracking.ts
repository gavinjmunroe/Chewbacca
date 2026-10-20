/**
 * Cost tracking for AI and external API calls.
 * Ported from autotier/apps/worker/src/lib/costTracking.ts; rewired for BigQuery
 * and Togari's tenant_id-aware schema.
 *
 * - `logAICost` / `logExternalAPICost` insert one row each into `cost_logs`.
 * - `updateRunCostSummary` runs a single MERGE that aggregates `cost_logs`
 *   by (service_type, company_id) and writes the rollup back to the run row.
 * - `getPricingConfig` reads `admin_settings.pricing_config` for the active
 *   tenant with a 5-minute in-process cache.
 *
 * tenantId, runId, and companyId are read from the active TraceContext when
 * the caller doesn't pass them explicitly — Pub/Sub job entrypoints set the
 * context once and helpers downstream don't need to thread it through.
 */

import crypto from "node:crypto";
import { BigQueryClient } from "../bigquery/client";
import { createLogger } from "../observability/logger";
import { currentTraceContext } from "./tracing";

const logger = createLogger("costTracking");

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";
const DATASET = process.env.BIGQUERY_DATASET || "togari_core";

const COST_LOGS = `\`${PROJECT_ID}.${DATASET}.cost_logs\``;
const ADMIN_SETTINGS = `\`${PROJECT_ID}.${DATASET}.admin_settings\``;
const TIERING_RUNS = `\`${PROJECT_ID}.${DATASET}.tiering_runs\``;
const ENRICHMENT_RUNS = `\`${PROJECT_ID}.${DATASET}.enrichment_runs\``;

let cachedBq: BigQueryClient | null = null;
function getBq(): BigQueryClient {
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

export interface PricingConfig {
  ai: Record<
    string,
    {
      input_per_1m: number; // cents per 1M input tokens
      output_per_1m: number; // cents per 1M output tokens
      web_search_per_call?: number;
    }
  >;
  external: Record<string, number>; // cents per call, keyed by `${service}_${operation}` or `${service}`
}

const DEFAULT_PRICING_CONFIG: PricingConfig = {
  ai: {
    "gpt-5-mini": {
      input_per_1m: 25,
      output_per_1m: 200,
      web_search_per_call: 1,
    },
    "gpt-5.4": { input_per_1m: 250, output_per_1m: 1500 },
    "gpt-5.4-nano": {
      input_per_1m: 20,
      output_per_1m: 125,
      web_search_per_call: 2.5,
    },
    "gpt-4o": { input_per_1m: 250, output_per_1m: 1000 },
    "gpt-4o-mini": { input_per_1m: 15, output_per_1m: 60 },
  },
  external: {
    google_places: 4,
    exa_search: 0,
    exa_contents: 0,
    crustdata_search: 0,
    crustdata_enrich: 0,
    perplexity_research: 5,
    grata_search: 0,
    grata_lookup: 0,
  },
};

interface CacheEntry {
  config: PricingConfig;
  expiresAt: number;
}
const pricingCache = new Map<string, CacheEntry>();
const PRICING_CACHE_TTL_MS = 5 * 60 * 1000;

function resolveTenantId(explicit?: string | null): string {
  if (explicit) return explicit;
  const ctx = currentTraceContext();
  return ctx?.tenantId ?? "bma";
}

export async function getPricingConfig(
  tenantId?: string,
): Promise<PricingConfig> {
  const tid = resolveTenantId(tenantId);
  const cached = pricingCache.get(tid);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.config;
  }

  try {
    const { rows } = await getBq().executeQuery(
      `SELECT value FROM ${ADMIN_SETTINGS}
        WHERE tenant_id = @tenant_id AND \`key\` = 'pricing_config'
        LIMIT 1`,
      { tenant_id: tid },
    );

    const raw = rows[0]?.value;
    if (raw) {
      const parsed =
        typeof raw === "string" ? JSON.parse(raw) : (raw as PricingConfig);
      if (
        parsed &&
        typeof parsed === "object" &&
        parsed.ai &&
        parsed.external
      ) {
        const merged: PricingConfig = {
          ai: { ...DEFAULT_PRICING_CONFIG.ai, ...parsed.ai },
          external: { ...DEFAULT_PRICING_CONFIG.external, ...parsed.external },
        };
        pricingCache.set(tid, {
          config: merged,
          expiresAt: Date.now() + PRICING_CACHE_TTL_MS,
        });
        return merged;
      }
    }
  } catch (error) {
    logger.warn("failed to fetch pricing config, using defaults", {
      tenantId: tid,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return DEFAULT_PRICING_CONFIG;
}

export function invalidatePricingCache(tenantId?: string): void {
  if (tenantId) {
    pricingCache.delete(tenantId);
  } else {
    pricingCache.clear();
  }
}

function normalizeModelName(model: string): string {
  return model.includes("/") ? model.split("/").pop() || model : model;
}

export async function calculateAICost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  hasWebSearch = false,
  tenantId?: string,
): Promise<number> {
  const pricing = await getPricingConfig(tenantId);
  const normalized = normalizeModelName(model);
  const modelPricing =
    pricing.ai[normalized] ??
    pricing.ai["gpt-5.4-nano"] ??
    DEFAULT_PRICING_CONFIG.ai["gpt-5.4-nano"]!;

  if (!pricing.ai[normalized]) {
    logger.warn(`unknown AI model "${normalized}", using gpt-5.4-nano pricing`);
  }

  const inputCost = (inputTokens / 1_000_000) * modelPricing.input_per_1m;
  const outputCost = (outputTokens / 1_000_000) * modelPricing.output_per_1m;
  let total = inputCost + outputCost;
  if (hasWebSearch && modelPricing.web_search_per_call) {
    total += modelPricing.web_search_per_call;
  }
  return Math.round(total);
}

interface LogAICostInput {
  tenantId?: string;
  tieringRunId?: string | null;
  enrichmentRunId?: string | null;
  companyId?: string | null;
  operation: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  hasWebSearch?: boolean;
  metadata?: Record<string, unknown>;
}

export async function logAICost(params: LogAICostInput): Promise<void> {
  const ctx = currentTraceContext();
  const tenantId = resolveTenantId(params.tenantId);
  const tieringRunId =
    params.tieringRunId ??
    (ctx?.pipeline === "tiering" ? (ctx.runId ?? null) : null);
  const enrichmentRunId =
    params.enrichmentRunId ??
    (ctx?.pipeline === "enrichment" ? (ctx.runId ?? null) : null);
  const companyId = params.companyId ?? ctx?.companyId ?? null;

  const totalCostCents = await calculateAICost(
    params.model,
    params.inputTokens,
    params.outputTokens,
    params.hasWebSearch ?? false,
    tenantId,
  );
  const normalized = normalizeModelName(params.model);

  const row = {
    id: crypto.randomUUID(),
    tenant_id: tenantId,
    tiering_run_id: tieringRunId,
    enrichment_run_id: enrichmentRunId,
    company_id: companyId,
    service_type: "ai",
    operation: params.operation,
    model: normalized,
    input_tokens: params.inputTokens,
    output_tokens: params.outputTokens,
    total_cost_cents: totalCostCents,
    metadata: {
      ...(params.metadata ?? {}),
      has_web_search: !!params.hasWebSearch,
    },
    created_at: new Date().toISOString(),
  };

  try {
    await getBq().getClient().dataset(DATASET).table("cost_logs").insert([row]);
    logger.debug(
      `AI cost logged: ${params.operation} ${normalized} = ${totalCostCents}¢`,
    );
  } catch (error) {
    logger.error("failed to log AI cost", error);
  }
}

interface LogExternalCostInput {
  tenantId?: string;
  tieringRunId?: string | null;
  enrichmentRunId?: string | null;
  companyId?: string | null;
  serviceType: string; // e.g. "exa", "crustdata", "perplexity", "grata", "google_places"
  operation: string; // e.g. "search", "enrich", "research", "lookup"
  metadata?: Record<string, unknown>;
  /** Override the pricing lookup; in cents. */
  costCentsOverride?: number;
}

function lookupExternalCost(
  pricing: PricingConfig,
  serviceType: string,
  operation: string,
): number {
  const composite = `${serviceType}_${operation}`;
  if (composite in pricing.external) return pricing.external[composite] ?? 0;
  if (serviceType in pricing.external)
    return pricing.external[serviceType] ?? 0;
  return 0;
}

export async function logExternalAPICost(
  params: LogExternalCostInput,
): Promise<void> {
  const ctx = currentTraceContext();
  const tenantId = resolveTenantId(params.tenantId);
  const tieringRunId =
    params.tieringRunId ??
    (ctx?.pipeline === "tiering" ? (ctx.runId ?? null) : null);
  const enrichmentRunId =
    params.enrichmentRunId ??
    (ctx?.pipeline === "enrichment" ? (ctx.runId ?? null) : null);
  const companyId = params.companyId ?? ctx?.companyId ?? null;

  let costCents = params.costCentsOverride;
  if (costCents == null) {
    const pricing = await getPricingConfig(tenantId);
    costCents = lookupExternalCost(
      pricing,
      params.serviceType,
      params.operation,
    );
  }

  const row = {
    id: crypto.randomUUID(),
    tenant_id: tenantId,
    tiering_run_id: tieringRunId,
    enrichment_run_id: enrichmentRunId,
    company_id: companyId,
    service_type: params.serviceType,
    operation: params.operation,
    model: null,
    input_tokens: null,
    output_tokens: null,
    total_cost_cents: costCents,
    metadata: params.metadata ?? {},
    created_at: new Date().toISOString(),
  };

  try {
    await getBq().getClient().dataset(DATASET).table("cost_logs").insert([row]);
    logger.debug(
      `${params.serviceType} cost logged: ${params.operation} = ${costCents}¢`,
    );
  } catch (error) {
    logger.error("failed to log external API cost", error);
  }
}

/**
 * Aggregate cost_logs for a single run and refresh the rollup on the runs table.
 *
 * Implemented as a single BQ statement so we don't pay for two separate scans of
 * the cost_logs partition. The aggregation produces:
 *   - total_cost_cents: sum across all rows for the run
 *   - cost_breakdown.byService:  { service_type → cents }
 *   - cost_breakdown.byCompany:  { company_id  → cents }
 */
export async function updateRunCostSummary(
  runType: "tiering" | "enrichment",
  runId: string,
  tenantId?: string,
): Promise<void> {
  const tid = resolveTenantId(tenantId);
  const runColumn =
    runType === "tiering" ? "tiering_run_id" : "enrichment_run_id";
  const target = runType === "tiering" ? TIERING_RUNS : ENRICHMENT_RUNS;

  const aggSql = `
    WITH agg AS (
      SELECT
        SUM(total_cost_cents) AS total_cents,
        TO_JSON(ARRAY_AGG(STRUCT(service_type, total_cost_cents))) AS svc_rows,
        TO_JSON(ARRAY_AGG(STRUCT(company_id, total_cost_cents))) AS co_rows
      FROM ${COST_LOGS}
      WHERE tenant_id = @tenant_id AND ${runColumn} = @run_id
    )
    SELECT total_cents, svc_rows, co_rows FROM agg
  `;

  try {
    const { rows } = await getBq().executeQuery(aggSql, {
      tenant_id: tid,
      run_id: runId,
    });
    const total = Number(rows[0]?.total_cents ?? 0) || 0;
    const svcRows =
      (rows[0]?.svc_rows as
        | Array<{ service_type: string; total_cost_cents: number | string }>
        | undefined) ?? [];
    const coRows =
      (rows[0]?.co_rows as
        | Array<{
            company_id: string | null;
            total_cost_cents: number | string;
          }>
        | undefined) ?? [];

    const byService: Record<string, number> = {};
    for (const r of svcRows) {
      const key = r.service_type ?? "unknown";
      byService[key] = (byService[key] ?? 0) + Number(r.total_cost_cents ?? 0);
    }
    const byCompany: Record<string, number> = {};
    for (const r of coRows) {
      if (!r.company_id) continue;
      byCompany[r.company_id] =
        (byCompany[r.company_id] ?? 0) + Number(r.total_cost_cents ?? 0);
    }

    const breakdown = JSON.stringify({ byService, byCompany });
    await getBq().executeWrite(
      `UPDATE ${target}
          SET total_cost_cents = @total,
              cost_breakdown = PARSE_JSON(@breakdown)
        WHERE tenant_id = @tenant_id AND id = @run_id`,
      { total, breakdown, tenant_id: tid, run_id: runId },
    );
    logger.info(`updated ${runType} run ${runId} cost: ${total}¢`);
  } catch (error) {
    logger.error(`failed to update ${runType} run cost summary`, error);
  }
}
