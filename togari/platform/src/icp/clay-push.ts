/**
 * Push one ICP list request to the Clay sourcing table.
 *
 * The webhook URL is read from env AT CALL TIME: Clay webhook-in sources
 * have a 50,000-lifetime-submission cap that never resets, so rotation to a
 * fresh webhook must be an env change, never a deploy.
 */

import { pushRowsToClayTable } from "../integrations/clay/client";
import { createLogger } from "../observability/logger";

const logger = createLogger("icp/clay-push");

const DEFAULT_CALLBACK_URL =
  "https://togari-bma-prod.up.railway.app/webhooks/clay/icp-callback";

export async function pushIcpJobToClay(job: {
  job_id: string;
  email: string;
  full_name: string;
  company: string;
  company_domain: string;
  company_description?: string;
  industry: string;
  icp_description: string;
  company_size?: string | null;
  target_titles: string[];
}): Promise<{ ok: boolean; error?: string }> {
  const webhookUrl = process.env.CLAY_ICP_WEBHOOK_URL;
  if (!webhookUrl) {
    return { ok: false, error: "CLAY_ICP_WEBHOOK_URL not configured" };
  }

  const row = {
    job_id: job.job_id,
    // row_id mirrors job_id (single-brief jobs) — kept as a separate
    // passthrough column so the Clay table contract matches the standard
    // session/row shape.
    row_id: job.job_id,
    requester_email: job.email,
    requester_name: job.full_name,
    requester_company: job.company,
    requester_domain: job.company_domain,
    requester_description: job.company_description ?? "",
    requester_industry: job.industry,
    icp_description: job.icp_description,
    company_size: job.company_size ?? "",
    // Clay formula columns split on comma more easily than on JSON.
    target_titles: job.target_titles.join(", "),
    // Traceability only — the Clay HTTP API column should hardcode the
    // callback URL rather than trust this value at send time.
    callback_url: process.env.ICP_CALLBACK_URL || DEFAULT_CALLBACK_URL,
  };

  const result = await pushRowsToClayTable(webhookUrl, [row]);
  if (result.pushed === 1) {
    logger.info("icp.clay.pushed", { jobId: job.job_id });
    return { ok: true };
  }
  const error = result.errors.join("; ") || "push failed";
  logger.error("icp.clay.push_failed", new Error(error), { jobId: job.job_id });
  return { ok: false, error };
}
