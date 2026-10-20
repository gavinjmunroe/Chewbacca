import {
  clayWorkspace,
  type ReplybotClientConfig,
} from "../agents/replybot/client-config";
import { thread, type ThreadMessage } from "../integrations/clay/campaign-read";
import {
  pendingResults,
  reconcileResultState,
  claimReviewedReply,
  finishReplyResult,
  saveExpectedReply,
  getReplyItem,
} from "./store";
import { createLogger } from "../observability/logger";
import {
  scheduleConversationFollowup,
  settleDeckPromises,
} from "./conversation-cycle";
import { flushVantageReceipts, retainVantageReceipt } from "./vantage-outbox";
import { reconcileFollowups } from "./followup-recovery";
import { replyIntent } from "../agents/smartlead-responder/reply-intent";
import { htmlToText } from "../routes/client-dashboard";
import {
  autoSend,
  defaultDeckLookup,
  linkWorks,
  type AutoSendMessage,
} from "./auto-send";
import { vantageEnabled, vantageContext } from "./vantage";
import { ReplyPreflightError } from "./delivery";
import { humanDisposition } from "./card-actions";

const logger = createLogger("ReplyRecovery");

async function notifyConfirmed(
  client: ReplybotClientConfig,
  email: string,
): Promise<void> {
  if (!client.slackChannelId) return;
  try {
    const { slackPostMessage } = await import(
      "../agents/smartlead-responder/index"
    );
    const safe = email
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    await slackPostMessage(client, {
      channel: client.slackChannelId,
      text: `Reply confirmed for ${safe}.`,
    });
  } catch (error) {
    logger.warn("reply_recovery.notice_failed", { error: String(error) });
  }
}

export function answeredSince(
  messages: ThreadMessage[],
  receivedAt: string,
): boolean {
  const received = Date.parse(receivedAt);
  return (
    Number.isFinite(received) &&
    messages.some((m) => m.type === "SENT" && Date.parse(m.time) > received)
  );
}

/** Reconcile receipts and retry current review drafts under the poller's lease. */
export async function reconcileReplyResults(
  client: ReplybotClientConfig,
  send: (
    client: ReplybotClientConfig,
    message: AutoSendMessage,
  ) => Promise<void> = async (c, m) => {
    const adapter = await import("../agents/smartlead-responder/slack-actions");
    await adapter.sendReplyEmail(c, m);
  },
): Promise<void> {
  const ws = clayWorkspace(client);
  if (!ws) return;
  await flushVantageReceipts(client.clientId);
  await reconcileFollowups(client);
  for (const row of await pendingResults(client.clientId)) {
    try {
      if (!row.lead_id || !row.campaign_id) {
        if (row.state === "done") {
          await reconcileResultState(row.row_id, "done", "done");
          continue;
        }
        await reconcileResultState(
          row.row_id,
          row.state,
          row.state === "failed" ? "failed" : "awaiting_review",
        );
        continue;
      }
      const messages = await thread(
        client.clientId,
        ws.workspaceId,
        row.campaign_id,
        row.lead_id,
      );
      // Keep every confirmed send's logging obligation even when the investor
      // has since answered or this reply card was already marked done.
      for (const sent of messages.filter(
        (m) =>
          m.type === "SENT" && Date.parse(m.time) > Date.parse(row.received_at),
      )) {
        await retainVantageReceipt(client.clientId, row.from_address, sent);
        await settleDeckPromises(
          client,
          {
            to: row.from_address,
            leadId: row.lead_id,
            campaignId: row.campaign_id,
          },
          sent,
          row.received_at,
          messages,
        );
      }
      // Receipt backfill must never reopen a terminal card.
      if (row.state === "done") {
        await reconcileResultState(row.row_id, "done", "done");
        continue;
      }
      // A manual reply also settles an old card, but a newer inbound reply
      // remains work for intake and cannot be hidden by an older send.
      const latestInbound = Math.max(
        ...[Date.parse(row.received_at)].filter(Number.isFinite),
        ...messages
          .filter((m) => m.type === "REPLY")
          .map((m) => Date.parse(m.time))
          .filter(Number.isFinite),
      );
      if (!Number.isFinite(latestInbound)) {
        await reconcileResultState(row.row_id, row.state, "awaiting_review");
        continue;
      }
      const currentInbound = messages
        .filter((message) => message.type === "REPLY")
        .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))[0];
      const disposition =
        currentInbound && Date.parse(currentInbound.time) === latestInbound
          ? await humanDisposition(
              client.clientId,
              row.from_address,
              row.campaign_id,
              new Date(latestInbound).toISOString(),
              currentInbound.messageId,
            )
          : null;
      if (disposition) {
        await reconcileResultState(
          row.row_id,
          row.state,
          disposition === "closed" ? "done" : "awaiting_review",
        );
        continue;
      }
      if (
        currentInbound &&
        replyIntent(htmlToText(currentInbound.body || "")).isDeliveryFailure
      ) {
        await reconcileResultState(row.row_id, row.state, "awaiting_review");
        continue;
      }
      const answered = answeredSince(
        messages,
        new Date(latestInbound).toISOString(),
      );
      if (answered) {
        const sent = messages
          .filter(
            (m) => m.type === "SENT" && Date.parse(m.time) > latestInbound,
          )
          .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))[0];
        await scheduleConversationFollowup(
          client,
          {
            to: row.from_address,
            leadId: row.lead_id,
            campaignId: row.campaign_id,
          },
          sent,
          new Date(latestInbound).toISOString(),
          messages,
        );
        await reconcileResultState(row.row_id, row.state, "done");
        if (["delivery_unknown", "processing"].includes(row.state))
          await notifyConfirmed(client, row.from_address);
      } else {
        const latestReply = messages
          .filter((message) => message.type === "REPLY")
          .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))[0];
        const intent = latestReply
          ? replyIntent(htmlToText(String(latestReply.body || "")))
          : null;
        const kind = intent?.kind;
        if (kind && ["pass", "ignore"].includes(kind)) {
          await reconcileResultState(row.row_id, row.state, "done");
          continue;
        }
        if (row.state === "failed") {
          await reconcileResultState(row.row_id, row.state, "failed");
          continue;
        }
        if (
          client.clientId === "zeutara" &&
          client.autopilot &&
          !process.env.REPLIES_FORCE_CLIENT_ID?.trim() &&
          row.state === "awaiting_review" &&
          row.draft.trim() &&
          Date.parse(row.received_at) === latestInbound &&
          currentInbound?.messageId &&
          Date.parse(currentInbound.time) === latestInbound &&
          kind &&
          ["deck", "question", "interested"].includes(kind)
        ) {
          const full = await getReplyItem(row.row_id);
          if (
            full?.client_id === client.clientId &&
            (await claimReviewedReply(client.clientId, row.row_id, row.draft))
          ) {
            let attempted = false;
            try {
              const outcome = await autoSend(client, full, row.draft, {
                send: async (c, message) => {
                  await saveExpectedReply(
                    row.row_id,
                    message.body,
                    client.clientId,
                  );
                  attempted = true;
                  await send(c, message);
                },
                deckFor: defaultDeckLookup,
                linkWorks,
                ...(vantageEnabled(client.clientId)
                  ? { vantage: { context: vantageContext } }
                  : {}),
              });
              await finishReplyResult(
                row.row_id,
                outcome.sent ? "done" : "awaiting_review",
                client.clientId,
              );
              if (outcome.sent)
                await notifyConfirmed(
                  client,
                  full.from_address || row.from_address,
                );
            } catch (error) {
              await finishReplyResult(
                row.row_id,
                attempted && !(error instanceof ReplyPreflightError)
                  ? "delivery_unknown"
                  : "awaiting_review",
                client.clientId,
              );
              logger.warn("reply_recovery.review_retry_failed", {
                rowId: row.row_id,
                error: String(error),
              });
            }
            continue;
          }
        }
        const state =
          row.state === "delivery_unknown" || row.state === "needs_draft"
            ? row.state
            : "awaiting_review";
        await reconcileResultState(row.row_id, row.state, state);
      }
    } catch (error) {
      logger.warn("reply_recovery.failed", {
        rowId: row.row_id,
        error: String(error),
      });
    }
  }
}
