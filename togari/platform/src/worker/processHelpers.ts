/**
 * Cooperative cancellation + small read helpers for worker job entrypoints.
 *
 * Adapted from autotier/apps/worker/src/processors/processHelpers.ts. Where
 * autotier reads from Postgres via Supabase and reverts companies via UPDATE,
 * we read from BigQuery and update via MERGE statements. The semantics are
 * identical: a buffered Pub/Sub message must check the run's status before
 * executing any AI / API step, and on cancellation must release the company
 * back to `pending` so the scheduler picks it up later.
 */

import { BigQueryClient } from "../bigquery/client";
import type { Company, RunStatus } from "../bigquery/schema";
import { createLogger } from "../observability/logger";
import { GATEWAY_OUTAGE_RETRY_OPTIONS, withRetry } from "../lib/retry";

const logger = createLogger("worker/processHelpers");

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";
const DATASET = process.env.BIGQUERY_DATASET || "togari_core";

const COMPANIES = `\`${PROJECT_ID}.${DATASET}.companies\``;
const DATAPOINTS = `\`${PROJECT_ID}.${DATASET}.datapoints\``;
const TIERING_RUNS = `\`${PROJECT_ID}.${DATASET}.tiering_runs\``;
const ENRICHMENT_RUNS = `\`${PROJECT_ID}.${DATASET}.enrichment_runs\``;
const TIERING_RUN_COMPANIES = `\`${PROJECT_ID}.${DATASET}.tiering_run_companies\``;
const ENRICHMENT_RUN_COMPANIES = `\`${PROJECT_ID}.${DATASET}.enrichment_run_companies\``;

export const SKIPPED_RETURN_VALUE = "SKIPPED_RUN_NOT_ACTIVE" as const;

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

export type RunKind = "tiering" | "enrichment";

/**
 * Return the run's current status, or `null` if the run doesn't exist (which
 * is treated as "not active" — the caller should ack and skip).
 */
export async function getRunStatus(
  kind: RunKind,
  tenantId: string,
  runId: string,
): Promise<RunStatus | null> {
  const table = kind === "tiering" ? TIERING_RUNS : ENRICHMENT_RUNS;
  const { rows } = await bq().executeQuery(
    `SELECT status FROM ${table}
      WHERE tenant_id = @tenant_id AND id = @run_id
      LIMIT 1`,
    { tenant_id: tenantId, run_id: runId },
  );
  const raw = rows[0]?.status;
  return (raw as RunStatus | undefined) ?? null;
}

/**
 * Cooperative cancellation check. True iff the run is `running`.
 *
 * Treat anything else (`pending`, `queued`, `completed`, `failed`, `paused`,
 * `stopped`, or missing) as "do not process".
 */
export async function isRunActive(
  kind: RunKind,
  tenantId: string,
  runId: string,
): Promise<boolean> {
  const status = await getRunStatus(kind, tenantId, runId);
  return status === "running";
}

/**
 * Release a company back to `pending` so the next scheduler poll can re-emit it.
 * Used when a buffered Pub/Sub message fires after the run was paused/stopped.
 */
export async function revertCompanyToPending(
  kind: RunKind,
  tenantId: string,
  runId: string,
  companyId: string,
): Promise<void> {
  const target =
    kind === "tiering" ? TIERING_RUN_COMPANIES : ENRICHMENT_RUN_COMPANIES;
  const runCol = kind === "tiering" ? "tiering_run_id" : "enrichment_run_id";
  try {
    await bq().executeWrite(
      `UPDATE ${target}
          SET status = 'pending',
              started_at = NULL,
              error_message = NULL
        WHERE tenant_id = @tenant_id
          AND ${runCol} = @run_id
          AND company_id = @company_id`,
      { tenant_id: tenantId, run_id: runId, company_id: companyId },
    );
  } catch (err) {
    logger.error(
      `revertCompanyToPending failed ${kind} run=${runId} company=${companyId}`,
      err,
    );
  }
}

/**
 * Update the per-company status row on a run. Used at the start (`running`)
 * and end (`completed` / `failed`) of each job's work.
 */
export async function setRunCompanyStatus(
  kind: RunKind,
  tenantId: string,
  runId: string,
  companyId: string,
  status: "running" | "completed" | "failed",
  errorMessage?: string,
): Promise<void> {
  const target =
    kind === "tiering" ? TIERING_RUN_COMPANIES : ENRICHMENT_RUN_COMPANIES;
  const runCol = kind === "tiering" ? "tiering_run_id" : "enrichment_run_id";
  const isStart = status === "running";
  const isFinish = status === "completed" || status === "failed";
  await bq().executeWrite(
    `UPDATE ${target}
        SET status = @status,
            started_at = COALESCE(started_at, ${isStart ? "CURRENT_TIMESTAMP()" : "started_at"}),
            finished_at = ${isFinish ? "CURRENT_TIMESTAMP()" : "finished_at"},
            error_message = @error_message
      WHERE tenant_id = @tenant_id
        AND ${runCol} = @run_id
        AND company_id = @company_id`,
    {
      tenant_id: tenantId,
      run_id: runId,
      company_id: companyId,
      status,
      error_message: errorMessage ?? null,
    },
  );
}

/**
 * Resolve a company row + its `datapoints` into a flat key-value bag for
 * downstream prompts. Mirrors autotier's `getCompanyInfo` but reads from BQ.
 */
export async function getCompanyInfo(
  tenantId: string,
  companyId: string,
): Promise<
  | ({ name: string; website: string; address: string } & Record<
      string,
      string
    >)
  | null
> {
  try {
    const company = await getCompanyById(tenantId, companyId);
    const result: { name: string; website: string; address: string } & Record<
      string,
      string
    > = {
      name: company.name,
      website: company.website ?? "",
      address: company.address ?? "",
    };

    const { rows } = await bq().executeQuery(
      `SELECT \`key\`, value FROM ${DATAPOINTS}
        WHERE tenant_id = @tenant_id AND company_id = @company_id
        ORDER BY created_at ASC`,
      { tenant_id: tenantId, company_id: companyId },
    );

    for (const row of rows) {
      const key = (row.key as string | undefined) ?? "";
      const value = (row.value as string | undefined) ?? "";
      if (key) result[key] = value;
    }
    return result;
  } catch (err) {
    logger.error(`failed to get company info for ${companyId}`, err);
    return null;
  }
}

async function getCompanyById(
  tenantId: string,
  companyId: string,
): Promise<Company> {
  return withRetry(
    async () => {
      const { rows } = await bq().executeQuery(
        `SELECT id, tenant_id, name, website, address, dc_id, source_original, created_at, updated_at
           FROM ${COMPANIES}
          WHERE tenant_id = @tenant_id AND id = @company_id
          LIMIT 1`,
        { tenant_id: tenantId, company_id: companyId },
      );
      const row = rows[0];
      if (!row) {
        throw new Error(`company ${companyId} not found in tenant ${tenantId}`);
      }
      return row as unknown as Company;
    },
    {
      operationName: `getCompanyById(${companyId})`,
      ...GATEWAY_OUTAGE_RETRY_OPTIONS,
    },
  );
}
