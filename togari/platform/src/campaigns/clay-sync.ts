/**
 * Fill a client's campaign calendar straight from their Clay Sequencer, so the
 * calendar does not depend on an HTTP column on an Events table.
 *
 * 2026-10-16: campaign_events held no rows at all. Serif's campaigns run on
 * Clay's Sequencer, whose only Events table held Clay's 9 example rows, so the
 * columns had nothing to send. The Sequencer has no per-lead list of sends;
 * what it has is each campaign's sends and bounces per day (analytics/day-wise,
 * which summed to the campaign's own 677 on Aggregate Arcadia), and every
 * reply in the master inbox. So:
 *
 * - A day's sends become that many rows, numbered, "clay:sent:<campaign>:<day>:<n>".
 *   Re-reading the day adds only the rows past what is stored. A send row has
 *   no lead, so "people emailed" in a week counts a person sent two steps that
 *   week twice.
 * - Bounces the same way.
 * - Each reply is one row, sorted by its own text with the rules the reply
 *   cards use, Clay's category deciding when there is no text.
 * - A campaign's status is a row of its own whenever Clay's changes.
 *
 * The calendar's queries read these exactly as they read the columns' rows.
 */
import {
  clayClients,
  clayWorkspace,
  getReplybotClient,
} from "../agents/replybot/client-config";
import {
  dayWiseStats,
  inboxReplies,
  sequencerCampaigns,
  thread,
  type SequencerCampaign,
} from "../integrations/clay/campaign-read";
import { htmlToText } from "../routes/client-dashboard";
import { BigQueryClient } from "../bigquery/client";
import { resolveDataset } from "../services/dataset-resolver";
import { takeLease } from "../replies/inbox-poller";
import { createLogger } from "../observability/logger";
import { EVENTS_TABLE, eventRow, insertCampaignEvents } from "./events";

const logger = createLogger("campaigns/clay-sync");

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";
const EVERY_MS = 10 * 60_000;
// Clay's day totals for the last few days can still grow (late bounces).
const RECENT_DAYS = 3;
// A first sync reaches back this far (guessed: covers Serif's 2026 campaigns).
const BACKFILL_DAYS = 180;
// Thread reads per run, for reply text. A backfill finishes over a few runs.
const MAX_THREADS = 40;
const DAY_MS = 86_400_000;

const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

function todayIn(tz: string, now: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Numbered rows for what Clay counts that is not stored yet. */
export function countRows(
  kind: "sent" | "bounce",
  campaign: SequencerCampaign,
  day: string,
  have: number,
  total: number,
): Array<{ event_id: string; occurred_at: string }> {
  const out = [];
  // Noon UTC is the same calendar day in every US timezone.
  for (let n = have + 1; n <= total; n++)
    out.push({
      event_id: `clay:${kind}:${campaign.id}:${day}:${n}`,
      occurred_at: `${day}T12:00:00.000Z`,
    });
  return out;
}

/** Could this campaign have sent anything between from and to? */
export function mightHaveSent(
  c: SequencerCampaign,
  from: string,
  to: string,
): boolean {
  if (c.createdAt && c.createdAt.slice(0, 10) > to) return false;
  if (c.status.toUpperCase() === "ACTIVE") return true;
  // Paused, stopped or done: its last change bounds its last send.
  return !c.updatedAt || c.updatedAt.slice(0, 10) >= from;
}

function bq(): BigQueryClient {
  return new BigQueryClient(
    PROJECT_ID,
    null,
    process.env.GCP_CREDENTIALS_BASE64 ||
      process.env.GOOGLE_CREDENTIALS_BASE64 ||
      null,
  );
}

const TABLE = () => `\`${PROJECT_ID}.${resolveDataset()}.${EVENTS_TABLE}\``;

interface Stored {
  any: boolean;
  /** "<kind>|<campaign>|<day>" -> rows stored. */
  counts: Map<string, number>;
  replies: Set<string>;
  status: Map<string, string>;
}

async function stored(clientId: string, from: string): Promise<Stored> {
  const counts = new Map<string, number>();
  const replies = new Set<string>();
  const status = new Map<string, string>();
  const { rows } = (await bq().executeQuery(
    `SELECT event_type, campaign_id, SPLIT(event_id, ':')[SAFE_OFFSET(3)] AS day,
            COUNT(DISTINCT event_id) AS n, ANY_VALUE(event_id) AS one
       FROM ${TABLE()}
      WHERE client_id = @clientId AND STARTS_WITH(event_id, 'clay:')
        AND (event_type IN ('reply', 'status') OR occurred_at >= TIMESTAMP(@from))
      GROUP BY 1, 2, 3, IF(event_type IN ('reply', 'status'), event_id, NULL)`,
    { clientId, from },
  )) as unknown as { rows: Array<Record<string, unknown>> };
  for (const r of rows || []) {
    const type = String(r.event_type);
    if (type === "reply") replies.add(String(r.one));
    else if (type === "status") {
      // clay:status:<campaign>:<status>:<when>; the latest wins below.
      const [, , cid, st, when] = String(r.one).split(":");
      const prev = status.get(cid);
      if (!prev || prev.split("|")[1] < when) status.set(cid, `${st}|${when}`);
    } else
      counts.set(`${type}|${r.campaign_id}|${r.day}`, Number(r.n || 0));
  }
  return { any: (rows || []).length > 0, counts, replies, status };
}

export interface SyncResult {
  campaigns: number;
  sent: number;
  bounces: number;
  replies: number;
  statuses: number;
}

export async function syncClayCalendar(
  clientId: string,
  now = Date.now(),
): Promise<SyncResult> {
  const client = getReplybotClient(clientId);
  const ws = client && clayWorkspace(client);
  if (!client || !ws) throw new Error(`No Clay workspace for ${clientId}`);
  const tz = client.voice.timezone || "America/New_York";
  const to = todayIn(tz, now);
  const backfillFrom = isoDay(Date.parse(`${to}T00:00:00Z`) - BACKFILL_DAYS * DAY_MS);
  const have = await stored(clientId, backfillFrom);
  const from = have.any
    ? isoDay(Date.parse(`${to}T00:00:00Z`) - RECENT_DAYS * DAY_MS)
    : backfillFrom;
  const ours = (name: string) => name.startsWith(ws.campaignPrefix);
  const campaigns = (await sequencerCampaigns(clientId, ws.workspaceId)).filter(
    (c) => ours(c.name),
  );
  const byId = new Map(campaigns.map((c) => [String(c.id), c]));
  const rows: Array<Record<string, unknown>> = [];
  const base = (c: SequencerCampaign | undefined, campaignId: string) => ({
    client_id: clientId,
    campaign_id: campaignId,
    campaign_name: c?.name ?? null,
    campaign_status: c?.status || null,
  });
  const result: SyncResult = {
    campaigns: 0,
    sent: 0,
    bounces: 0,
    replies: 0,
    statuses: 0,
  };

  for (const c of campaigns) {
    const cid = String(c.id);
    const last = have.status.get(cid)?.split("|")[0];
    if (c.status && last !== c.status) {
      const row = eventRow(
        {
          ...base(c, cid),
          event_id: `clay:status:${cid}:${c.status}:${new Date(now).toISOString().replace(/:/g, "")}`,
          event_type: "status",
          occurred_at: new Date(now).toISOString(),
        },
        new Date(now),
      );
      if (row) rows.push(row), result.statuses++;
    }
    if (!mightHaveSent(c, from, to)) continue;
    result.campaigns++;
    for (const d of await dayWiseStats(
      clientId,
      ws.workspaceId,
      c.id,
      from,
      to,
      tz,
    )) {
      for (const [kind, total] of [
        ["sent", d.sent],
        ["bounce", d.bounced],
      ] as const) {
        const fresh = countRows(
          kind,
          c,
          d.day,
          have.counts.get(`${kind}|${cid}|${d.day}`) ?? 0,
          total,
        );
        for (const f of fresh) {
          const row = eventRow(
            { ...base(c, cid), ...f, event_type: kind },
            new Date(now),
          );
          if (row) rows.push(row);
        }
        if (kind === "sent") result.sent += fresh.length;
        else result.bounces += fresh.length;
      }
    }
  }

  // A first sync reads deeper into the inbox; after that 20 pages is plenty.
  const inbox = (
    await inboxReplies(clientId, ws.workspaceId, have.any ? 400 : 4000)
  ).filter(
    (r) => ours(r.campaignName) && r.lastReply && r.lastReply.slice(0, 10) >= from,
  );
  let threads = 0;
  for (const r of inbox) {
    const id = `clay:reply:${r.emailCampaignId}:${r.emailLeadId}:${r.lastReply}`;
    if (have.replies.has(id)) continue;
    if (threads >= MAX_THREADS) break;
    threads++;
    const msgs = await thread(
      clientId,
      ws.workspaceId,
      r.emailCampaignId,
      r.emailLeadId,
    ).catch(() => []);
    const reply = [...msgs].reverse().find((m) => m.type === "REPLY");
    const cid = String(r.emailCampaignId);
    const row = eventRow(
      {
        ...base(byId.get(cid), cid),
        campaign_name: r.campaignName || byId.get(cid)?.name || null,
        event_id: id,
        event_type: "reply",
        lead_email: r.leadEmail,
        occurred_at: reply?.time || r.lastReply,
        reply_text: reply ? htmlToText(reply.body) : null,
        reply_category: r.category ? String(r.category) : null,
      },
      new Date(now),
    );
    if (row) rows.push(row), result.replies++;
  }

  if (rows.length) await insertCampaignEvents(rows);
  return result;
}

export function startClayCalendarSync(
  clientIds = clayClients("syncCalendar"),
): void {
  if (process.env.CLAY_CALENDAR_SYNC_OFF === "1") return;
  const tick = () => {
    for (const id of clientIds)
      // One copy of Togari at a time, or two would both add the same rows.
      takeLease(`calendar-sync:${id}`, EVERY_MS - 30_000)
        .then((mine) => (mine ? syncClayCalendar(id) : null))
        .then((r) => {
          if (r && (r.sent || r.bounces || r.replies || r.statuses))
            logger.info("clay_sync.added", { clientId: id, ...r });
        })
        .catch((err) =>
          logger.warn("clay_sync.failed", {
            clientId: id,
            error: String(err),
          }),
        );
  };
  setTimeout(tick, 90_000).unref();
  setInterval(tick, EVERY_MS).unref();
}
