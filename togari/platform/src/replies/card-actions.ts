/**
 * What happened to a reply (migration 0045): an answer went out (a card
 * button, a modal, auto-send or the assistant, all through sendReplyEmail),
 * or a person skipped it or marked it done outside email. The campaign
 * calendar counts a reply as waiting on an answer until one of these lands
 * for that prospect. Only clients with a campaignCalendar are recorded.
 *
 * Sent logging is best effort. Human terminal decisions are awaited before
 * acknowledging the card, and a failed durable write must leave it open.
 */
import { BigQueryClient } from "../bigquery/client";
import { resolveDataset } from "../services/dataset-resolver";
import { createLogger } from "../observability/logger";

const logger = createLogger("replies/card-actions");

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";

export type CardAction = "sent" | "skipped" | "done";

export function cardActionsTable(): string {
  return `\`${PROJECT_ID}.${resolveDataset()}.reply_card_actions\``;
}

export async function recordCardAction(
  clientId: string,
  card: {
    leadEmail?: string;
    campaignId?: number | string;
    campaignName?: string;
    inReplyTo?: string;
  },
  action: CardAction,
  byUser: string,
  required = false,
): Promise<void> {
  const lead = (card.leadEmail || "").trim().toLowerCase();
  if (required && (!lead || card.campaignId == null || !card.inReplyTo?.trim()))
    throw new Error("Missing original inbound identity for card decision");
  if (!lead) {
    if (required)
      throw new Error("Missing prospect identity for card decision");
    return;
  }
  try {
    await new BigQueryClient(
      PROJECT_ID,
      null,
      process.env.GCP_CREDENTIALS_BASE64 ||
        process.env.GOOGLE_CREDENTIALS_BASE64 ||
        null,
    ).executeWrite(
      `INSERT INTO ${cardActionsTable()}
         (client_id, lead_email, campaign_id, campaign_name, action, by_user, acted_at, reply_thread_id)
       VALUES (@clientId, @lead, @campaignId, @campaignName, @action, @byUser, CURRENT_TIMESTAMP(), @inReplyTo)`,
      {
        clientId,
        lead,
        campaignId: card.campaignId == null ? null : String(card.campaignId),
        campaignName: card.campaignName || null,
        action,
        byUser: byUser || null,
        inReplyTo: card.inReplyTo?.trim() || null,
      },
    );
  } catch (err) {
    logger.warn("Could not record the card action", {
      clientId,
      action,
      error: err instanceof Error ? err.message : String(err),
    });
    if (required) throw err;
  }
}

/** A human disposition covers this inbound, never a later investor message. */
export async function humanDisposition(
  clientId: string,
  email: string,
  campaignId: number,
  inboundAt: string,
  inboundId: string,
): Promise<"closed" | "legacy_hold" | null> {
  if (!Number.isFinite(Date.parse(inboundAt)))
    throw new Error("Cannot check human disposition without an inbound time");
  if (!inboundId) return "legacy_hold";
  const { rows } = await new BigQueryClient(
    PROJECT_ID,
    null,
    process.env.GCP_CREDENTIALS_BASE64 ||
      process.env.GOOGLE_CREDENTIALS_BASE64 ||
      null,
  ).executeQuery(
    `SELECT reply_thread_id FROM ${cardActionsTable()}
      WHERE client_id = @clientId AND LOWER(lead_email) = @email
        AND campaign_id = @campaignId AND action IN ('skipped', 'done')
        AND (reply_thread_id = @inboundId OR
          (reply_thread_id IS NULL AND acted_at >= TIMESTAMP(@inboundAt)))
      ORDER BY IF(reply_thread_id = @inboundId, 0, 1), acted_at DESC LIMIT 1`,
    {
      clientId,
      email: email.trim().toLowerCase(),
      campaignId: String(campaignId),
      inboundAt,
      inboundId,
    },
  );
  if (!rows.length) return null;
  return rows[0].reply_thread_id === inboundId ? "closed" : "legacy_hold";
}
