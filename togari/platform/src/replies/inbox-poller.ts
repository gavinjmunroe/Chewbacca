/**
 * Read every reply straight from the client's Clay master inbox and hand any
 * Togari has never seen to its own /replies intake.
 *
 * 2026-10-13: Ryan's "waiting on us" list had 13 investors. Togari had never
 * received 2 of them at all, and across the week the Clay feeder delivered 36
 * of the 91 people who replied. The feeder lives in a Clay column nobody could
 * find, so Togari now reads the inbox itself every few minutes and stops
 * depending on it.
 *
 * Safety, because these become emails to investors:
 * - Only threads where they wrote after our last email (nobody answered yet).
 * - Skipped when Togari already holds a reply from that address at that time,
 *   whichever source brought it in, so nobody is answered twice.
 * - Old auto-replies are left alone: only replies from the last 48 hours, or
 *   older ones the sequencer did not file as a pass, opt-out, out-of-office
 *   or wrong person. A backfill of week-old passes would have posted dozens of
 *   lines into the client channel at once.
 * Everything else, the classifying, drafting, deck and Vantage checks, is the
 * same /replies path the feeder uses.
 */
import {
  clayClients,
  clayWorkspace,
  getReplybotClient,
  type ReplybotClientConfig,
} from "../agents/replybot/client-config";
import { inboxReplies, thread } from "../integrations/clay/campaign-read";
import { htmlToText, SETTLED_CATEGORIES } from "../routes/client-dashboard";
import { hasReplyFromSince } from "./store";
import { BigQueryClient } from "../bigquery/client";
import { createLogger } from "../observability/logger";
import { reconcileReplyResults } from "./result-recovery";

const logger = createLogger("InboxPoller");

// The dashboard refresh reads the same inbox every 10 minutes; 5 keeps a new
// reply under ~5 minutes from arriving to being handled (guessed, never measured).
const EVERY_MS = 5 * 60_000;
const FRESH_MS = 48 * 3_600_000;

export interface PollResult {
  open: number;
  posted: number;
  skipped: number;
  /** Dry runs only: what would have been handed to /replies. */
  would: Array<{
    from: string;
    campaign: string;
    receivedAt: string;
    said: string;
  }>;
}

export async function pollClient(
  client: ReplybotClientConfig,
  opts: { now?: number; dryRun?: boolean } = {},
): Promise<PollResult> {
  const now = opts.now ?? Date.now();
  const would: PollResult["would"] = [];
  const live = clayWorkspace(client);
  const viaReplybot = client.clay?.intake === "replybot";
  const token = (
    (viaReplybot
      ? process.env[client.webhookSecretEnv || ""]
      : process.env.REPLIES_INGEST_TOKEN) || ""
  ).trim();
  if (!live || (!token && !opts.dryRun))
    return { open: 0, posted: 0, skipped: 0, would };
  const port = process.env.PORT || "4000";
  const all = await inboxReplies(client.clientId, live.workspaceId);
  const since = Date.parse(client.clay?.pollSince || "") || 0;
  const open = all.filter(
    (r) =>
      r.campaignName.startsWith(live.campaignPrefix) &&
      Date.parse(r.lastReply) >= since &&
      r.lastReply &&
      (!r.lastSent || Date.parse(r.lastReply) > Date.parse(r.lastSent)) &&
      (now - Date.parse(r.lastReply) < FRESH_MS ||
        !SETTLED_CATEGORIES.has(r.category)),
  );
  let posted = 0;
  let skipped = 0;
  for (const r of open) {
    // Togari deletes a negative reply once it's handled (replies.deleted_negative),
    // so a missing row is not proof it was never seen: on 2026-10-14 Teresa's
    // "No" was handed over, deleted, and handed over again 5 minutes later. The
    // poller keeps its own record of every reply it has passed on.
    if (
      (await alreadyHanded(client.clientId, r.leadEmail, r.lastReply)) ||
      (await hasReplyFromSince(
        client.clientId,
        r.leadEmail,
        r.lastReply,
        r.emailCampaignId,
        r.emailLeadId,
      ))
    ) {
      skipped++;
      continue;
    }
    const msgs = await thread(
      client.clientId,
      live.workspaceId,
      r.emailCampaignId,
      r.emailLeadId,
    );
    let replyAt = -1;
    msgs.forEach((m, i) => {
      if (m.type === "REPLY") replyAt = i;
    });
    if (replyAt < 0) continue;
    const reply = msgs[replyAt];
    const ours = msgs
      .slice(0, replyAt)
      .reverse()
      .find((m) => m.type === "SENT");
    const body = htmlToText(reply.body).trim();
    if (!body) continue;
    // The feeder keys a row on the message id of our email they answered; the
    // same key here means a later feeder POST is a plain duplicate.
    const rowId =
      reply.messageId ||
      `inbox:${r.emailCampaignId}:${r.emailLeadId}:${r.lastReply}`;
    if (opts.dryRun) {
      would.push({
        from: r.leadEmail,
        campaign: r.campaignName,
        receivedAt: reply.time || r.lastReply,
        said: body.slice(0, 120),
      });
      continue;
    }
    const res = viaReplybot
      ? await fetch(
          `http://127.0.0.1:${port}/replybot/${client.clientId}/webhook`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-replybot-key": token,
            },
            // The body BMA's Clay column sent (docs/BMA_REPLYBOT_CLAY_COLUMN.md).
            body: JSON.stringify({
              to_email: r.leadEmail,
              campaign_name: r.campaignName,
              subject: reply.subject || ours?.subject || null,
              text: body,
              message_id: reply.messageId || null,
              original_outbound: ours ? htmlToText(ours.body).trim() : null,
              from_email: ours?.from || null,
              time_replied: reply.time || r.lastReply,
              campaign_id: r.emailCampaignId,
              lead_id: r.emailLeadId,
            }),
          },
        )
      : await fetch(`http://127.0.0.1:${port}/replies`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            row_id: rowId,
            body,
            campaign: r.campaignName,
            thread_id: rowId,
            from: r.leadEmail,
            sender_account: ours?.from || null,
            subject: ours?.subject || null,
            received_at: reply.time || r.lastReply,
            lead_id: r.emailLeadId,
            campaign_id: r.emailCampaignId,
            client_id: client.clientId,
          }),
        });
    if (res.ok) {
      posted++;
      await markHanded(client.clientId, r.leadEmail, r.lastReply);
    } else
      logger.warn("inbox_poller.post_failed", {
        status: res.status,
        from: r.leadEmail,
      });
  }
  if (!opts.dryRun) await reconcileReplyResults(client);
  return { open: open.length, posted, skipped, would };
}

/**
 * One poller at a time across every running copy of Togari. On 2026-10-14 the
 * first deploy logged "listening on port 8080" twice, 5s apart, and both copies
 * queued the same 4 replies within a second (Jeremy Jonker, North Coast,
 * Croson, Ganas), deleted by hand before any went out. A lease row in BigQuery
 * decides: UPDATEs on one table run one after another, so only the first copy
 * whose lease has expired takes it.
 */
const LEASE_TABLE = `\`${process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3"}.togari_data_lake.poller_leases\``;
const ME = `${process.env.RAILWAY_REPLICA_ID || "local"}:${process.pid}:${Math.random().toString(36).slice(2, 8)}`;

const HANDED_TABLE = `\`${process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3"}.togari_data_lake.poller_handed\``;

function leaseBq(): BigQueryClient {
  return new BigQueryClient(
    process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3",
    null,
    process.env.GCP_CREDENTIALS_BASE64 ||
      process.env.GOOGLE_CREDENTIALS_BASE64 ||
      null,
  );
}

export async function alreadyHanded(
  clientId: string,
  from: string,
  lastReply: string,
): Promise<boolean> {
  const { rows } = (await leaseBq().executeQuery(
    `SELECT 1 AS hit FROM ${HANDED_TABLE}
      WHERE client_id = @clientId AND LOWER(from_address) = LOWER(@from) AND last_reply = TIMESTAMP(@lastReply) LIMIT 1`,
    { clientId, from, lastReply },
  )) as unknown as { rows: unknown[] };
  return (rows?.length ?? 0) > 0;
}

export async function markHanded(
  clientId: string,
  from: string,
  lastReply: string,
): Promise<void> {
  await leaseBq().executeWrite(
    `INSERT INTO ${HANDED_TABLE} (client_id, from_address, last_reply, handed_at)
     VALUES (@clientId, LOWER(@from), TIMESTAMP(@lastReply), CURRENT_TIMESTAMP())`,
    { clientId, from, lastReply },
  );
}

export async function takeLease(
  name: string,
  ms: number,
  me: string = ME,
): Promise<boolean> {
  const bq = new BigQueryClient(
    process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3",
    null,
    process.env.GCP_CREDENTIALS_BASE64 ||
      process.env.GOOGLE_CREDENTIALS_BASE64 ||
      null,
  );
  await bq.executeWrite(
    `UPDATE ${LEASE_TABLE} SET holder = @me, until = TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL @secs SECOND)
      WHERE name = @name AND (until IS NULL OR until < CURRENT_TIMESTAMP())`,
    { me, name, secs: Math.round(ms / 1000) },
  );
  const { rows } = (await bq.executeQuery(
    `SELECT holder FROM ${LEASE_TABLE} WHERE name = @name`,
    { name },
  )) as unknown as {
    rows: Array<{ holder: string }>;
  };
  return rows?.[0]?.holder === me;
}

export function startInboxPoller(clientIds = clayClients("pollReplies")): void {
  if (process.env.INBOX_POLLER_OFF === "1") return;
  const tick = () => {
    for (const id of clientIds) {
      const client = getReplybotClient(id);
      if (!client || !clayWorkspace(client)) continue;
      // The lease outlives one poll and expires before the next tick.
      takeLease(`inbox:${id}`, EVERY_MS - 30_000)
        .then((mine) => (mine ? pollClient(client) : null))
        .then((r) => {
          if (r?.posted)
            logger.info("inbox_poller.posted", { clientId: id, ...r });
        })
        .catch((err) =>
          logger.warn("inbox_poller.failed", {
            clientId: id,
            error: String(err),
          }),
        );
    }
  };
  setTimeout(tick, 30_000).unref();
  setInterval(tick, EVERY_MS).unref();
}
