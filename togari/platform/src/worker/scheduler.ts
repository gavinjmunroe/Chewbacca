/**
 * Pub/Sub-driven scheduler for tiering + enrichment runs.
 *
 * Adapted from autotier/apps/worker/src/lib/scheduler.ts. Where autotier
 * uses a 1-second BullMQ polling loop, we react to two events:
 *
 *   1. A run transitions to `running` → publish up to `concurrencyCap` initial
 *      company messages.
 *   2. A subscriber acks a message after a company finishes → publish the next
 *      pending company message for that run.
 *
 * Status transitions land in BigQuery via MERGE statements (single scan,
 * no per-row UPDATEs). The scheduler never holds long-running connections,
 * so it's safe to invoke from Cloud Run request handlers and from
 * subscriber callbacks alike.
 */

import { PubSub } from "@google-cloud/pubsub";
import { BigQueryClient } from "../bigquery/client";
import { createLogger } from "../observability/logger";
import {
  SUB_ENRICHMENT_WORKER,
  SUB_TIERING_WORKER,
  TOPIC_ENRICHMENT_COMPANY,
  TOPIC_TIERING_COMPANY,
  type EnrichmentCompanyMessage,
  type TieringCompanyMessage,
} from "./topics";

const logger = createLogger("worker/scheduler");

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";
const DATASET = process.env.BIGQUERY_DATASET || "togari_core";

const TIERING_RUNS = `\`${PROJECT_ID}.${DATASET}.tiering_runs\``;
const ENRICHMENT_RUNS = `\`${PROJECT_ID}.${DATASET}.enrichment_runs\``;
const TIERING_RUN_COMPANIES = `\`${PROJECT_ID}.${DATASET}.tiering_run_companies\``;
const ENRICHMENT_RUN_COMPANIES = `\`${PROJECT_ID}.${DATASET}.enrichment_run_companies\``;
const ADMIN_SETTINGS = `\`${PROJECT_ID}.${DATASET}.admin_settings\``;

const DEFAULT_CONCURRENCY = Number(
  process.env.TOGARI_DEFAULT_CONCURRENCY ?? 10,
);

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

let cachedPubSub: PubSub | null = null;
function pubsub(): PubSub {
  if (!cachedPubSub) {
    cachedPubSub = new PubSub({ projectId: PROJECT_ID });
  }
  return cachedPubSub;
}

export type RunKind = "tiering" | "enrichment";

interface PendingCompany {
  companyId: string;
}

async function getConcurrencyCap(tenantId: string): Promise<number> {
  try {
    const { rows } = await bq().executeQuery(
      `SELECT value FROM ${ADMIN_SETTINGS}
        WHERE tenant_id = @tenant_id AND \`key\` = 'worker_concurrency'
        LIMIT 1`,
      { tenant_id: tenantId },
    );
    const raw = rows[0]?.value;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (typeof parsed === "number" && parsed > 0) return Math.min(parsed, 100);
  } catch (err) {
    logger.debug("worker_concurrency lookup failed, using default", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return DEFAULT_CONCURRENCY;
}

async function countInFlight(
  kind: RunKind,
  tenantId: string,
  runId: string,
): Promise<number> {
  const target =
    kind === "tiering" ? TIERING_RUN_COMPANIES : ENRICHMENT_RUN_COMPANIES;
  const runCol = kind === "tiering" ? "tiering_run_id" : "enrichment_run_id";
  const { rows } = await bq().executeQuery(
    `SELECT COUNT(*) AS n FROM ${target}
      WHERE tenant_id = @tenant_id
        AND ${runCol} = @run_id
        AND status IN ('queued', 'running')`,
    { tenant_id: tenantId, run_id: runId },
  );
  return Number(rows[0]?.n ?? 0) || 0;
}

async function claimPendingCompanies(
  kind: RunKind,
  tenantId: string,
  runId: string,
  limit: number,
): Promise<PendingCompany[]> {
  if (limit <= 0) return [];
  const target =
    kind === "tiering" ? TIERING_RUN_COMPANIES : ENRICHMENT_RUN_COMPANIES;
  const runCol = kind === "tiering" ? "tiering_run_id" : "enrichment_run_id";

  // Read candidates, then MERGE them to `queued` atomically.
  // BQ doesn't have SELECT FOR UPDATE — we rely on `status = 'pending'` in the
  // MERGE predicate. A double-publish under racy MERGEs is harmless: the
  // subscriber's isRunActive + setRunCompanyStatus path is idempotent.
  const { rows } = await bq().executeQuery(
    `SELECT company_id FROM ${target}
      WHERE tenant_id = @tenant_id
        AND ${runCol} = @run_id
        AND status = 'pending'
      ORDER BY created_at ASC
      LIMIT @limit`,
    { tenant_id: tenantId, run_id: runId, limit },
  );
  const claimed = rows.map((r) => ({ companyId: String(r.company_id) }));
  if (claimed.length === 0) return [];

  const idsSql = claimed.map((_, i) => `@id_${i}`).join(", ");
  const params: Record<string, unknown> = {
    tenant_id: tenantId,
    run_id: runId,
  };
  claimed.forEach((c, i) => {
    params[`id_${i}`] = c.companyId;
  });

  await bq().executeWrite(
    `UPDATE ${target}
        SET status = 'queued'
      WHERE tenant_id = @tenant_id
        AND ${runCol} = @run_id
        AND company_id IN (${idsSql})
        AND status = 'pending'`,
    params,
  );
  return claimed;
}

async function publishTieringCompany(
  msg: TieringCompanyMessage,
): Promise<void> {
  await pubsub()
    .topic(TOPIC_TIERING_COMPANY)
    .publishMessage({
      data: Buffer.from(JSON.stringify(msg)),
      attributes: {
        tenant_id: msg.tenantId,
        run_id: msg.runId,
        company_id: msg.companyId,
      },
    });
}

async function publishEnrichmentCompany(
  msg: EnrichmentCompanyMessage,
): Promise<void> {
  await pubsub()
    .topic(TOPIC_ENRICHMENT_COMPANY)
    .publishMessage({
      data: Buffer.from(JSON.stringify(msg)),
      attributes: {
        tenant_id: msg.tenantId,
        run_id: msg.runId,
        company_id: msg.companyId,
        mode: msg.mode,
      },
    });
}

/**
 * Publish up to `slots` company messages for an already-`running` run.
 * Returns the number actually published.
 */
export async function fillRunSlots(
  kind: RunKind,
  tenantId: string,
  runId: string,
  mode: "sequential" | "agent" = "sequential",
): Promise<number> {
  const cap = await getConcurrencyCap(tenantId);
  const inflight = await countInFlight(kind, tenantId, runId);
  const slots = cap - inflight;
  if (slots <= 0) return 0;

  const companies = await claimPendingCompanies(kind, tenantId, runId, slots);
  for (const { companyId } of companies) {
    if (kind === "tiering") {
      await publishTieringCompany({
        v: 1,
        tenantId,
        runId,
        companyId,
      });
    } else {
      await publishEnrichmentCompany({
        v: 1,
        tenantId,
        runId,
        companyId,
        mode,
      });
    }
  }
  return companies.length;
}

/**
 * Mark a run as `running` and publish the initial batch of company messages.
 * Idempotent: if the run is already `running` we just top off the slots.
 */
export async function startRun(
  kind: RunKind,
  tenantId: string,
  runId: string,
  mode: "sequential" | "agent" = "sequential",
): Promise<number> {
  const target = kind === "tiering" ? TIERING_RUNS : ENRICHMENT_RUNS;
  await bq().executeWrite(
    `UPDATE ${target}
        SET status = 'running',
            started_at = COALESCE(started_at, CURRENT_TIMESTAMP()),
            error_message = NULL
      WHERE tenant_id = @tenant_id
        AND id = @run_id
        AND status IN ('pending', 'queued', 'paused')`,
    { tenant_id: tenantId, run_id: runId },
  );
  return fillRunSlots(kind, tenantId, runId, mode);
}

/**
 * Called by the subscriber after a company finishes. Tops off any freed slot
 * and, if no companies remain, transitions the run to `completed`.
 */
export async function onCompanyFinished(
  kind: RunKind,
  tenantId: string,
  runId: string,
  mode: "sequential" | "agent" = "sequential",
): Promise<void> {
  const pending = await pendingPlusInflight(kind, tenantId, runId);
  if (pending === 0) {
    await finalizeRun(kind, tenantId, runId);
    return;
  }
  await fillRunSlots(kind, tenantId, runId, mode);
}

async function pendingPlusInflight(
  kind: RunKind,
  tenantId: string,
  runId: string,
): Promise<number> {
  const target =
    kind === "tiering" ? TIERING_RUN_COMPANIES : ENRICHMENT_RUN_COMPANIES;
  const runCol = kind === "tiering" ? "tiering_run_id" : "enrichment_run_id";
  const { rows } = await bq().executeQuery(
    `SELECT COUNT(*) AS n FROM ${target}
      WHERE tenant_id = @tenant_id
        AND ${runCol} = @run_id
        AND status IN ('pending', 'queued', 'running')`,
    { tenant_id: tenantId, run_id: runId },
  );
  return Number(rows[0]?.n ?? 0) || 0;
}

async function finalizeRun(
  kind: RunKind,
  tenantId: string,
  runId: string,
): Promise<void> {
  const target = kind === "tiering" ? TIERING_RUNS : ENRICHMENT_RUNS;
  const runCompanies =
    kind === "tiering" ? TIERING_RUN_COMPANIES : ENRICHMENT_RUN_COMPANIES;
  const runCol = kind === "tiering" ? "tiering_run_id" : "enrichment_run_id";

  // Look for any failed company; if found, the run is considered `failed`.
  const { rows } = await bq().executeQuery(
    `SELECT COUNTIF(status = 'failed') AS failed_count,
            COUNTIF(status = 'completed') AS completed_count
       FROM ${runCompanies}
      WHERE tenant_id = @tenant_id AND ${runCol} = @run_id`,
    { tenant_id: tenantId, run_id: runId },
  );
  const failedCount = Number(rows[0]?.failed_count ?? 0) || 0;
  const finalStatus = failedCount > 0 ? "failed" : "completed";

  await bq().executeWrite(
    `UPDATE ${target}
        SET status = @status,
            finished_at = CURRENT_TIMESTAMP()
      WHERE tenant_id = @tenant_id
        AND id = @run_id`,
    { tenant_id: tenantId, run_id: runId, status: finalStatus },
  );
  logger.info(`run ${runId} finalised → ${finalStatus}`);
}

/** Used by HTTP control endpoints to pause/stop a run. */
export async function setRunStatus(
  kind: RunKind,
  tenantId: string,
  runId: string,
  status: "paused" | "stopped" | "running",
): Promise<void> {
  const target = kind === "tiering" ? TIERING_RUNS : ENRICHMENT_RUNS;
  await bq().executeWrite(
    `UPDATE ${target}
        SET status = @status
      WHERE tenant_id = @tenant_id AND id = @run_id`,
    { tenant_id: tenantId, run_id: runId, status },
  );
}

export const SCHEDULER_SUBSCRIPTIONS = {
  tiering: SUB_TIERING_WORKER,
  enrichment: SUB_ENRICHMENT_WORKER,
} as const;
