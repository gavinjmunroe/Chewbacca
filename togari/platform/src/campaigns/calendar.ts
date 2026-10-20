/**
 * The numbers behind the campaign calendar (/dash/<token>/calendar): one month
 * of a client's campaigns, with each week's sends, replies and outcomes per
 * campaign, and who is still waiting on an answer.
 *
 * Everything comes from campaign_events (Clay's Events tables, streamed in by
 * /campaign-events) and reply_card_actions (what was clicked on each Slack
 * card). Weeks run Monday to Sunday in the client's own timezone.
 *
 * Reply rate is per person, and out-of-office and other automatic replies are
 * not replies: people who replied that week / people emailed that week. Clay's
 * own dashboard counts out-of-office as a reply, so it reads higher.
 */
import { BigQueryClient } from "../bigquery/client";
import { resolveDataset } from "../services/dataset-resolver";
import { getReplybotClient } from "../agents/replybot/client-config";
import { cardActionsTable } from "../replies/card-actions";
import { EVENTS_TABLE } from "./events";
import { linkedinFor, type LinkedInWeek } from "./linkedin";
import { applyPlans, listPlans, type Plan } from "./plans";
import { createLogger } from "../observability/logger";

const logger = createLogger("campaigns/calendar");

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";
const T = (name: string) => `\`${PROJECT_ID}.${resolveDataset()}.${name}\``;

/** Reply outcomes shown under the calendar, in the order they're listed. */
export const OUTCOMES = [
  "interested",
  "needs_read",
  "later",
  "pass",
  "opt_out",
  "redirect",
  "ooo",
] as const;

export interface WeekStats {
  sent: number;
  /** People emailed. */
  leads: number;
  /** People who replied, out-of-office and automatic replies left out. */
  replied: number;
  interested: number;
  needs_read: number;
  later: number;
  pass: number;
  opt_out: number;
  redirect: number;
  ooo: number;
  bounces: number;
}

/** "plan" is a conference added on the page with no campaign of its name yet. */
export type Channel = "email" | "linkedin" | "plan";

export interface CampaignSpan {
  id: string;
  name: string;
  channel: Channel;
  /**
   * The campaign's own status: HeyReach's for LinkedIn, the latest Clay event's
   * for email. Without one the page reads the campaign's dates.
   */
  status?: string | null;
  first_send: string | null;
  last_send: string | null;
  planned_start: string | null;
  planned_end: string | null;
}

export interface Waiting {
  lead: string;
  name: string | null;
  campaign_id: string;
  campaign: string | null;
  outcome: string;
  /** When their reply came in, ISO. */
  at: string;
  /** The same, as the client's calendar day. */
  day: string;
  channel: Channel;
  /** A LinkedIn lead's profile. */
  url?: string | null;
}

export interface FollowUp {
  name: string | null;
  email: string | null;
  day: string;
}

export interface CalendarSnapshot {
  client: string;
  clientId: string;
  month: string;
  tz: string;
  as_of: string;
  today: string;
  /** Every day on the grid, Monday first, whole weeks. */
  days: string[];
  campaigns: CampaignSpan[];
  /** week start -> campaign id (or "*" for all) -> numbers. */
  weeks: Record<string, Record<string, WeekStats>>;
  /** day -> campaign id (or "*") -> emails sent. */
  daily: Record<string, Record<string, number>>;
  waiting: Waiting[];
  followups: FollowUp[];
  /** Every conference added on the page, earliest first. */
  plans: Plan[];
  /** LinkedIn from HeyReach, or null for a client without it. */
  linkedin: {
    weeks: Record<string, Record<string, LinkedInWeek>>;
    daily: Record<string, Record<string, number>>;
  } | null;
  /** Anything that couldn't be loaded, said plainly on the page. */
  notes: string[];
}

// ── Dates (calendar days as YYYY-MM-DD, arithmetic in UTC) ────────

const DAY_MS = 86_400_000;
const at = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

export function addDays(day: string, n: number): string {
  return iso(at(day) + n * DAY_MS);
}

/** Monday = 0 … Sunday = 6. */
export function weekday(day: string): number {
  return (new Date(at(day)).getUTCDay() + 6) % 7;
}

export function weekStart(day: string): string {
  return addDays(day, -weekday(day));
}

export function todayIn(tz: string, now = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** A YYYY-MM from the query string, or the current month. */
export function parseMonth(raw: unknown, today: string): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  return /^20[2-9]\d-(0[1-9]|1[0-2])$/.test(s) ? s : today.slice(0, 7);
}

export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  return iso(Date.UTC(y, m - 1 + n, 1)).slice(0, 7);
}

/** The month's days padded out to whole Monday-to-Sunday weeks. */
export function monthDays(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const last = iso(Date.UTC(y, m, 0));
  const end = addDays(last, 6 - weekday(last));
  const days: string[] = [];
  for (let d = weekStart(first); d <= end; d = addDays(d, 1)) days.push(d);
  return days;
}

// ── Queries ───────────────────────────────────────────────────────

/** A campaign's key: Clay's id, or its name when the column sent no id. */
const KEY = "COALESCE(NULLIF(campaign_id, ''), campaign_name, '')";

/**
 * The client's events, one row per event: inserts are streamed, so a retry
 * Clay sent after BigQuery's dedupe window is dropped here.
 */
function events(where: string): string {
  return `ev AS (
    SELECT *, ${KEY} AS ckey, DATE(occurred_at, @tz) AS day,
           COALESCE(lead_email, event_id) AS who
      FROM ${T(EVENTS_TABLE)}
     WHERE client_id = @clientId ${where}
    QUALIFY ROW_NUMBER() OVER (PARTITION BY event_id ORDER BY received_at) = 1
  )`;
}

const IN_RANGE = `AND occurred_at >= TIMESTAMP_SUB(TIMESTAMP(@from), INTERVAL 1 DAY)
       AND occurred_at < TIMESTAMP_ADD(TIMESTAMP(@to), INTERVAL 2 DAY)`;

const STATS = [
  "COUNTIF(event_type = 'sent') AS sent",
  "COUNT(DISTINCT IF(event_type = 'sent', who, NULL)) AS leads",
  "COUNT(DISTINCT IF(event_type = 'reply' AND outcome NOT IN ('ooo', 'auto'), who, NULL)) AS replied",
  ...OUTCOMES.map(
    (o) =>
      `COUNT(DISTINCT IF(event_type = 'reply' AND outcome = '${o}', who, NULL)) AS ${o}`,
  ),
  "COUNTIF(event_type = 'bounce') AS bounces",
].join(",\n    ");

export const WEEKLY_SQL = `WITH ${events(IN_RANGE)},
  wk AS (
    SELECT *, DATE_TRUNC(day, WEEK(MONDAY)) AS week
      FROM ev WHERE day BETWEEN DATE(@from) AND DATE(@to)
  )
  SELECT CAST(week AS STRING) AS week, ckey,
    ${STATS}
    FROM wk GROUP BY week, ckey
  UNION ALL
  SELECT CAST(week AS STRING) AS week, '*' AS ckey,
    ${STATS}
    FROM wk GROUP BY week`;

export const DAILY_SQL = `WITH ${events(IN_RANGE)}
  SELECT CAST(day AS STRING) AS day, ckey, COUNT(*) AS sent
    FROM ev
   WHERE event_type = 'sent' AND day BETWEEN DATE(@from) AND DATE(@to)
   GROUP BY day, ckey`;

export const SPANS_SQL = `WITH ${events("")}
  SELECT ckey,
    ARRAY_AGG(campaign_name IGNORE NULLS ORDER BY occurred_at DESC LIMIT 1)[SAFE_OFFSET(0)] AS name,
    CAST(MIN(IF(event_type = 'sent', day, NULL)) AS STRING) AS first_send,
    CAST(MAX(IF(event_type = 'sent', day, NULL)) AS STRING) AS last_send,
    CAST(MAX(planned_start) AS STRING) AS planned_start,
    CAST(MAX(planned_end) AS STRING) AS planned_end,
    ARRAY_AGG(campaign_status IGNORE NULLS ORDER BY occurred_at DESC LIMIT 1)[SAFE_OFFSET(0)] AS campaign_status
    FROM ev GROUP BY ckey`;

/**
 * Each person's latest reply in the last 90 days, when it needs a person
 * (interested, or the rules couldn't sort it) and nobody has sent, skipped or
 * marked done a card for them since. Ten minutes of slack covers Clay's event
 * time trailing the moment the reply actually arrived.
 */
export const WAITING_SQL = `WITH ${events(
  "AND event_type = 'reply' AND lead_email IS NOT NULL AND occurred_at > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY)",
)},
  latest AS (
    SELECT * FROM ev WHERE TRUE
    QUALIFY ROW_NUMBER() OVER (PARTITION BY lead_email ORDER BY occurred_at DESC) = 1
  )
  SELECT l.lead_email AS lead, l.lead_name AS name, l.ckey AS campaign_id,
         l.campaign_name AS campaign, l.outcome,
         FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', l.occurred_at) AS replied_at,
         CAST(l.day AS STRING) AS day
    FROM latest l
   WHERE l.outcome IN ('interested', 'needs_read')
     AND NOT EXISTS (
       SELECT 1 FROM ${cardActionsTable()} a
        WHERE a.client_id = @clientId
          AND a.lead_email = l.lead_email
          AND a.acted_at >= TIMESTAMP_SUB(l.occurred_at, INTERVAL 10 MINUTE)
     )
   ORDER BY l.occurred_at`;

export const FOLLOWUPS_SQL = `SELECT lead_name AS name, lead_email AS email,
         CAST(DATE(due_at, @tz) AS STRING) AS day
    FROM ${T("reply_followups")}
   WHERE client_id = @clientId AND status = 'scheduled'
     AND DATE(due_at, @tz) BETWEEN DATE(@from) AND DATE(@to)
   ORDER BY due_at`;

function bq(): BigQueryClient {
  return new BigQueryClient(
    PROJECT_ID,
    null,
    process.env.GCP_CREDENTIALS_BASE64 ||
      process.env.GOOGLE_CREDENTIALS_BASE64 ||
      null,
  );
}

async function rows(
  sql: string,
  params: Record<string, unknown>,
): Promise<any[]> {
  return (await bq().executeQuery(sql, params)).rows as any[];
}

const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String((v as { value?: unknown }).value ?? v);
  return s || null;
};

function weekStats(r: any): WeekStats {
  const n = (k: string) => Number(r[k] || 0);
  return {
    sent: n("sent"),
    leads: n("leads"),
    replied: n("replied"),
    interested: n("interested"),
    needs_read: n("needs_read"),
    later: n("later"),
    pass: n("pass"),
    opt_out: n("opt_out"),
    redirect: n("redirect"),
    ooo: n("ooo"),
    bounces: n("bounces"),
  };
}

/** The span a campaign covers on the calendar: planned dates and sends together. */
export function spanOf(c: CampaignSpan): { from: string; to: string } | null {
  const starts = [c.first_send, c.planned_start].filter(Boolean) as string[];
  const ends = [c.last_send, c.planned_end].filter(Boolean) as string[];
  if (!starts.length || !ends.length) return null;
  return { from: starts.sort()[0], to: ends.sort().reverse()[0] };
}

export async function buildCalendar(
  clientId: string,
  month: string,
  now = Date.now(),
): Promise<CalendarSnapshot> {
  const client = getReplybotClient(clientId);
  if (!client?.campaignCalendar)
    throw new Error(`No campaign calendar configured for ${clientId}`);
  const tz = client.voice.timezone || "America/New_York";
  const heyreach = client.campaignCalendar.heyreach;
  const days = monthDays(month);
  const from = days[0];
  const to = days[days.length - 1];
  const range = { clientId, tz, from, to };
  // Email and LinkedIn load apart, so one missing never blanks the other:
  // Serif's LinkedIn went live before the Clay columns existed (2026-10-14).
  // What failed is said once, after everything has loaded.
  let emailFailed = false;
  let waitingFailed = false;
  let liNote: string | null = null;
  const email = (sql: string, params: Record<string, unknown>) =>
    rows(sql, params).catch((err) => {
      if (!emailFailed)
        logger.warn("calendar.email_failed", { clientId, error: String(err) });
      emailFailed = true;
      return [];
    });

  const linkedin = heyreach
    ? (() => {
        const key = process.env[heyreach.apiKeyEnv];
        if (!key) {
          logger.warn("calendar.heyreach_key_missing", {
            clientId,
            env: heyreach.apiKeyEnv,
          });
          liNote = "LinkedIn numbers aren't connected yet.";
          return Promise.resolve(null);
        }
        return linkedinFor(key, { from, to, tz, now }).catch((err) => {
          logger.warn("calendar.linkedin_failed", {
            clientId,
            error: String(err),
          });
          liNote = "LinkedIn numbers couldn't be loaded just now.";
          return null;
        });
      })()
    : Promise.resolve(null);

  let plansFailed = false;
  const plansRead = () =>
    listPlans(clientId).catch((err) => {
      logger.warn("calendar.plans_failed", { clientId, error: String(err) });
      plansFailed = true;
      return [] as Plan[];
    });

  const [weekRows, dayRows, spanRows, waitRows, followRows, li, plans] = await Promise.all(
    [
      email(WEEKLY_SQL, range),
      email(DAILY_SQL, range),
      email(SPANS_SQL, { clientId, tz }),
      rows(WAITING_SQL, { clientId, tz }).catch((err) => {
        logger.warn("calendar.waiting_failed", { clientId, error: String(err) });
        waitingFailed = true;
        return [];
      }),
      // Only clients on reply autopilot have follow-ups; the table may be empty.
      rows(FOLLOWUPS_SQL, range).catch((err) => {
        logger.warn("calendar.followups_failed", {
          clientId,
          error: String(err),
        });
        return [];
      }),
      linkedin,
      plansRead(),
    ],
  );
  const notes: string[] = [];
  if (emailFailed) notes.push("Email numbers couldn't be loaded just now.");
  else if (waitingFailed)
    notes.push("Who is waiting on an email answer couldn't be loaded just now.");
  if (liNote) notes.push(liNote);
  if (plansFailed) notes.push("Conferences couldn't be loaded just now.");

  const weeks: CalendarSnapshot["weeks"] = {};
  for (const r of weekRows) {
    const w = str(r.week)!;
    (weeks[w] ||= {})[String(r.ckey ?? "")] = weekStats(r);
  }
  const daily: CalendarSnapshot["daily"] = {};
  for (const r of dayRows) {
    const d = str(r.day)!;
    const sent = Number(r.sent || 0);
    const row = (daily[d] ||= {});
    row[String(r.ckey ?? "")] = sent;
    row["*"] = (row["*"] || 0) + sent;
  }
  const campaigns: CampaignSpan[] = applyPlans([
    ...spanRows.map((r) => ({
      id: String(r.ckey ?? ""),
      name: str(r.name) || String(r.ckey || "Unnamed campaign"),
      channel: "email" as const,
      first_send: str(r.first_send),
      last_send: str(r.last_send),
      planned_start: str(r.planned_start),
      planned_end: str(r.planned_end),
      status: str(r.campaign_status),
    })),
    ...(li?.campaigns ?? []),
  ], plans)
    .filter((c) => {
      const s = spanOf(c);
      return s !== null && s.from <= to && s.to >= from;
    })
    .sort(
      (a, b) =>
        spanOf(a)!.from.localeCompare(spanOf(b)!.from) ||
        a.name.localeCompare(b.name),
    );

  return {
    client: client.displayName,
    clientId,
    month,
    tz,
    as_of: new Date(now).toISOString(),
    today: todayIn(tz, now),
    days,
    campaigns,
    weeks,
    daily,
    waiting: [
      ...waitRows.map((r) => ({
        lead: String(r.lead),
        name: str(r.name),
        campaign_id: String(r.campaign_id ?? ""),
        campaign: str(r.campaign),
        outcome: String(r.outcome),
        at: String(r.replied_at),
        day: String(r.day),
        channel: "email" as const,
      })),
      ...(li?.waiting ?? []),
    ].sort((a, b) => a.at.localeCompare(b.at)),
    followups: followRows.map((r) => ({
      name: str(r.name),
      email: str(r.email),
      day: String(r.day),
    })),
    linkedin: li ? { weeks: li.weeks, daily: li.daily } : null,
    plans,
    notes,
  };
}

// Several people refreshing one page shouldn't each run five queries; five
// minutes is fresh enough for numbers that move a few times an hour.
const TTL_MS = 5 * 60_000;
// Rebuilt a little inside the TTL so an open page never waits on a build: one
// with HeyReach took 5 to 20s from the Mac on 2026-10-14.
const REFRESH_MS = 4 * 60_000;
const cache = new Map<string, { at: number; snap: CalendarSnapshot }>();

export async function calendarFor(
  clientId: string,
  month: string,
): Promise<CalendarSnapshot> {
  const key = `${clientId}:${month}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.snap;
  const snap = await buildCalendar(clientId, month);
  cache.set(key, { at: Date.now(), snap });
  return snap;
}

/**
 * Keep this month's calendar built for every client with a link and a
 * calendar, so the page opens from memory. Other months build when asked.
 */
export function startCalendarRefresh(): void {
  const clients = () => {
    try {
      return [
        ...new Set(
          Object.values(JSON.parse(process.env.DASHBOARD_TOKENS || "{}")).map(
            String,
          ),
        ),
      ].filter((id) => getReplybotClient(id)?.campaignCalendar);
    } catch {
      return [];
    }
  };
  const tick = () => {
    for (const id of clients()) {
      const tz = getReplybotClient(id)!.voice.timezone || "America/New_York";
      const month = todayIn(tz).slice(0, 7);
      buildCalendar(id, month)
        .then((snap) => cache.set(`${id}:${month}`, { at: Date.now(), snap }))
        .catch((err) =>
          logger.warn("calendar.refresh_failed", { clientId: id, error: String(err) }),
        );
    }
  };
  tick();
  setInterval(tick, REFRESH_MS).unref();
}

/** Drop a client's built months, so a change made on the page shows at once. */
export function forgetCalendars(clientId: string): void {
  for (const key of [...cache.keys()])
    if (key.startsWith(`${clientId}:`)) cache.delete(key);
}

/** The last good build, for when BigQuery is down. */
export function staleCalendar(
  clientId: string,
  month: string,
): CalendarSnapshot | null {
  return cache.get(`${clientId}:${month}`)?.snap ?? null;
}
