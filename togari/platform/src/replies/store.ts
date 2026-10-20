/**
 * Perplexity reply loop — reply_items persistence (migration 0033).
 *
 * This module owns every write to reply_items. That matters: BigQuery has no
 * unique constraint, so row_id uniqueness is a property of the MERGE below
 * rather than of the table. A raw INSERT from anywhere else would duplicate
 * rows on Clay's first retry.
 */

import crypto from "crypto";
import { BigQueryClient } from "../bigquery/client";
import { resolveDataset } from "../services/dataset-resolver";
import { createLogger } from "../observability/logger";
import type { ReplyIngestPayload, ReplyState } from "./types";

const logger = createLogger("replies/store");

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";

function replyItemsTable(): string {
  return `\`${PROJECT_ID}.${resolveDataset()}.reply_items\``;
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

/** Default tenant for rows that arrive without an explicit client_id. */
/**
 * Fallback client for a reply that arrives without one.
 *
 * Every client's Clay column should send its own `client_id` — that is the
 * only thing that can be right once there is more than one client. This exists
 * for a column not yet updated, and returns null when unset so an unattributed
 * reply is rejected rather than quietly filed under whoever happens to be
 * configured. Guessing here would post one client's prospect into another
 * client's channel, drafted in their voice.
 */
export function defaultClientId(): string | null {
  return process.env.REPLIES_DEFAULT_CLIENT_ID?.trim() || null;
}

/**
 * Togari's own opaque handle for a reply, derived from Clay's row id so it is
 * stable across retries without a lookup. Deliberately not random: the 200
 * duplicate response has to return the same id as the original 201.
 */
export function replyItemId(rowId: string): string {
  return crypto.createHash("sha256").update(rowId).digest("hex");
}

export function inboundReplyId(
  clientId: string,
  payload: ReplyIngestPayload,
): string {
  const received = Date.parse(payload.received_at || "");
  if (!payload.lead_id || !payload.campaign_id || !Number.isFinite(received))
    return payload.row_id.trim();
  return `inbound:${replyItemId(`${clientId}:${payload.campaign_id}:${payload.lead_id}:${new Date(received).toISOString()}`)}`;
}

export interface ReplyItemRef {
  id: string;
  row_id: string;
  state: ReplyState;
}

/**
 * Whether this client already has a reply from this address that arrived at
 * or after `since`. The inbox poller and the Clay feeder name rows
 * differently, so this is what stops one reply becoming two rows (and two
 * answers).
 */
export async function hasReplyFromSince(
  clientId: string,
  fromAddress: string,
  since: string,
  campaignId: number,
  leadId: number,
): Promise<boolean> {
  const { rows } = await moduleBq().executeQuery(
    `SELECT 1 AS hit
       FROM ${replyItemsTable()}
      WHERE client_id = @clientId
        AND LOWER(from_address) = LOWER(@fromAddress)
        AND campaign_id = @campaignId AND lead_id = @leadId
        AND COALESCE(received_at, created_at) >= TIMESTAMP(@since)
      LIMIT 1`,
    { clientId, fromAddress, since, campaignId, leadId },
  );
  return rows.length > 0;
}

/**
 * Addresses whose latest reply Togari settled on its own with no email to send
 * (an opt-out blocklisted, an out-of-office follow-up scheduled, a bounce or a
 * pass logged). Those threads still look unanswered in Clay.
 */
export async function settledByAutopilot(
  clientId: string,
  replies: Array<{
    leadEmail: string;
    lastReply: string;
    emailCampaignId: number;
    emailLeadId: number;
  }>,
): Promise<Set<string>> {
  if (!replies.length) return new Set();
  const requested = replies.map((r) => ({
    email: r.leadEmail.toLowerCase(),
    at: r.lastReply,
    campaign: r.emailCampaignId,
    lead: r.emailLeadId,
    key: `${r.emailCampaignId}:${r.emailLeadId}:${r.lastReply}`,
  }));
  const { rows } = await moduleBq().executeQuery(
    `SELECT DISTINCT JSON_VALUE(r, '$.key') AS settled_key
       FROM ${replyItemsTable()} i
       JOIN UNNEST(JSON_QUERY_ARRAY(@requested)) r
         ON LOWER(i.from_address) = JSON_VALUE(r, '$.email')
        AND i.campaign_id = SAFE_CAST(JSON_VALUE(r, '$.campaign') AS INT64)
        AND i.lead_id = SAFE_CAST(JSON_VALUE(r, '$.lead') AS INT64)
        AND i.received_at >= TIMESTAMP(JSON_VALUE(r, '$.at'))
      WHERE i.client_id = @clientId AND i.state = 'done'
        AND STARTS_WITH(IFNULL(i.category, ''), 'autopilot:')`,
    { clientId, requested: JSON.stringify(requested) },
  );
  return new Set(rows.map((r) => String(r.settled_key)));
}

/** Look up an existing queue row by Clay's row id. */
export async function findReplyItem(
  rowId: string,
): Promise<ReplyItemRef | null> {
  const { rows } = await moduleBq().executeQuery(
    `SELECT id, row_id, state
       FROM ${replyItemsTable()}
      WHERE row_id = @rowId
      LIMIT 1`,
    { rowId },
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.id ?? replyItemId(rowId)),
    row_id: String(row.row_id ?? rowId),
    state: String(row.state ?? "queued") as ReplyState,
  };
}

/**
 * Insert a reply at state 'queued', attempt 0 — and only if row_id is new.
 *
 * No WHEN MATCHED branch by design: the plan is explicit that a repeat POST of
 * the same row_id must change absolutely nothing. Clay resends rows routinely
 * (auto-retry is switched on in step 03h) and a later resend can carry a
 * truncated or re-scraped body, so "last write wins" would quietly corrupt a
 * reply that is already halfway through the pipeline.
 *
 * Returns inserted:false when the row already existed — that is the race-loser
 * path, when two concurrent POSTs both got past findReplyItem().
 */
export async function insertQueuedReply(
  payload: ReplyIngestPayload,
  /** Resolved and validated by the route — never guessed here. */
  resolvedClientId: string,
): Promise<{ id: string; inserted: boolean }> {
  const rowId = payload.row_id.trim();
  const id = replyItemId(rowId);

  // Non-STRING columns go in as STRING params and are cast in SQL. BigQuery
  // cannot infer the type of a NULL param, and the client's null-param shim
  // types every null as STRING (see bigquery/client.ts), so a bare null against
  // a TIMESTAMP or INT64 column is rejected outright. SAFE_CAST also means a
  // malformed value from Clay lands as NULL instead of failing the insert.
  const sql = `
    MERGE ${replyItemsTable()} T
    USING (SELECT @rowId AS row_id) S
    ON T.row_id = S.row_id OR (
      T.client_id = @clientId AND T.lead_id = SAFE_CAST(@leadId AS INT64)
      AND T.campaign_id = SAFE_CAST(@campaignId AS INT64)
      AND T.received_at = SAFE_CAST(@receivedAt AS TIMESTAMP))
    WHEN NOT MATCHED THEN INSERT
      (id, row_id, client_id, state, attempts, created_at, updated_at,
       campaign, email_thread_id, from_address, sender_account, subject, body,
       received_at, lead_id, campaign_id, lead_name, lead_title, lead_company)
    VALUES
      (@id, @rowId, @clientId, 'queued', 0, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP(),
       @campaign, @emailThreadId, @fromAddress, @senderAccount, @subject, @body,
       SAFE_CAST(@receivedAt AS TIMESTAMP),
       SAFE_CAST(@leadId AS INT64), SAFE_CAST(@campaignId AS INT64),
       @leadName, @leadTitle, @leadCompany)
  `.trim();

  const result = await moduleBq().executeWrite(sql, {
    id,
    rowId,
    clientId: resolvedClientId,
    campaign: payload.campaign ?? null,
    emailThreadId: payload.thread_id ?? null,
    fromAddress: payload.from ?? null,
    senderAccount: payload.sender_account ?? null,
    subject: payload.subject ?? null,
    body: payload.body,
    receivedAt: payload.received_at ?? null,
    leadId: payload.lead_id == null ? null : String(payload.lead_id),
    campaignId:
      payload.campaign_id == null ? null : String(payload.campaign_id),
    leadName: payload.lead_name ?? null,
    leadTitle: payload.lead_title ?? null,
    leadCompany: payload.lead_company ?? null,
  });

  const inserted = Number(result.numDmlAffectedRows ?? "0") > 0;
  if (!inserted) {
    logger.info("replies.insert.lost_race", { rowId, id });
  }
  return { id, inserted };
}

/** Every column the Slack card needs, plus the state that gates the claim. */
export interface ReplyItemRow extends ReplyItemRef {
  client_id: string | null;
  campaign: string | null;
  email_thread_id: string | null;
  from_address: string | null;
  sender_account: string | null;
  subject: string | null;
  body: string;
  lead_id: number | null;
  campaign_id: number | null;
  lead_name: string | null;
  lead_title: string | null;
  lead_company: string | null;
  /**
   * Which conversation and which login did the work. The sweeper must continue
   * a thread on the SAME account that started it — a conversation cannot be
   * picked up by a different account — so these travel with the row rather
   * than being re-derived from the client.
   */
  pplx_thread_id: string | null;
  pplx_account: string | null;
  attempts: number;
}

/** Load the whole queue row — the email context Perplexity's callback omits. */
export async function getReplyItem(
  rowId: string,
): Promise<ReplyItemRow | null> {
  const { rows } = await moduleBq().executeQuery(
    `SELECT id, row_id, state, client_id, campaign, email_thread_id, from_address,
            sender_account, subject, body, lead_id, campaign_id,
            lead_name, lead_title, lead_company,
            pplx_thread_id, pplx_account, attempts
       FROM ${replyItemsTable()}
      WHERE row_id = @rowId
      LIMIT 1`,
    { rowId },
  );
  const row = rows[0];
  if (!row) return null;
  const str = (v: unknown): string | null =>
    v === null || v === undefined ? null : String(v);
  const num = (v: unknown): number | null =>
    v === null || v === undefined || v === "" ? null : Number(v);
  return {
    id: String(row.id ?? replyItemId(rowId)),
    row_id: String(row.row_id ?? rowId),
    state: String(row.state ?? "queued") as ReplyState,
    client_id: str(row.client_id),
    campaign: str(row.campaign),
    email_thread_id: str(row.email_thread_id),
    from_address: str(row.from_address),
    sender_account: str(row.sender_account),
    subject: str(row.subject),
    body: String(row.body ?? ""),
    lead_id: num(row.lead_id),
    campaign_id: num(row.campaign_id),
    lead_name: str(row.lead_name),
    lead_title: str(row.lead_title),
    lead_company: str(row.lead_company),
    pplx_thread_id: str(row.pplx_thread_id),
    pplx_account: str(row.pplx_account),
    attempts: num(row.attempts) ?? 0,
  };
}

/** Claim one callback before side effects. Recovery owns interrupted processing. */
export async function claimReplyResult(params: {
  rowId: string;
  category: string;
  confidence?: number | null;
  draft?: string | null;
  reasoning?: string | null;
  sessionRef?: string | null;
}): Promise<boolean> {
  const result = await moduleBq().executeWrite(
    `UPDATE ${replyItemsTable()}
        SET state = 'processing',
            category = @category,
            confidence = SAFE_CAST(@confidence AS FLOAT64),
            draft = @draft,
            reasoning = @reasoning,
            session_ref = @sessionRef,
            updated_at = CURRENT_TIMESTAMP()
      WHERE row_id = @rowId
        AND state IN ('queued', 'dispatching', 'dispatched', 'failed', 'needs_draft')`,
    {
      rowId: params.rowId,
      category: params.category,
      confidence: params.confidence == null ? null : String(params.confidence),
      draft: params.draft ?? null,
      reasoning: params.reasoning ?? null,
      sessionRef: params.sessionRef ?? null,
    },
  );
  const claimed = Number(result.numDmlAffectedRows ?? "0") > 0;
  if (!claimed)
    logger.info("replies.result.already_done", { rowId: params.rowId });
  return claimed;
}

export async function finishReplyResult(
  rowId: string,
  state: "done" | "awaiting_review" | "needs_draft" | "delivery_unknown",
  clientId?: string,
): Promise<void> {
  await moduleBq().executeWrite(
    `UPDATE ${replyItemsTable()} SET state = @state, updated_at = CURRENT_TIMESTAMP()
      WHERE row_id = @rowId AND state = 'processing' AND (@clientId IS NULL OR client_id = @clientId)`,
    { rowId, state, clientId: clientId ?? null },
  );
}

/** Reconsider an old review card only while its exact draft is still current. */
export async function claimReviewedReply(
  clientId: string,
  rowId: string,
  draft: string,
): Promise<boolean> {
  const result = await moduleBq().executeWrite(
    `UPDATE ${replyItemsTable()} SET state = 'processing', updated_at = CURRENT_TIMESTAMP()
     WHERE row_id = @rowId AND client_id = @clientId AND state = 'awaiting_review' AND draft = @draft`,
    { clientId, rowId, draft },
  );
  return Number(result.numDmlAffectedRows || 0) > 0;
}

export async function saveExpectedReply(
  rowId: string,
  body: string,
  clientId?: string,
): Promise<void> {
  await moduleBq().executeWrite(
    `UPDATE ${replyItemsTable()} SET draft = @body WHERE row_id = @rowId AND state = 'processing'
       AND (@clientId IS NULL OR client_id = @clientId)`,
    { rowId, body, clientId: clientId ?? null },
  );
}

export interface PendingResult {
  row_id: string;
  client_id: string;
  state: string;
  draft: string;
  from_address: string;
  campaign: string;
  lead_id: number;
  campaign_id: number;
  received_at: string;
}

let needColumnsSeen = false;

/**
 * True once sql/migrations/0048_reply_followups_need.sql is applied. Until
 * then a parked row still parks and its Slack post still says what's needed;
 * only the stored copy of the need waits for the columns. A true answer is
 * cached, a false one is asked again (parking is a few rows a day at most).
 */
export async function followupNeedColumns(
  client: BigQueryClient = moduleBq(),
): Promise<boolean> {
  if (needColumnsSeen) return true;
  try {
    const { rows } = await client.executeQuery(
      `SELECT column_name FROM \`${PROJECT_ID}.${resolveDataset()}\`.INFORMATION_SCHEMA.COLUMNS
        WHERE table_name = 'reply_followups' AND column_name IN ('need', 'need_text')`,
    );
    needColumnsSeen = rows.length === 2;
  } catch (error) {
    logger.warn("followups.need_columns_unreadable", { error: String(error) });
  }
  return needColumnsSeen;
}

export function _resetNeedColumns(): void {
  needColumnsSeen = false;
}

/** Who owes the next move on a stuck item. */
export type NextMove = "us" | "principal" | "investor";

export function followupOwner(status: string): NextMove {
  if (status === "waiting_on_principal") return "principal";
  if (status === "waiting_on_investor") return "investor";
  return "us";
}

export interface StalledFollowup {
  email: string;
  hours: number;
  reason: string;
  leadId?: number;
  campaignId?: number;
  owner: NextMove;
  need?: string;
  needText?: string;
}

export async function stalledFollowups(
  clientId: string,
): Promise<StalledFollowup[]> {
  const db = moduleBq();
  const withNeed = await followupNeedColumns(db);
  const { rows } = await db.executeQuery(
    `SELECT lead_email AS email, TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), due_at, HOUR) AS hours,
       CONCAT('follow-up ', status) AS reason, status,
       ${withNeed ? "need, need_text AS needText," : ""}
       SAFE_CAST(lead_id AS INT64) AS leadId, SAFE_CAST(campaign_id AS INT64) AS campaignId
     FROM \`${PROJECT_ID}.${resolveDataset()}.reply_followups\`
     WHERE client_id = @clientId AND status NOT IN ('sent', 'cancelled')
       AND (status IN ('failed', 'delivery_unknown', 'retry_exhausted', 'handoff_required',
                       'waiting_on_principal', 'waiting_on_investor')
         OR due_at <= CURRENT_TIMESTAMP())`,
    { clientId },
  );
  return rows.map((row) => ({
    email: String(row.email || ""),
    hours: Number(row.hours) || 0,
    reason: String(row.reason || ""),
    leadId: row.leadId == null ? undefined : Number(row.leadId),
    campaignId: row.campaignId == null ? undefined : Number(row.campaignId),
    owner: followupOwner(String(row.status || "")),
    need: row.need ? String(row.need) : undefined,
    needText: row.needText ? String(row.needText) : undefined,
  }));
}

/** Cards and failed replies can be absent from the campaign inbox snapshot. */
export interface StalledReplyItem {
  email: string;
  hours: number;
  reason: string;
  leadId: number;
  campaignId: number;
}

export async function stalledReplyItems(
  clientId: string,
): Promise<StalledReplyItem[]> {
  const { rows } = await moduleBq().executeQuery(
    `WITH open_replies AS (
       SELECT from_address AS email, state, lead_id, campaign_id,
         TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), COALESCE(received_at, created_at), HOUR) AS hours,
         ROW_NUMBER() OVER (PARTITION BY LOWER(from_address)
           ORDER BY COALESCE(received_at, created_at) DESC) AS latest
       FROM ${replyItemsTable()}
       WHERE client_id = @clientId
         AND state IN ('awaiting_review', 'needs_draft', 'failed', 'delivery_unknown', 'processing')
         AND NOT STARTS_WITH(IFNULL(category, ''), 'autopilot:')
         AND COALESCE(received_at, created_at) < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 15 MINUTE)
     )
     SELECT email, hours, CONCAT('reply ', state) AS reason,
       lead_id AS leadId, campaign_id AS campaignId
     FROM open_replies WHERE latest = 1`,
    { clientId },
  );
  return rows.map((row) => ({
    email: String(row.email || ""),
    hours: Number(row.hours) || 0,
    reason: String(row.reason || ""),
    leadId: Number(row.leadId) || 0,
    campaignId: Number(row.campaignId) || 0,
  }));
}

export async function pendingResults(
  clientId: string,
): Promise<PendingResult[]> {
  const { rows } = await moduleBq().executeQuery(
    `SELECT row_id, client_id, state, draft, from_address, campaign, lead_id, campaign_id,
       CAST(COALESCE(received_at, created_at) AS STRING) AS received_at
     FROM ${replyItemsTable()}
     WHERE client_id = @clientId
       AND state IN ('done', 'processing', 'failed', 'delivery_unknown', 'awaiting_review', 'needs_draft')
       AND NOT STARTS_WITH(IFNULL(category, ''), 'autopilot:')
       AND updated_at < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 15 MINUTE)
     ORDER BY IF(state = 'done', 1, 0), updated_at LIMIT 20`,
    { clientId },
  );
  return rows.map((row) => ({
    row_id: String(row.row_id ?? ""),
    client_id: String(row.client_id ?? ""),
    state: String(row.state ?? ""),
    draft: String(row.draft ?? ""),
    from_address: String(row.from_address ?? ""),
    campaign: String(row.campaign ?? ""),
    lead_id: Number(row.lead_id),
    campaign_id: Number(row.campaign_id),
    received_at: String(row.received_at ?? ""),
  }));
}

export async function reconcileResultState(
  rowId: string,
  previous: string,
  state:
    | "done"
    | "awaiting_review"
    | "delivery_unknown"
    | "needs_draft"
    | "failed",
): Promise<void> {
  await moduleBq().executeWrite(
    `UPDATE ${replyItemsTable()} SET state = @state, updated_at = CURRENT_TIMESTAMP()
      WHERE row_id = @rowId AND state = @previous`,
    { rowId, previous, state },
  );
}

/**
 * Claim a queued row for dispatch, moving it to 'dispatching'.
 *
 * Compare-and-set on state='queued', so two dispatchers racing the same row
 * cannot both send it — that would start the same paid Perplexity task twice.
 * Returns false when someone else got there first.
 */
export async function claimForDispatch(rowId: string): Promise<boolean> {
  const result = await moduleBq().executeWrite(
    `UPDATE ${replyItemsTable()}
        SET state = 'dispatching', updated_at = CURRENT_TIMESTAMP()
      WHERE row_id = @rowId AND state = 'queued'`,
    { rowId },
  );
  return Number(result.numDmlAffectedRows ?? "0") > 0;
}

/**
 * Record which Perplexity conversation and account took the work.
 *
 * Saved on its own, immediately after the call returns and BEFORE the row moves
 * to 'dispatched'. If Togari dies between the two, the row sits on
 * 'dispatching' — which is precisely the signal that the AI may have started
 * paid work we have no id for. Merging these two writes would make that state
 * invisible. The account matters because a conversation can only be continued
 * by the account that started it.
 */
export async function saveDispatchIdentity(params: {
  rowId: string;
  threadId: string | null;
  account: string;
}): Promise<void> {
  await moduleBq().executeWrite(
    `UPDATE ${replyItemsTable()}
        SET pplx_thread_id = @threadId,
            pplx_account = @account,
            updated_at = CURRENT_TIMESTAMP()
      WHERE row_id = @rowId AND state IN ('queued', 'dispatching', 'dispatched')`,
    { rowId: params.rowId, threadId: params.threadId, account: params.account },
  );
}

/**
 * Move a row to 'dispatched' — sent, waiting on the AI to answer.
 *
 * Only from 'dispatching'. Perplexity can answer before this write lands: the
 * callback then sets 'done' and this would drag it back to 'dispatched',
 * leaving a finished reply looking unfinished. The sweeper would chase it, pay
 * for another call, and the callback would post a SECOND approval card — a
 * duplicate reply to a real prospect. Observed on a live row.
 */
export async function markDispatched(rowId: string): Promise<void> {
  const res = await moduleBq().executeWrite(
    `UPDATE ${replyItemsTable()}
        SET state = 'dispatched', updated_at = CURRENT_TIMESTAMP()
      WHERE row_id = @rowId AND state = 'dispatching'`,
    { rowId },
  );
  if (Number(res.numDmlAffectedRows ?? "0") === 0) {
    logger.info("replies.dispatched.already_moved_on", { rowId });
  }
}

/**
 * A row the autopilot finished on intake (blocklisted, forwarded, follow-up
 * scheduled, or a pass). It never goes to Perplexity, so nothing is spent on it.
 */
export async function markHandledByAutopilot(
  rowId: string,
  kind: string,
): Promise<void> {
  await moduleBq().executeWrite(
    `UPDATE ${replyItemsTable()}
        SET state = 'done', category = @category, updated_at = CURRENT_TIMESTAMP()
      WHERE row_id = @rowId AND state = 'queued'`,
    { rowId, category: `autopilot:${kind}` },
  );
}

/** Move a row to 'failed'. */
export async function markFailed(rowId: string, reason: string): Promise<void> {
  logger.warn("replies.failed", { rowId, reason });
  await moduleBq().executeWrite(
    `UPDATE ${replyItemsTable()}
        SET state = 'failed', updated_at = CURRENT_TIMESTAMP()
      WHERE row_id = @rowId AND state IN ('queued', 'dispatching', 'dispatched')`,
    { rowId },
  );
}

/**
 * Requeue only failed or queued work that provably never started.
 *
 * For work that provably never started: an account out of credit cannot have
 * run the task, so there is no paid work in flight and nothing to double-spend
 * by sending it again. That is what separates this from the 'dispatching' rows
 * the sweeper refuses to retry, where the call may have reached Perplexity.
 * Never call it on a row whose task may have run.
 *
 * Guarded on queued/failed, for the same reason claimReplyResult is: a result
 * can land while this is being written, and dragging a finished row back to
 * 'queued' would dispatch it a second time and post a second card to a real
 * prospect.
 *
 * attempts and the Perplexity identity are cleared, or the row returns carrying
 * a chase count and a thread id from a run that never happened — and the
 * sweeper would fail it again on the next pass for exactly that.
 */
export async function requeueReply(rowId: string): Promise<boolean> {
  const res = await moduleBq().executeWrite(
    `UPDATE ${replyItemsTable()}
        SET state = 'queued',
            attempts = 0,
            pplx_thread_id = NULL,
            pplx_account = NULL,
            updated_at = CURRENT_TIMESTAMP()
      WHERE row_id = @rowId AND state IN ('queued', 'failed', 'dispatching')`,
    { rowId },
  );
  const requeued = Number(res.numDmlAffectedRows ?? "0") > 0;
  if (!requeued) logger.info("replies.requeue.skipped_done", { rowId });
  return requeued;
}

/** Failed rows, for the re-queue tool. Oldest first, so a batch reads in order. */
export async function findFailedRows(limit = 50): Promise<ReplyItemRow[]> {
  const { rows } = await moduleBq().executeQuery(
    `SELECT row_id
       FROM ${replyItemsTable()}
      WHERE state = 'failed'
      ORDER BY created_at
      LIMIT ${Math.max(1, Math.min(500, Math.floor(limit)))}`,
  );
  const out: ReplyItemRow[] = [];
  for (const r of rows) {
    const full = await getReplyItem(String(r.row_id));
    if (full) out.push(full);
  }
  return out;
}

/** Oldest queued rows, for the dispatcher to pick up. */
export async function findQueuedRows(limit = 1): Promise<ReplyItemRow[]> {
  const { rows } = await moduleBq().executeQuery(
    `SELECT row_id
       FROM ${replyItemsTable()}
      WHERE state = 'queued'
      ORDER BY created_at
      LIMIT ${Math.max(1, Math.min(50, Math.floor(limit)))}`,
  );
  const out: ReplyItemRow[] = [];
  for (const r of rows) {
    const full = await getReplyItem(String(r.row_id));
    if (full) out.push(full);
  }
  return out;
}

/** Rows sent to Perplexity that never came back. Step 08's query, verbatim. */
export async function findStuckDispatched(params: {
  staleMinutes: number;
  maxAttempts: number;
  limit?: number;
}): Promise<ReplyItemRow[]> {
  const { rows } = await moduleBq().executeQuery(
    `SELECT row_id
       FROM ${replyItemsTable()}
      WHERE state = 'dispatched'
        AND updated_at < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @staleMinutes MINUTE)
        AND attempts < @maxAttempts
      ORDER BY updated_at
      LIMIT ${Math.max(1, Math.min(50, Math.floor(params.limit ?? 10)))}`,
    { staleMinutes: params.staleMinutes, maxAttempts: params.maxAttempts },
  );
  const out: ReplyItemRow[] = [];
  for (const r of rows) {
    const full = await getReplyItem(String(r.row_id));
    if (full) out.push(full);
  }
  return out;
}

/** Bump attempts and updated_at — whether or not the chase-up worked. */
export async function recordChaseAttempt(rowId: string): Promise<number> {
  await moduleBq().executeWrite(
    `UPDATE ${replyItemsTable()}
        SET attempts = IFNULL(attempts, 0) + 1, updated_at = CURRENT_TIMESTAMP()
      WHERE row_id = @rowId`,
    { rowId },
  );
  const { rows } = await moduleBq().executeQuery(
    `SELECT attempts FROM ${replyItemsTable()} WHERE row_id = @rowId LIMIT 1`,
    { rowId },
  );
  return Number(rows[0]?.attempts ?? 0);
}

/**
 * Rows that have been mid-flight far too long, whatever attempts says.
 * Something running an hour is not going to finish, it is just spending.
 *
 * Measured from the last progress, NOT from created_at. A reply can sit queued
 * for hours — a backlog, a disabled sweeper, a weekend — and dating it from
 * creation failed those rows the instant they were finally dispatched. That
 * happened: two replies were classified successfully and marked failed seconds
 * later for the crime of having been queued since before lunch.
 */
export async function findAncient(
  maxAgeMinutes: number,
): Promise<ReplyItemRow[]> {
  const { rows } = await moduleBq().executeQuery(
    `SELECT row_id
       FROM ${replyItemsTable()}
      WHERE state IN ('dispatched', 'dispatching')
        AND updated_at < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @maxAgeMinutes MINUTE)
      LIMIT 50`,
    { maxAgeMinutes },
  );
  const out: ReplyItemRow[] = [];
  for (const r of rows) {
    const full = await getReplyItem(String(r.row_id));
    if (full) out.push(full);
  }
  return out;
}

/**
 * Rows stuck on 'dispatching' — the AI may have started paid work we have no
 * id for. These are ALERTED ON and never retried automatically (step 06).
 */
export async function findStuckDispatching(
  minutes: number,
): Promise<ReplyItemRow[]> {
  const { rows } = await moduleBq().executeQuery(
    `SELECT row_id
       FROM ${replyItemsTable()}
      WHERE state = 'dispatching'
        AND updated_at < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @minutes MINUTE)
      LIMIT 50`,
    { minutes },
  );
  const out: ReplyItemRow[] = [];
  for (const r of rows) {
    const full = await getReplyItem(String(r.row_id));
    if (full) out.push(full);
  }
  return out;
}

/**
 * Delete the queue row for a reply once it has been answered.
 *
 * Keyed on the prospect's Message-ID, which the Slack card already carries as
 * `inReplyTo` through every hop (button value, rebuilt confirm button, edit
 * modal metadata) because email threading needs it. Threading a second
 * identifier through all four hops to do the same job would be more code and
 * one more thing to drop.
 *
 * Refuses an empty key rather than issuing an unkeyed delete.
 */
export async function deleteReplyByThread(inReplyTo: string): Promise<number> {
  const key = (inReplyTo ?? "").trim();
  if (!key) {
    logger.warn("replies.delete.skipped_no_thread_id");
    return 0;
  }
  const res = await moduleBq().executeDelete(
    `DELETE FROM ${replyItemsTable()} WHERE email_thread_id = @inReplyTo`,
    { inReplyTo: key },
  );
  const deleted = Number(res.numDmlAffectedRows ?? "0");
  logger.info("replies.deleted_after_send", { inReplyTo: key, deleted });
  return deleted;
}

/** Whether an answered reply's row is deleted. On unless turned off. */
export function deleteAfterSendEnabled(): boolean {
  return process.env.REPLIES_DELETE_AFTER_SEND !== "false";
}

/**
 * Whether a verdict with no draft still posts a Slack card.
 *
 * Off by default: a card with nothing to approve cannot be acted on, and the
 * channel is for work. The classification is still saved on the row either way.
 *
 * Worth knowing what this hides: `negative` replies, which include
 * unsubscribes and do-not-contact requests, no longer reach anyone. If those
 * need a human, they need their own path rather than this one.
 */
export function cardRequiresDraft(): boolean {
  return process.env.REPLIES_CARD_REQUIRES_DRAFT !== "false";
}

/**
 * Delete a reply's row outright, by its Clay row id.
 *
 * Used for `negative`: nobody answers a no, so the row has no further purpose
 * and holding a prospect's email in BigQuery for one is worse than dropping it.
 */
export async function deleteReplyByRowId(rowId: string): Promise<number> {
  const key = (rowId ?? "").trim();
  if (!key) return 0;
  const res = await moduleBq().executeDelete(
    `DELETE FROM ${replyItemsTable()} WHERE row_id = @rowId`,
    { rowId: key },
  );
  const deleted = Number(res.numDmlAffectedRows ?? "0");
  logger.info("replies.deleted_negative", { rowId: key, deleted });
  return deleted;
}
