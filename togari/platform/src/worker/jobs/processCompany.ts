/**
 * Tiering job — one company per Pub/Sub message.
 *
 * Lifecycle per message:
 *   1. Decode + validate the message payload.
 *   2. Check the run is still `running` (cooperative cancellation).
 *   3. Flip the `tiering_run_companies` row to `running`.
 *   4. Perform the tiering work (placeholder: writes a stub Tier row).
 *   5. Flip the row to `completed` / `failed` and refresh the run's cost
 *      summary + scheduler slot.
 *
 * The actual scoring pipeline (LLM-driven relevance + criteria match) lives
 * inside the worker harness but will be wired in a follow-up PR — for v1 we
 * provide the cradle and the BQ writes so Tab 6's dashboard and the orchestrator
 * smoke test can run end-to-end against fixture data.
 */

import crypto from "node:crypto";
import { BigQueryClient } from "../../bigquery/client";
import { logAICost, updateRunCostSummary } from "../../lib/costTracking";
import { traceCall, withTraceContext } from "../../lib/tracing";
import { createLogger } from "../../observability/logger";
import {
  getCompanyInfo,
  isRunActive,
  revertCompanyToPending,
  setRunCompanyStatus,
  SKIPPED_RETURN_VALUE,
} from "../processHelpers";
import { onCompanyFinished } from "../scheduler";
import type { TieringCompanyMessage } from "../topics";

const logger = createLogger("worker/jobs/tiering");

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";
const DATASET = process.env.BIGQUERY_DATASET || "togari_core";
const TIERS = `${PROJECT_ID}.${DATASET}.tiers`;

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

export type JobResult =
  | { status: "completed"; tier: number; confidence: number }
  | { status: "failed"; error: string }
  | typeof SKIPPED_RETURN_VALUE;

export async function processCompany(
  msg: TieringCompanyMessage,
): Promise<JobResult> {
  const { tenantId, runId, companyId } = msg;

  return withTraceContext(
    { tenantId, runId, companyId, pipeline: "tiering" },
    async () => {
      if (!(await isRunActive("tiering", tenantId, runId))) {
        logger.info(
          `skipping tiering — run not active: tenant=${tenantId} run=${runId} company=${companyId}`,
        );
        await revertCompanyToPending("tiering", tenantId, runId, companyId);
        return SKIPPED_RETURN_VALUE;
      }

      await setRunCompanyStatus(
        "tiering",
        tenantId,
        runId,
        companyId,
        "running",
      );

      try {
        const result = await traceCall(
          "tiering.processCompany",
          () => tierCompany(tenantId, runId, companyId),
          { op: "togari.tiering" },
        );

        await setRunCompanyStatus(
          "tiering",
          tenantId,
          runId,
          companyId,
          "completed",
        );
        await updateRunCostSummary("tiering", runId, tenantId);
        await onCompanyFinished("tiering", tenantId, runId);
        return result;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        logger.error(`tiering failed company=${companyId}`, err);
        await setRunCompanyStatus(
          "tiering",
          tenantId,
          runId,
          companyId,
          "failed",
          error,
        );
        await onCompanyFinished("tiering", tenantId, runId);
        return { status: "failed", error };
      }
    },
  );
}

/**
 * Placeholder tiering scorer.
 *
 * Reads the company + its datapoints, charges a small AI cost so the cost
 * pipeline is observable end-to-end, and writes a synthetic Tier row.
 * Replaced in a follow-up PR with the real LLM scoring loop (relevance +
 * criteria match modeled after autotier's startTieringProcess).
 */
async function tierCompany(
  tenantId: string,
  runId: string,
  companyId: string,
): Promise<{ status: "completed"; tier: number; confidence: number }> {
  const company = await getCompanyInfo(tenantId, companyId);
  const tier = company ? assignStubTier(company.name) : 3;
  const confidence = company ? 0.5 : 0.0;

  await logAICost({
    tieringRunId: runId,
    companyId,
    operation: "tier_score_stub",
    model: "openai/gpt-5.4-nano",
    inputTokens: 0,
    outputTokens: 0,
  });

  await bq()
    .getClient()
    .dataset(DATASET)
    .table("tiers")
    .insert([
      {
        tiering_run_id: runId,
        company_id: companyId,
        tenant_id: tenantId,
        tier,
        confidence_score: confidence,
        rationale: company
          ? `Stub scorer: tier ${tier} assigned to ${company.name}`
          : "Stub scorer: company not found",
        structured_rationale: {
          version: "stub-v1",
          scored_at: new Date().toISOString(),
        },
        created_at: new Date().toISOString(),
      },
    ]);

  // Touch the TIERS qualified name so the build emits a reference. The full
  // scoring pipeline will use parameterised MERGE statements against it.
  void TIERS;

  return { status: "completed", tier, confidence };
}

function assignStubTier(name: string): number {
  // Deterministic tiering for fixture data so tests are repeatable.
  const hash = crypto.createHash("sha256").update(name).digest()[0] ?? 0;
  const bucket = hash % 4;
  return Math.max(1, bucket + 1);
}
