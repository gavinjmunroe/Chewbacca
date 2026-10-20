/**
 * The LinkedIn half of the campaign calendar, read from the client's HeyReach
 * account when the page is built (src/integrations/heyreach/client.ts).
 *
 * A LinkedIn campaign's bar runs from its first to its last day with any
 * activity this month (requests, messages or InMails). Its week numbers are
 * HeyReach's own: connection requests, accepts, people messaged and replies,
 * so the reply rate matches HeyReach's (replies / people messaged). Replies are
 * sorted from each lead's latest message with the same rules as email, with
 * HeyReach's own tag settling the ones those rules call interest or can't
 * sort (linkedinOutcome). A
 * conversation is waiting on an answer while the lead wrote last and their
 * message is interest or couldn't be sorted. HeyReach's days are UTC.
 */
import {
  conversations,
  dailyStats,
  listCampaigns,
  type HeyReachConversation,
} from "../integrations/heyreach/client";
import { replyOutcome, type ReplyOutcome } from "./events";
import type { CampaignSpan, Waiting } from "./calendar";

export interface LinkedInWeek {
  requests: number;
  accepted: number;
  messaged: number;
  replied: number;
  interested: number;
  needs_read: number;
  later: number;
  pass: number;
  opt_out: number;
  redirect: number;
  ooo: number;
}

export interface LinkedInPart {
  campaigns: CampaignSpan[];
  /** week start -> campaign id (or "*") -> numbers. */
  weeks: Record<string, Record<string, LinkedInWeek>>;
  /** day -> campaign id (or "*") -> requests, messages and InMails sent. */
  daily: Record<string, Record<string, number>>;
  waiting: Waiting[];
}

/** LinkedIn campaign ids carry a prefix so they never collide with Clay's. */
export const linkedinId = (heyreachId: string) => `li:${heyreachId}`;

const empty = (): LinkedInWeek => ({
  requests: 0,
  accepted: 0,
  messaged: 0,
  replied: 0,
  interested: 0,
  needs_read: 0,
  later: 0,
  pass: 0,
  opt_out: 0,
  redirect: 0,
  ooo: 0,
});

// Same window as email's waiting list (calendar.ts WAITING_SQL).
const WAITING_DAYS = 90;
// Four campaigns' stats at a time keeps well under HeyReach's 300 calls a minute.
const PARALLEL = 4;

type Api = {
  listCampaigns: typeof listCampaigns;
  dailyStats: typeof dailyStats;
  conversations: typeof conversations;
};

const DEFAULT_API: Api = { listCampaigns, dailyStats, conversations };

function dayIn(tz: string, iso: string): string | null {
  const t = Date.parse(iso);
  if (isNaN(t)) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(t);
}

function mondayOf(day: string): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  const dow = (new Date(t).getUTCDay() + 6) % 7;
  return new Date(t - dow * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The text rules decide anything specific (out of office, opt-out, referral,
 * a clear no). HeyReach's tag only settles what they call interest or can't
 * sort: on Serif's account (2026-10-14) its tags were "Interested" and "Not
 * interested", and it tagged short warm replies the rules couldn't read.
 */
export function linkedinOutcome(
  text: string | null,
  tag: string | null,
): ReplyOutcome {
  const byText = replyOutcome(text, null);
  if (byText !== "interested" && byText !== "needs_read") return byText;
  const t = (tag || "").trim().toLowerCase();
  if (/^not\s+interested/.test(t)) return "pass";
  if (t === "interested") return "interested";
  return byText;
}

/** A LinkedIn profile link, or null for anything that isn't one. */
export function safeLinkedInUrl(url: string | null): string | null {
  return url && /^https:\/\/([a-z]{2,3}\.)?linkedin\.com\//i.test(url)
    ? url
    : null;
}

export async function linkedinFor(
  apiKey: string,
  opts: { from: string; to: string; tz: string; now?: number },
  api: Api = DEFAULT_API,
): Promise<LinkedInPart> {
  const { from, to, tz } = opts;
  const now = opts.now ?? Date.now();
  // A draft has never run, so it has nothing to draw.
  const all = (await api.listCampaigns(apiKey)).filter(
    (c) => c.status !== "DRAFT",
  );

  const weeks: LinkedInPart["weeks"] = {};
  const daily: LinkedInPart["daily"] = {};
  const week = (w: string, key: string) =>
    ((weeks[w] ||= {})[key] ||= empty());
  const campaigns: CampaignSpan[] = [];

  for (let i = 0; i < all.length; i += PARALLEL) {
    const batch = all.slice(i, i + PARALLEL);
    const stats = await Promise.all(
      batch.map((c) => api.dailyStats(apiKey, c.id, from, to)),
    );
    batch.forEach((c, j) => {
      const key = linkedinId(c.id);
      let first: string | null = null;
      let last: string | null = null;
      for (const [day, d] of Object.entries(stats[j])) {
        if (day < from || day > to) continue;
        const active = d.requests + d.messagesSent;
        if (active > 0) {
          if (!first || day < first) first = day;
          if (!last || day > last) last = day;
          const row = (daily[day] ||= {});
          row[key] = (row[key] || 0) + active;
          row["*"] = (row["*"] || 0) + active;
        }
        for (const k of [key, "*"]) {
          const w = week(mondayOf(day), k);
          w.requests += d.requests;
          w.accepted += d.accepted;
          w.messaged += d.messaged;
          w.replied += d.replied;
        }
      }
      if (first && last) {
        campaigns.push({
          id: key,
          name: c.name,
          channel: "linkedin",
          status: c.status,
          first_send: first,
          last_send: last,
          planned_start: null,
          planned_end: null,
        });
      }
    });
  }

  const names = new Map(all.map((c) => [c.id, c.name]));
  const convos: HeyReachConversation[] = [];
  for (let i = 0; i < all.length; i += PARALLEL) {
    const batch = await Promise.all(
      all.slice(i, i + PARALLEL).map((c) => api.conversations(apiKey, c.id)),
    );
    for (const list of batch) convos.push(...list);
  }
  const waiting: Waiting[] = [];
  const cutoff = now - WAITING_DAYS * 86_400_000;
  for (const c of convos) {
    if (!c.leadAt) continue;
    const day = dayIn(tz, c.leadAt);
    if (!day) continue;
    const key = linkedinId(c.campaignId);
    const outcome: ReplyOutcome = linkedinOutcome(c.leadText, c.tag);
    if (day >= from && day <= to && outcome !== "auto") {
      for (const k of [key, "*"]) week(mondayOf(day), k)[outcome] += 1;
    }
    if (
      c.leadWroteLast &&
      (outcome === "interested" || outcome === "needs_read") &&
      Date.parse(c.leadAt) >= cutoff
    ) {
      waiting.push({
        lead: c.leadUrl || c.leadName || "LinkedIn lead",
        name: c.leadName,
        campaign_id: key,
        campaign: names.get(c.campaignId) ?? null,
        outcome,
        at: new Date(Date.parse(c.leadAt)).toISOString(),
        day,
        channel: "linkedin",
        url: safeLinkedInUrl(c.leadUrl),
      });
    }
  }
  waiting.sort((a, b) => a.at.localeCompare(b.at));
  return { campaigns, weeks, daily, waiting };
}
