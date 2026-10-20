/**
 * Website ICP list funnel — job store on togari_core.icp_list_jobs.
 *
 * The jobs table is the async bridge between the website wizard and Clay's
 * callback (Clay has no synchronous API). Every state transition is a
 * guarded single-statement UPDATE so duplicate callbacks and the timeout
 * sweeper can never double-send a list.
 */

import crypto from "crypto";
import { BigQueryClient } from "../bigquery/client";
import { createLogger } from "../observability/logger";
import { normalizeRequesterEmail, type IcpJob, type JobStatus } from "./types";

const logger = createLogger("icp/service");

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";
const JOBS_DATASET = "togari_core";

function jobsTable(): string {
  return `\`${PROJECT_ID}.${JOBS_DATASET}.icp_list_jobs\``;
}

function messagesTable(): string {
  return `\`${PROJECT_ID}.${JOBS_DATASET}.website_contact_messages\``;
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

export function hashIp(ip: string | undefined | null): string | null {
  if (!ip || ip.trim() === "") return null;
  return crypto.createHash("sha256").update(ip.trim()).digest("hex");
}

function parseMaybeJson(value: unknown): Record<string, unknown>[] | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function rowToJob(row: Record<string, unknown>): IcpJob {
  return {
    job_id: String(row.job_id),
    created_at: row.created_at
      ? String((row.created_at as any).value ?? row.created_at)
      : undefined,
    status: String(row.status) as JobStatus,
    full_name: (row.full_name as string) ?? null,
    email: String(row.email),
    company: (row.company as string) ?? null,
    company_domain: (row.company_domain as string) ?? null,
    company_description: (row.company_description as string) ?? null,
    industry: (row.industry as string) ?? null,
    icp_description: String(row.icp_description ?? ""),
    company_size: (row.company_size as string) ?? null,
    target_titles: Array.isArray(row.target_titles)
      ? (row.target_titles as string[])
      : [],
    dnc_suppressed: (row.dnc_suppressed as boolean) ?? null,
    work_email: (row.work_email as boolean) ?? null,
    lead_score: row.lead_score != null ? Number(row.lead_score) : null,
    list_data: parseMaybeJson(row.list_data),
    list_size: row.list_size != null ? Number(row.list_size) : null,
    clay_status: (row.clay_status as string) ?? null,
  };
}

export async function createJob(params: {
  full_name: string;
  email: string;
  company: string;
  company_domain: string;
  company_description?: string;
  industry: string;
  icp_description: string;
  company_size?: string | null;
  target_titles: string[];
  client_ip?: string;
  dnc_suppressed: boolean;
  work_email: boolean;
  lead_score: number;
}): Promise<string> {
  const bq = moduleBq();
  const jobId = crypto.randomUUID();
  const sql = `
    INSERT INTO ${jobsTable()}
      (job_id, created_at, updated_at, status, full_name, email, company,
       company_domain, company_description, industry, icp_description,
       company_size, target_titles, ip_hash, dnc_suppressed, work_email,
       lead_score, callback_count)
    VALUES
      (@jobId, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP(), 'pending', @fullName,
       @email, @company, @companyDomain, @companyDescription, @industry,
       @icpDescription, @companySize, @targetTitles, @ipHash, @dncSuppressed,
       @workEmail, @leadScore, 0)
  `.trim();

  await bq.executeWrite(sql, {
    jobId,
    fullName: params.full_name,
    email: params.email.toLowerCase(),
    company: params.company,
    companyDomain: params.company_domain,
    companyDescription: params.company_description || null,
    industry: params.industry,
    icpDescription: params.icp_description,
    companySize: params.company_size ?? null,
    targetTitles: params.target_titles,
    ipHash: hashIp(params.client_ip),
    dncSuppressed: params.dnc_suppressed,
    workEmail: params.work_email,
    leadScore: params.lead_score,
  });
  logger.info("icp.job.created", { jobId });
  return jobId;
}

export async function getJob(jobId: string): Promise<IcpJob | null> {
  const bq = moduleBq();
  const result = await bq.executeQuery(
    `SELECT * FROM ${jobsTable()} WHERE job_id = @jobId LIMIT 1`,
    { jobId },
  );
  if (result.rows.length === 0) return null;
  return rowToJob(result.rows[0]);
}

/**
 * One free list per requester, ever. Any earlier job from the same email
 * (compared without case or +tags) blocks a new one, whatever happened to
 * it: a failed build gets a personal follow-up, not a second automated run.
 */
export async function findPriorRequest(
  email: string,
): Promise<{ job_id: string; status: string; created_at: string | null } | null> {
  const bq = moduleBq();
  const result = await bq.executeQuery(
    `
    SELECT job_id, status, created_at FROM ${jobsTable()}
    WHERE REGEXP_REPLACE(LOWER(email), r'\+[^@]*@', '@') = @email
    ORDER BY created_at DESC
    LIMIT 1
    `.trim(),
    { email: normalizeRequesterEmail(email) },
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  return {
    job_id: String(row.job_id),
    status: String(row.status),
    created_at: row.created_at
      ? String((row.created_at as any).value ?? row.created_at)
      : null,
  };
}

/** Daily volume checks — global and per-requester, against today's partition. */
export async function checkDailyCaps(email: string): Promise<{
  globalCapReached: boolean;
  requesterCapReached: boolean;
}> {
  const globalCap = Number(process.env.ICP_DAILY_CAP) || 100;
  const perEmailCap = Number(process.env.ICP_PER_EMAIL_DAILY_CAP) || 3;
  const bq = moduleBq();
  const result = await bq.executeQuery(
    `
    SELECT
      COUNT(*) AS total,
      COUNTIF(email = @email) AS for_email
    FROM ${jobsTable()}
    WHERE DATE(created_at) = CURRENT_DATE()
    `.trim(),
    { email: email.toLowerCase() },
  );
  const row = result.rows[0] ?? {};
  return {
    globalCapReached: Number(row.total ?? 0) >= globalCap,
    requesterCapReached: Number(row.for_email ?? 0) >= perEmailCap,
  };
}

export async function updateJobStatus(
  jobId: string,
  status: JobStatus,
  error?: string,
): Promise<void> {
  const bq = moduleBq();
  await bq.executeWrite(
    `
    UPDATE ${jobsTable()}
    SET status = @status,
        error = COALESCE(@error, error),
        updated_at = CURRENT_TIMESTAMP()
    WHERE job_id = @jobId
    `.trim(),
    { jobId, status, error: error ?? null },
  );
}

/**
 * Record a Clay callback and claim the job in one compare-and-set.
 *
 * The `processed_at IS NULL` predicate makes duplicate callbacks safe: only
 * the first caller gets numDmlAffectedRows=1 and proceeds; every later
 * duplicate sees 0 rows and reports `already_processed`.
 */
export async function claimCallback(params: {
  jobId: string;
  status: JobStatus;
  clayStatus: string;
  listData: Record<string, unknown>[];
}): Promise<boolean> {
  const bq = moduleBq();
  const write = await bq.executeWrite(
    `
    UPDATE ${jobsTable()}
    SET status = @status,
        clay_status = @clayStatus,
        list_data = PARSE_JSON(@listData),
        list_size = @listSize,
        callback_count = COALESCE(callback_count, 0) + 1,
        processed_at = CURRENT_TIMESTAMP(),
        updated_at = CURRENT_TIMESTAMP()
    WHERE job_id = @jobId AND processed_at IS NULL
    `.trim(),
    {
      jobId: params.jobId,
      status: params.status,
      clayStatus: params.clayStatus,
      listData: JSON.stringify(params.listData),
      listSize: params.listData.length,
    },
  );
  return Number(write.numDmlAffectedRows) > 0;
}

/** Count duplicate callbacks for observability without re-claiming. */
export async function recordDuplicateCallback(jobId: string): Promise<void> {
  const bq = moduleBq();
  await bq.executeWrite(
    `
    UPDATE ${jobsTable()}
    SET callback_count = COALESCE(callback_count, 0) + 1,
        updated_at = CURRENT_TIMESTAMP()
    WHERE job_id = @jobId
    `.trim(),
    { jobId },
  );
}

/** Stamp the list email on the job. */
export async function recordListEmailSent(
  jobId: string,
  messageId: string,
): Promise<void> {
  const bq = moduleBq();
  await bq.executeWrite(
    `
    UPDATE ${jobsTable()}
    SET list_emailed_at = CURRENT_TIMESTAMP(),
        list_email_message_id = @messageId,
        updated_at = CURRENT_TIMESTAMP()
    WHERE job_id = @jobId
    `.trim(),
    { jobId, messageId },
  );
}

/**
 * Move open jobs older than `minutes` from one of `from` to `to`, once each
 * (the UPDATE re-checks the status). processed_at is never set here, so a
 * late Clay callback can always still claim the job and send the list.
 */
async function sweepJobs(
  minutes: number,
  from: JobStatus[],
  to: "stalled" | "timed_out",
): Promise<IcpJob[]> {
  const bq = moduleBq();
  const stale = await bq.executeQuery(
    `
    SELECT * FROM ${jobsTable()}
    WHERE status IN UNNEST(@from)
      AND created_at < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @minutes MINUTE)
      AND processed_at IS NULL
    LIMIT 50
    `.trim(),
    { minutes, from },
  );

  const claimed: IcpJob[] = [];
  for (const row of stale.rows) {
    const job = rowToJob(row);
    const write = await bq.executeWrite(
      `
      UPDATE ${jobsTable()}
      SET status = @to,
          updated_at = CURRENT_TIMESTAMP()
      WHERE job_id = @jobId AND processed_at IS NULL AND status IN UNNEST(@from)
      `.trim(),
      { jobId: job.job_id, to, from },
    );
    if (Number(write.numDmlAffectedRows) > 0) {
      claimed.push({ ...job, status: to });
    }
  }
  if (claimed.length > 0) {
    logger.info(`icp.sweep.${to}`, { count: claimed.length });
  }
  return claimed;
}

/**
 * Jobs still building past the alert window: flag them for a Slack heads-up.
 * They stay open (no processed_at), so a late Clay callback still claims the
 * job and sends the list.
 */
export function sweepStalledJobs(alertMinutes: number): Promise<IcpJob[]> {
  return sweepJobs(alertMinutes, ["pending", "building"], "stalled");
}

/**
 * Jobs with no callback by the give-up deadline. The caller alerts Slack to
 * reach out to each requester personally; a list that still arrives later is
 * sent as normal.
 */
export function sweepTimedOutJobs(giveUpMinutes: number): Promise<IcpJob[]> {
  return sweepJobs(giveUpMinutes, ["pending", "building", "stalled"], "timed_out");
}

export async function insertContactMessage(params: {
  full_name: string;
  email: string;
  message: string;
  client_ip?: string;
}): Promise<string> {
  const bq = moduleBq();
  const messageId = crypto.randomUUID();
  await bq.executeWrite(
    `
    INSERT INTO ${messagesTable()}
      (message_id, created_at, full_name, email, message, ip_hash)
    VALUES
      (@messageId, CURRENT_TIMESTAMP(), @fullName, @email, @message, @ipHash)
    `.trim(),
    {
      messageId,
      fullName: params.full_name,
      email: params.email.toLowerCase(),
      message: params.message,
      ipHash: hashIp(params.client_ip),
    },
  );
  logger.info("icp.contact.recorded", { messageId });
  return messageId;
}
