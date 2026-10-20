import crypto from "node:crypto";
import { BigQueryClient } from "../bigquery/client";
import type { ReplybotClientConfig } from "../agents/replybot/client-config";
import type { ThreadMessage } from "../integrations/clay/campaign-read";
import { replyIntent } from "../agents/smartlead-responder/reply-intent";
import { htmlToText } from "../routes/client-dashboard";
import { vantageContext } from "./vantage";

const PROJECT = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";
const TABLE = `\`${PROJECT}.togari_data_lake.reply_followups\``;

export interface ConversationSend {
  to: string;
  leadName?: string;
  leadId?: number;
  campaignId?: number;
  followupAttempt?: number;
}

export function cycleDue(sentAt: Date): Date {
  const due = new Date(sentAt);
  let days = 0;
  while (days < 2) {
    due.setUTCDate(due.getUTCDate() + 1);
    if (due.getUTCDay() !== 0 && due.getUTCDay() !== 6) days++;
  }
  due.setUTCHours(14, 0, 0, 0);
  return due;
}

export function followupAttempt(id: string): number {
  return Number(/^cycle:([12]):/.exec(id)?.[1] || 0);
}

export function followupObsolete(
  messages: ThreadMessage[],
  createdAt: string,
): boolean {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return true;
  return messages.some(
    (m) =>
      Date.parse(m.time) > created && (m.type === "REPLY" || m.type === "SENT"),
  );
}

/** A scheduled nudge must still make sense after reading the investor's words. */
export function followupDisposition(
  messages: ThreadMessage[],
  scheduledReturn = false,
): "send" | "cancel" | "handoff" {
  const latest = messages
    .filter((message) => message.type === "REPLY")
    .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))[0];
  if (!latest) return "handoff";
  const body = htmlToText(latest.body);
  const intent = replyIntent(body);
  if (intent.isDeliveryFailure) return "handoff";
  const kind = intent.kind;
  if (kind === "later" && intent.isAway && scheduledReturn) return "send";
  if (
    ["pass", "unsubscribe", "ignore", "new_address", "referral"].includes(kind)
  )
    return "cancel";
  // A meeting request needs actual availability and coordination. A generic
  // nudge can lose a ready investor, so keep it visible as a handoff.
  if (["form", "later", "interested", "unclear"].includes(kind))
    return "handoff";
  if (
    ["question", "deck"].includes(kind) &&
    !messages.some(
      (message) =>
        message.type === "SENT" &&
        Date.parse(message.time) > Date.parse(latest.time),
    )
  )
    return "handoff";
  return "send";
}

/** A send stays an open conversation until a response or explicit handoff. */
export async function scheduleConversationFollowup(
  client: ReplybotClientConfig,
  msg: ConversationSend,
  sent: ThreadMessage,
  inboundAt: string,
  history: ThreadMessage[] = [],
): Promise<void> {
  if (
    client.clientId !== "zeutara" ||
    !msg.leadId ||
    !msg.campaignId ||
    !sent.messageId
  )
    return;
  if (!Number.isFinite(Date.parse(inboundAt)))
    throw new Error("Cannot schedule without an inbound conversation boundary");
  const bq = new BigQueryClient(
    PROJECT,
    null,
    process.env.GCP_CREDENTIALS_BASE64 ||
      process.env.GOOGLE_CREDENTIALS_BASE64 ||
      null,
  );
  let prior = msg.followupAttempt;
  if (prior === undefined) {
    const { rows } = await bq.executeQuery(
      `SELECT MAX(SAFE_CAST(REGEXP_EXTRACT(id, r'^cycle:([12]):') AS INT64)) AS attempt
       FROM ${TABLE} WHERE client_id = @clientId AND lead_id = SAFE_CAST(@leadId AS INT64)
       AND campaign_id = SAFE_CAST(@campaignId AS INT64) AND created_at >= TIMESTAMP(@inboundAt)
       AND thread_id != @threadId AND status IN ('sent', 'sending', 'delivery_unknown')`,
      {
        clientId: client.clientId,
        leadId: String(msg.leadId),
        campaignId: String(msg.campaignId),
        inboundAt,
        threadId: sent.messageId,
      },
    );
    prior = Number(rows[0]?.attempt || 0);
  }
  const attempt = prior + 1;
  // Two automated nudges, then an unresolved handoff for a person. This is
  // a bounded initial policy, not a measured optimum. Never silently close it.
  const deckPending = /the deck(?:'|’|&#39;|&apos;|&#x27;)s coming\b/i.test(
    sent.body,
  );
  // Two nudges went unanswered: the investor owes the next move, and the
  // digest lists it under them rather than as work we dropped.
  const status = deckPending
    ? "handoff_required"
    : attempt > 2
      ? "waiting_on_investor"
      : "scheduled";
  const key = crypto
    .createHash("sha256")
    .update(
      `${client.clientId}:${msg.campaignId}:${msg.leadId}:${sent.messageId}`,
    )
    .digest("hex");
  const id = `cycle:${Math.min(attempt, 2)}:${key}`;
  const due = cycleDue(new Date(sent.time));
  if (!Number.isFinite(due.getTime()))
    throw new Error("Cannot schedule a conversation without a valid send time");
  await bq.executeWrite(
    `MERGE ${TABLE} t USING (SELECT @id AS id) s
     ON t.client_id = @clientId AND t.lead_id = SAFE_CAST(@leadId AS INT64)
       AND t.campaign_id = SAFE_CAST(@campaignId AS INT64) AND t.thread_id = @threadId
     WHEN NOT MATCHED THEN INSERT
       (id, client_id, row_id, lead_id, campaign_id, lead_email, lead_name, thread_id, due_at, created_at, status)
       VALUES (@id, @clientId, @id, SAFE_CAST(@leadId AS INT64), SAFE_CAST(@campaignId AS INT64),
         @email, @name, @threadId, TIMESTAMP(@dueAt), TIMESTAMP(@sentAt), @status)`,
    {
      id,
      clientId: client.clientId,
      leadId: String(msg.leadId),
      campaignId: String(msg.campaignId),
      email: msg.to,
      name: msg.leadName || "",
      threadId: sent.messageId,
      dueAt: due.toISOString(),
      sentAt: sent.time,
      status,
    },
  );
  await settleDeckPromises(client, msg, sent, inboundAt, history);
}

/** Reconcile fulfilled promises without reopening closed cards or creating nudges. */
export async function settleDeckPromises(
  client: ReplybotClientConfig,
  msg: ConversationSend,
  sent: ThreadMessage,
  inboundAt: string,
  history: ThreadMessage[],
): Promise<void> {
  if (
    client.clientId !== "zeutara" ||
    !msg.leadId ||
    !msg.campaignId ||
    sent.type !== "SENT"
  )
    return;
  const promises = history
    .filter(
      (message) =>
        message.type === "SENT" &&
        message.messageId !== sent.messageId &&
        Date.parse(message.time) >= Date.parse(inboundAt) &&
        Date.parse(message.time) < Date.parse(sent.time) &&
        /the deck(?:'|’|&#39;|&apos;|&#x27;)s coming\b/i.test(message.body),
    )
    .map((message) => message.messageId);
  if (promises.length) {
    const ctx = await vantageContext(msg.to);
    const urls = sent.body.match(/https?:\/\/[^\s<>"')]+/gi) || [];
    if (
      ctx.deckUrl &&
      urls.some((url) => url.replace(/[.,]+$/, "") === ctx.deckUrl)
    )
      await new BigQueryClient(
        PROJECT,
        null,
        process.env.GCP_CREDENTIALS_BASE64 ||
          process.env.GOOGLE_CREDENTIALS_BASE64 ||
          null,
      ).executeWrite(
        `UPDATE ${TABLE} SET status = 'cancelled'
         WHERE client_id = @clientId AND lead_id = SAFE_CAST(@leadId AS INT64)
           AND campaign_id = SAFE_CAST(@campaignId AS INT64)
           AND thread_id IN UNNEST(@promiseIds) AND status = 'handoff_required'`,
        {
          clientId: client.clientId,
          leadId: String(msg.leadId),
          campaignId: String(msg.campaignId),
          promiseIds: promises,
        },
      );
  }
}
