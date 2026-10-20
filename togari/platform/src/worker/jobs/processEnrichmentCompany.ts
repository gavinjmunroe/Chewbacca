/**
 * Enrichment job — one company per Pub/Sub message.
 *
 * Lifecycle per message:
 *   1. Decode + validate the message payload.
 *   2. Cooperative cancellation against the parent enrichment run.
 *   3. Flip `enrichment_run_companies` to `running`.
 *   4. Look up the company + datapoints from BQ.
 *   5. Invoke `runEnrichmentAgent`. The agent surfaces contacts into the
 *      in-memory accumulator; we persist them to `contacts` in batch on
 *      success.
 *   6. Flip the row to `completed` / `failed`, refresh cost summary,
 *      and signal the scheduler so the next company can be published.
 */

import crypto from "node:crypto";
import { BigQueryClient } from "../../bigquery/client";
import { runEnrichmentAgent } from "../../agents/enrichment/agentConfig";
import { updateRunCostSummary } from "../../lib/costTracking";
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
import type { EnrichmentCompanyMessage } from "../topics";

const logger = createLogger("worker/jobs/enrichment");

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";
const DATASET = process.env.BIGQUERY_DATASET || "togari_core";

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

export type EnrichmentJobResult =
  | {
      status: "completed";
      stepCount: number;
      contactCount: number;
      sources: string[];
    }
  | { status: "failed"; error: string }
  | typeof SKIPPED_RETURN_VALUE;

export async function processEnrichmentCompany(
  msg: EnrichmentCompanyMessage,
): Promise<EnrichmentJobResult> {
  const { tenantId, runId, companyId, mode } = msg;

  return withTraceContext(
    { tenantId, runId, companyId, pipeline: "enrichment" },
    async () => {
      if (!(await isRunActive("enrichment", tenantId, runId))) {
        logger.info(
          `skipping enrichment — run not active: tenant=${tenantId} run=${runId} company=${companyId}`,
        );
        await revertCompanyToPending("enrichment", tenantId, runId, companyId);
        return SKIPPED_RETURN_VALUE;
      }

      await setRunCompanyStatus(
        "enrichment",
        tenantId,
        runId,
        companyId,
        "running",
      );

      try {
        const company = await getCompanyInfo(tenantId, companyId);
        if (!company) {
          throw new Error(`company ${companyId} not found`);
        }
        const { name, website, address, ...datapoints } = company;

        const result = await traceCall(
          "enrichment.runAgent",
          () =>
            runEnrichmentAgent({
              tenantId,
              enrichmentRunId: runId,
              companyId,
              companyName: name,
              companyWebsite: website || null,
              companyAddress: address || null,
              companyDatapoints: datapoints,
            }),
          { op: "togari.enrichment", attributes: { mode } },
        );

        if (!result.success) {
          throw new Error(result.error ?? "agent reported failure");
        }

        const persistedCount = await persistAccumulatedContacts(
          tenantId,
          runId,
          companyId,
          result.contacts,
        );

        await setRunCompanyStatus(
          "enrichment",
          tenantId,
          runId,
          companyId,
          "completed",
        );
        await updateRunCostSummary("enrichment", runId, tenantId);
        await onCompanyFinished("enrichment", tenantId, runId, mode);

        return {
          status: "completed",
          stepCount: result.stepCount,
          contactCount: persistedCount,
          sources: result.confidence.sourcesUsed,
        };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        logger.error(`enrichment failed company=${companyId}`, err);
        await setRunCompanyStatus(
          "enrichment",
          tenantId,
          runId,
          companyId,
          "failed",
          error,
        );
        await onCompanyFinished("enrichment", tenantId, runId, mode);
        return { status: "failed", error };
      }
    },
  );
}

async function persistAccumulatedContacts(
  tenantId: string,
  enrichmentRunId: string,
  companyId: string,
  contacts: Array<{
    contact: {
      name?: string | null;
      title?: string | null;
      email?: string | null;
      phone?: string | null;
    };
    source: string;
  }>,
): Promise<number> {
  if (contacts.length === 0) return 0;

  const now = new Date().toISOString();
  const rows = contacts.map((entry) => ({
    id: crypto.randomUUID(),
    tenant_id: tenantId,
    company_id: companyId,
    enrichment_run_id: enrichmentRunId,
    source: entry.source,
    full_name: entry.contact.name ?? null,
    first_name: null,
    last_name: null,
    title: entry.contact.title ?? null,
    email: entry.contact.email ?? null,
    email_verified: false,
    mobile_phone: null,
    business_phone: entry.contact.phone ?? null,
    linkedin_url: null,
    dc_contact_id: null,
    contact_info: entry.contact,
    is_primary: false,
    primary_score: null,
    primary_reason: null,
    created_at: now,
    updated_at: now,
  }));

  await bq().getClient().dataset(DATASET).table("contacts").insert(rows);
  return rows.length;
}
