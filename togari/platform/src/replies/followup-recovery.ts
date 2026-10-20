import { BigQueryClient } from "../bigquery/client";
import { resolveDataset } from "../services/dataset-resolver";
import {
  clayWorkspace,
  type ReplybotClientConfig,
} from "../agents/replybot/client-config";
import { thread } from "../integrations/clay/campaign-read";
import {
  followupAttempt,
  followupDisposition,
  scheduleConversationFollowup,
} from "./conversation-cycle";
import { createLogger } from "../observability/logger";
import { retainVantageReceipt } from "./vantage-outbox";
import { humanDisposition } from "./card-actions";

const logger = createLogger("FollowupRecovery");

/** Recover provider receipts independently of retained original reply rows. Never sends. */
export async function reconcileFollowups(
  client: ReplybotClientConfig,
): Promise<void> {
  const ws = clayWorkspace(client);
  if (!ws) return;
  const project = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";
  const table = `\`${project}.${resolveDataset()}.reply_followups\``;
  const bq = new BigQueryClient(
    project,
    null,
    process.env.GCP_CREDENTIALS_BASE64 ||
      process.env.GOOGLE_CREDENTIALS_BASE64 ||
      null,
  );
  // A row parked for the principal leaves the pile when the conversation
  // moves without it: the investor wrote again, or a person closed it. The
  // independent review on 2026-10-17 found nothing ever read this status.
  const parked = await bq.executeQuery(
    `SELECT id, lead_id, campaign_id, lead_email, CAST(created_at AS STRING) AS created_at
       FROM ${table} WHERE client_id = @clientId AND status = 'waiting_on_principal' LIMIT 20`,
    { clientId: client.clientId },
  );
  for (const row of parked.rows) {
    try {
      const leadId = Number(row.lead_id),
        campaignId = Number(row.campaign_id);
      if (!leadId || !campaignId) continue;
      const messages = await thread(
        client.clientId,
        ws.workspaceId,
        campaignId,
        leadId,
      );
      const inbound = messages
        .filter((m) => m.type === "REPLY")
        .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))[0];
      const moved =
        !!inbound &&
        (Date.parse(inbound.time) > Date.parse(String(row.created_at)) ||
          (await humanDisposition(
            client.clientId,
            String(row.lead_email),
            campaignId,
            inbound.time,
            inbound.messageId,
          )) === "closed");
      if (moved)
        await bq.executeWrite(
          `UPDATE ${table} SET status = 'cancelled'
            WHERE id = @id AND client_id = @clientId AND status = 'waiting_on_principal'`,
          { id: String(row.id), clientId: client.clientId },
        );
    } catch (error) {
      logger.warn("followup_recovery.parked_unreadable", {
        id: String(row.id),
        error: String(error),
      });
    }
  }
  // The existing result recovery waits 15 minutes for provider visibility.
  // Reuse that unmeasured grace period for interrupted follow-up claims.
  const { rows } = await bq.executeQuery(
    `SELECT id, lead_id, campaign_id, lead_email, lead_name, thread_id,
       CAST(created_at AS STRING) AS created_at FROM ${table}
     WHERE client_id = @clientId AND (
       (status IN ('delivery_unknown', 'failed') AND due_at <= CURRENT_TIMESTAMP())
       OR (status = 'sending' AND due_at < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 15 MINUTE)))
     ORDER BY due_at LIMIT 20`,
    { clientId: client.clientId },
  );
  for (const row of rows) {
    try {
      const leadId = Number(row.lead_id),
        campaignId = Number(row.campaign_id);
      if (leadId && campaignId) {
        const messages = await thread(
          client.clientId,
          ws.workspaceId,
          campaignId,
          leadId,
        );
        for (const receipt of messages.filter(
          (m) =>
            m.type === "SENT" &&
            m.messageId !== row.thread_id &&
            Date.parse(m.time) > Date.parse(String(row.created_at)),
        ))
          await retainVantageReceipt(
            client.clientId,
            String(row.lead_email),
            receipt,
          );
        const disposition = followupDisposition(
          messages,
          !String(row.id).startsWith("cycle:"),
        );
        const sent = messages
          .filter(
            (m) =>
              m.type === "SENT" &&
              m.messageId !== row.thread_id &&
              Date.parse(m.time) > Date.parse(String(row.created_at)),
          )
          .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))[0];
        const inbound = messages
          .filter((m) => m.type === "REPLY")
          .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))[0];
        const human = inbound
          ? await humanDisposition(
              client.clientId,
              String(row.lead_email),
              campaignId,
              inbound.time,
              inbound.messageId,
            )
          : null;
        if (human) {
          await bq.executeWrite(
            `UPDATE ${table} SET status = @status
             WHERE id = @id AND client_id = @clientId AND status IN ('sending', 'delivery_unknown', 'failed')`,
            {
              id: String(row.id),
              clientId: client.clientId,
              status: human === "closed" ? "cancelled" : "handoff_required",
            },
          );
          continue;
        }
        if (
          sent &&
          (!inbound || Date.parse(sent.time) > Date.parse(inbound.time))
        ) {
          if (disposition === "send")
            await scheduleConversationFollowup(
              client,
              {
                to: String(row.lead_email),
                leadId,
                campaignId,
                leadName: String(row.lead_name || ""),
                followupAttempt: followupAttempt(String(row.id)),
              },
              sent,
              inbound?.time || String(row.created_at),
              messages,
            );
          await bq.executeWrite(
            `UPDATE ${table} SET status = 'sent', sent_at = TIMESTAMP(@sentAt)
            WHERE id = @id AND client_id = @clientId AND status IN ('sending', 'delivery_unknown', 'failed')`,
            {
              id: String(row.id),
              clientId: client.clientId,
              sentAt: sent.time,
            },
          );
          continue;
        }
        if (
          inbound &&
          Date.parse(inbound.time) > Date.parse(String(row.created_at))
        ) {
          await bq.executeWrite(
            `UPDATE ${table} SET status = 'cancelled'
            WHERE id = @id AND client_id = @clientId AND status IN ('sending', 'delivery_unknown', 'failed')`,
            { id: String(row.id), clientId: client.clientId },
          );
          continue;
        }
        if (disposition !== "send") {
          await bq.executeWrite(
            `UPDATE ${table} SET status = @status
            WHERE id = @id AND client_id = @clientId AND status IN ('sending', 'delivery_unknown', 'failed')`,
            {
              id: String(row.id),
              clientId: client.clientId,
              status:
                disposition === "cancel" ? "cancelled" : "handoff_required",
            },
          );
          continue;
        }
      }
      // Rotate unresolved rows so missing identities cannot monopolize the batch.
      await bq.executeWrite(
        `UPDATE ${table} SET status = 'delivery_unknown',
        due_at = TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL 15 MINUTE)
        WHERE id = @id AND client_id = @clientId AND status IN ('sending', 'delivery_unknown', 'failed')`,
        { id: String(row.id), clientId: client.clientId },
      );
    } catch (error) {
      logger.warn("followup_recovery.failed", {
        id: String(row.id),
        error: String(error),
      });
    }
  }
}
