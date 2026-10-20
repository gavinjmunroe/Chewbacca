/**
 * Read a client's LinkedIn campaigns from HeyReach's public API: the campaign
 * list, each campaign's numbers by day, and the inbox's conversations. Read
 * only; nothing here sends, pauses or changes anything.
 *
 * POST https://api.heyreach.io/api/public/..., X-API-KEY header. Field names
 * were checked against Serif's account on 2026-10-14 with
 * scripts/check-heyreach.ts; the readers still take close variants and treat a
 * missing field as zero or empty, so a renamed field shows as a gap, not a
 * crash. Two things the live response showed: a conversation doesn't say which
 * campaign it came from, so they're asked for one campaign at a time, and
 * HeyReach tags leads itself ("Interested", "Not interested").
 */

const API = "https://api.heyreach.io/api/public";
// HeyReach allows 300 calls a minute; 15s means it is down, and the page
// says LinkedIn couldn't load rather than hanging (guessed, never measured).
const TIMEOUT_MS = 15_000;
const PAGE = 100;

export interface HeyReachCampaign {
  id: string;
  name: string;
  /** HeyReach's own status, e.g. IN_PROGRESS, PAUSED, FINISHED, DRAFT. */
  status: string;
}

/** One campaign's numbers for one day. */
export interface HeyReachDay {
  requests: number;
  accepted: number;
  /** Conversations started: people messaged, by message or InMail. */
  messaged: number;
  /** Messages and InMails sent, follow-ups included. */
  messagesSent: number;
  replied: number;
}

export interface HeyReachConversation {
  campaignId: string;
  leadName: string | null;
  leadUrl: string | null;
  /** Whether the lead wrote the last message. */
  leadWroteLast: boolean;
  lastAt: string | null;
  /** The lead's latest message, for sorting. Never stored. */
  leadText: string | null;
  leadAt: string | null;
  /** HeyReach's own tag on the lead for this campaign, e.g. "Interested". */
  tag: string | null;
}

async function call(apiKey: string, path: string, body: unknown): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 401 || res.status === 403)
    throw new Error("HeyReach refused the API key");
  if (!res.ok) throw new Error(`HeyReach answered ${res.status} for ${path}`);
  return res.json();
}

const num = (x: unknown) =>
  typeof x === "number" && isFinite(x) ? x : Number(x) || 0;
const text = (x: unknown) =>
  typeof x === "string" && x.trim() ? x.trim() : null;
const itemsOf = (res: any): any[] =>
  res?.items ?? res?.data ?? res?.result?.items ?? res?.result?.data ?? [];

export async function listCampaigns(
  apiKey: string,
  maxPages = 10,
): Promise<HeyReachCampaign[]> {
  const out: HeyReachCampaign[] = [];
  for (let page = 0; page < maxPages; page++) {
    const rows = itemsOf(
      await call(apiKey, "/campaign/GetAll", { offset: page * PAGE, limit: PAGE }),
    );
    for (const c of rows) {
      if (c?.id == null) continue;
      out.push({
        id: String(c.id),
        name: text(c.name) || `Campaign ${c.id}`,
        status: String(c.status || "").toUpperCase(),
      });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * A campaign's numbers by day, keyed YYYY-MM-DD. HeyReach keys its days by
 * midnight UTC, so these are UTC days.
 */
export async function dailyStats(
  apiKey: string,
  campaignId: string,
  from: string,
  to: string,
): Promise<Record<string, HeyReachDay>> {
  const res = await call(apiKey, "/stats/GetOverallStats", {
    accountIds: [],
    campaignIds: [Number(campaignId)],
    startDate: `${from}T00:00:00.000Z`,
    endDate: `${to}T23:59:59.999Z`,
  });
  const byDay = res?.byDayStats ?? res?.result?.byDayStats ?? {};
  const out: Record<string, HeyReachDay> = {};
  for (const [key, d] of Object.entries<any>(byDay)) {
    const day = String(key).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    out[day] = {
      requests: num(d?.connectionsSent),
      accepted: num(d?.connectionsAccepted),
      messaged: num(d?.totalMessageStarted) + num(d?.totalInmailStarted),
      messagesSent: num(d?.messagesSent) + num(d?.inmailMessagesSent),
      replied: num(d?.totalMessageReplies) + num(d?.totalInmailReplies),
    };
  }
  return out;
}

/** HeyReach marks our own messages "ME"; anything else is the lead. */
function fromLead(sender: unknown): boolean {
  const s = String(sender ?? "").trim().toUpperCase();
  return s !== "" && s !== "ME" && s !== "SENDER" && s !== "OWNER";
}

export function readConversation(
  c: any,
  campaignId: string,
): HeyReachConversation {
  const p = c?.correspondentProfile ?? c?.correspondent ?? c?.lead ?? {};
  const tags: any[] = Array.isArray(p.autoTags) ? p.autoTags : [];
  const tag =
    tags.find((t) => String(t?.campaignId) === campaignId) ??
    tags.find((t) => t?.campaignId == null);
  const name =
    [text(p.firstName), text(p.lastName)].filter(Boolean).join(" ") ||
    text(p.fullName) ||
    text(p.name);
  const messages: any[] = Array.isArray(c?.messages) ? c.messages : [];
  const lastLead = [...messages].reverse().find((m) => fromLead(m?.sender));
  const leadWroteLast = fromLead(c?.lastMessageSender);
  return {
    campaignId,
    leadName: name || null,
    leadUrl: text(p.profileUrl) || text(p.linkedInUrl) || text(p.url),
    leadWroteLast,
    lastAt: text(c?.lastMessageAt),
    leadText: lastLead
      ? text(lastLead.body) || text(lastLead.text) || text(lastLead.message)
      : leadWroteLast
        ? text(c?.lastMessageText)
        : null,
    leadAt: lastLead
      ? text(lastLead.createdAt) || text(lastLead.sentAt) || text(lastLead.time)
      : leadWroteLast
        ? text(c?.lastMessageAt)
        : null,
    tag: text(tag?.name),
  };
}

/**
 * One campaign's conversations, newest first, up to maxPages. Asked for one
 * campaign at a time because a conversation doesn't carry its campaign.
 */
export async function conversations(
  apiKey: string,
  campaignId: string,
  maxPages = 10,
): Promise<HeyReachConversation[]> {
  const out: HeyReachConversation[] = [];
  for (let page = 0; page < maxPages; page++) {
    const rows = itemsOf(
      await call(apiKey, "/inbox/GetConversationsV2", {
        filters: { campaignIds: [Number(campaignId)] },
        offset: page * PAGE,
        limit: PAGE,
      }),
    );
    out.push(...rows.map((r) => readConversation(r, campaignId)));
    if (rows.length < PAGE) break;
  }
  return out;
}
