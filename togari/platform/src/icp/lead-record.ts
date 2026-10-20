/**
 * Website lead persistence — idempotent MERGE into the CRM contacts table.
 *
 * Deliberately NOT routed through clay-lead.ts: that endpoint's raw INSERT
 * duplicates rows on resubmission, and its Rytual audience fan-out feeds
 * downstream outreach — which is explicitly out of scope for website leads
 * (the funnel's list email is its only automated send).
 */

import crypto from "crypto";
import { BigQueryClient } from "../bigquery/client";
import { resolveDataset } from "../services/dataset-resolver";
import { createLogger } from "../observability/logger";
import type { AffiliationResult } from "../agents/scoring/affiliationScoring";
import type { ListContact } from "./list";

const logger = createLogger("icp/lead-record");

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";
const DEFAULT_CLIENT_ID = "bma";

export type WebsiteSourceTag =
  | "website-icp-list"
  | "website-contact"
  | "website-icp-sourced";

function contactsTable(): string {
  return `\`${PROJECT_ID}.${resolveDataset()}.togari_structured_contacts\``;
}

function moduleBq(): BigQueryClient {
  return new BigQueryClient(
    PROJECT_ID,
    null,
    process.env.GCP_CREDENTIALS_BASE64 ||
      process.env.GOOGLE_CREDENTIALS_BASE64 ||
      null,
  );
}

export async function upsertWebsiteLead(params: {
  email: string;
  full_name?: string | null;
  company?: string | null;
  company_domain?: string | null;
  source_tag: WebsiteSourceTag;
  lead_score?: number | null;
  lead_score_detail?: AffiliationResult | Record<string, unknown> | null;
}): Promise<{ status: "upserted" | "failed"; row_id: string; error?: string }> {
  const bq = moduleBq();
  const email = params.email.trim().toLowerCase();
  const rowId = crypto
    .createHash("sha256")
    .update(`${DEFAULT_CLIENT_ID}:${email}`)
    .digest("hex");

  // The live contacts table is snake_case (work_email, full_name, ...).
  // source_tag / lead_score / lead_score_detail are added by
  // sql/icp_create_tables.sql.
  const sql = `
    MERGE ${contactsTable()} T
    USING (SELECT @rowId AS row_id) S
    ON T.row_id = S.row_id
    WHEN MATCHED THEN UPDATE SET
      work_email = @email,
      full_name = COALESCE(@fullName, T.full_name),
      current_company = COALESCE(@company, T.current_company),
      current_company_domain = COALESCE(@companyDomain, T.current_company_domain),
      updated_at = CURRENT_TIMESTAMP(),
      source_tag = @sourceTag,
      lead_score = COALESCE(@leadScore, T.lead_score),
      lead_score_detail = IF(@leadScoreDetail IS NULL, T.lead_score_detail, PARSE_JSON(@leadScoreDetail))
    WHEN NOT MATCHED THEN INSERT
      (row_id, work_email, full_name, current_company, current_company_domain,
       created_at, updated_at, source_tag, lead_score, lead_score_detail)
    VALUES
      (@rowId, @email, @fullName, @company, @companyDomain, CURRENT_TIMESTAMP(),
       CURRENT_TIMESTAMP(), @sourceTag, @leadScore, PARSE_JSON(@leadScoreDetail))
  `.trim();

  try {
    await bq.executeWrite(sql, {
      rowId,
      email,
      fullName: params.full_name ?? null,
      company: params.company ?? null,
      companyDomain: params.company_domain ?? null,
      sourceTag: params.source_tag,
      leadScore: params.lead_score ?? null,
      leadScoreDetail: params.lead_score_detail
        ? JSON.stringify(params.lead_score_detail)
        : null,
    });
    logger.info("verification.lead.upserted", {
      rowId,
      sourceTag: params.source_tag,
    });
    return { status: "upserted", row_id: rowId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      "verification.lead.failed",
      err instanceof Error ? err : new Error(message),
      { rowId },
    );
    return { status: "failed", row_id: rowId, error: message };
  }
}

/**
 * Keep the people Clay found for a requester as leads, tagged with the job
 * they came from.
 *
 * Insert-only: someone already in the contacts table (a client, a prospect
 * from another motion) is left exactly as it was, never re-tagged. Like the
 * requester lead above, this never touches the Rytual fan-out, so nothing
 * here can trigger outreach.
 */
export async function storeSourcedProspects(
  contacts: ListContact[],
  job: { job_id: string; email: string },
): Promise<{ status: "stored" | "skipped" | "failed"; count: number; error?: string }> {
  if (contacts.length === 0) return { status: "skipped", count: 0 };
  const bq = moduleBq();

  // Empty strings instead of nulls: BigQuery can't infer a type for a null
  // inside an array-of-struct parameter. NULLIF turns them back into NULL.
  const rows = contacts.map((c) => ({
    row_id: crypto
      .createHash("sha256")
      .update(`${DEFAULT_CLIENT_ID}:${c.email}`)
      .digest("hex"),
    email: c.email,
    full_name: c.name,
    company: c.company,
    company_domain: c.company_domain,
    title: c.title,
    linkedin: c.linkedin,
    detail: JSON.stringify({
      sourced_for_job: job.job_id,
      requested_by: job.email.trim().toLowerCase(),
      title: c.title || null,
      linkedin: c.linkedin || null,
      location: c.location || null,
      employee_count: c.employee_count || null,
    }),
  }));

  const sql = `
    MERGE ${contactsTable()} T
    USING (
      SELECT row_id, email, NULLIF(full_name, '') AS full_name,
        NULLIF(company, '') AS company, NULLIF(company_domain, '') AS company_domain,
        NULLIF(title, '') AS title, NULLIF(linkedin, '') AS linkedin, detail
      FROM UNNEST(@contacts)
    ) S
    ON T.row_id = S.row_id
    WHEN NOT MATCHED THEN INSERT
      (row_id, work_email, full_name, current_company, current_company_domain,
       current_title, linkedin_url, created_at, updated_at, source_tag,
       lead_score_detail)
    VALUES
      (S.row_id, S.email, S.full_name, S.company, S.company_domain, S.title,
       S.linkedin, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP(), 'website-icp-sourced',
       PARSE_JSON(S.detail))
  `.trim();

  try {
    await bq.executeWrite(sql, { contacts: rows });
    logger.info("icp.prospects.stored", { jobId: job.job_id, count: rows.length });
    return { status: "stored", count: rows.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      "icp.prospects.store_failed",
      err instanceof Error ? err : new Error(message),
      { jobId: job.job_id },
    );
    return { status: "failed", count: 0, error: message };
  }
}
