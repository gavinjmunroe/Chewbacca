/**
 * The client dashboard at /dash/<token>: outbound numbers per company and the
 * investor conversations in motion, for clients who never open Clay.
 *
 * Ryan Korn (Zeutara), on the 2026-10-13 call: "a quick dashboard that can
 * summarize our exact clients, how many emails went out, how many bounced,
 * how many went through, the response rate, how many meetings were lined up".
 *
 * Togari builds every view itself from Clay (integrations/clay/campaign-read)
 * on the server, so it never depends on anyone's laptop being awake: Caleb,
 * 2026-10-13, "The dashboard shouldn't be dependent on us". DASHBOARD_TOKENS
 * is a JSON map of token -> client id; removing a token revokes its link.
 *
 * 2026-10-16 rebuild: the first version read the inbox's last-sent time, which
 * misses Togari's own replies, so investors we had answered showed as waiting
 * on us, and it counted out-of-office notes as replies. Every thread is now
 * read, and only a person's reply counts.
 */
import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { getReplybotClient } from "../agents/replybot/client-config";
import { replyIntent } from "../agents/smartlead-responder/reply-intent";
import { vantageContext, vantageEnabled } from "../replies/vantage";
import {
  campaignStats,
  inboxReplies,
  thread,
  type ThreadMessage,
} from "../integrations/clay/campaign-read";

export interface CompanyRow {
  company: string;
  reached: number;
  sent: number;
  replied: number;
  reply_rate: number;
  bounces: number;
  bounce_rate: number;
}

export type ConversationStatus = "needs_reply" | "answered";

export interface ThreadLine {
  from: "them" | "us";
  at: string;
  text: string;
}

export interface Conversation {
  name: string;
  company: string;
  wants: string;
  said: string;
  since: string;
  status: ConversationStatus;
  kind?: string;
  /** The last few messages, oldest first, own words only. */
  thread?: ThreadLine[];
  /** What would turn this into a meeting and isn't in Vantage yet. */
  blocker?: string | null;
}

export interface CampaignRow {
  name: string;
  company: string;
  status: string;
  sent: number;
  replies: number;
  bounces: number;
}

export interface DashboardSnapshot {
  client: string;
  as_of: string;
  totals: { reached: number; sent: number; replied: number; bounces: number };
  companies: CompanyRow[];
  campaigns?: CampaignRow[];
  conversations: Conversation[];
  threads_read: number;
  threads_total: number;
}

export function clientForToken(
  token: string,
  raw = process.env.DASHBOARD_TOKENS,
): string | null {
  if (!/^[a-f0-9]{32,64}$/.test(token)) return null;
  try {
    const map = JSON.parse(raw || "{}") as Record<string, unknown>;
    const id = map[token];
    return typeof id === "string" && /^[a-z0-9_]+$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function companyOf(campaign: string): string {
  return (campaign.split("|")[1] || "").trim();
}

export function htmlToText(html: string): string {
  // Scan each tag once. Embedded image attributes can exceed a megabyte;
  // a tag-length cap leaves their base64 ahead of the investor's actual words.
  const parts: string[] = [];
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf("<", cursor);
    if (start < 0) {
      parts.push(html.slice(cursor));
      break;
    }
    parts.push(html.slice(cursor, start));
    const end = html.indexOf(">", start + 1);
    if (end < 0) {
      parts.push(html.slice(start));
      break;
    }
    const tag = html.slice(start, Math.min(end + 1, start + 64));
    if (/^<br\b|^<\/(div|p)\s*>/i.test(tag)) parts.push("\n");
    cursor = end + 1;
  }
  return parts
    .join("")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

/** Their own words: the part above the quoted thread, one line, clipped. */
export function ownWords(body: string, n = 220): string {
  const top = htmlToText(body).split(
    /\n\s*(?:On .{0,160}wrote:|From:|-----|>)/,
  )[0];
  const t = top.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…";
}

const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : 0);

// The sequencer's reply categories that need nothing from us. Mapped on
// 2026-10-13 by reading all 74 open Zeutara threads: 3 was every pass ("No",
// "not a fit", "we don't do SAFEs"), 4 unsubscribes and left-the-firm notices,
// 6 out of office, 7 wrong person, dead mailbox or bounce. 1, 2 and 5 held the
// replies that show interest or ask something, and 0 is uncategorized. The
// inbox poller uses this; the dashboard reads every thread instead.
export const SETTLED_CATEGORIES = new Set([3, 4, 6, 7]);

// Every thread is read in the background refresh. Zeutara had 123 inbox
// threads on 2026-10-16; at 6 at a time and about 1s each that is ~20s,
// which the 10-minute refresh absorbs. The cap only protects against a
// runaway inbox.
const MAX_THREADS = 250;
// Replies inside a minute of our email are machines answering it. On
// 2026-10-16, 16 of 21 "waiting" investors replied 2 to 20 seconds after
// our send. Guessed bound, never measured on a human reply.
const AUTO_REPLY_MS = 60_000;
// The kinds that are a conversation, not a closed door.
const CONVERSATION_KINDS = new Set([
  "question",
  "interested",
  "deck",
  "form",
  "later",
  "referral",
  "unclear",
]);

export interface ThreadReading {
  human: boolean;
  conversation: boolean;
  status: ConversationStatus;
  wants: string;
  said: string;
  at: string;
  kind: string;
  thread: ThreadLine[];
}

/** What one thread says about this investor, or null with no reply in it. */
export function readThread(
  messages: ThreadMessage[],
  leadEmail: string,
  companyName: string,
  copy: NonNullable<Parameters<typeof replyIntent>[1]>["client"],
): ThreadReading | null {
  const byTime = [...messages].sort(
    (a, b) => Date.parse(a.time) - Date.parse(b.time),
  );
  const replies = byTime.filter((m) => m.type === "REPLY");
  const last = replies.at(-1);
  if (!last) return null;
  const lastAt = Date.parse(last.time);
  const intent = replyIntent(htmlToText(last.body), {
    leadEmail,
    companyName,
    client: copy,
  });
  // A person replied at all if any reply in the thread is not a machine's.
  const human = replies.some((reply) => {
    const at = Date.parse(reply.time);
    const before = byTime
      .filter((m) => m.type === "SENT" && Date.parse(m.time) <= at)
      .at(-1);
    const fast = before && at - Date.parse(before.time) < AUTO_REPLY_MS;
    const kind = replyIntent(htmlToText(reply.body), { leadEmail });
    return !fast && !kind.isDeliveryFailure && !kind.isAway;
  });
  const lastFast = byTime
    .filter((m) => m.type === "SENT" && Date.parse(m.time) <= lastAt)
    .at(-1);
  const lastIsMachine =
    (lastFast && lastAt - Date.parse(lastFast.time) < AUTO_REPLY_MS) ||
    intent.isDeliveryFailure ||
    intent.isAway;
  const answered = byTime.some(
    (m) =>
      (m.type === "SENT" || m.type === "FORWARD") &&
      Date.parse(m.time) > lastAt,
  );
  return {
    human,
    conversation:
      human && !lastIsMachine && CONVERSATION_KINDS.has(intent.kind),
    status: answered ? "answered" : "needs_reply",
    wants: intent.label,
    said: ownWords(last.body),
    at: last.time,
    kind: intent.kind,
    thread: byTime
      .filter((m) => m.type === "SENT" || m.type === "REPLY")
      .slice(-6)
      .map((m) => ({
        from: m.type === "REPLY" ? ("them" as const) : ("us" as const),
        at: m.time,
        text: ownWords(m.body, 600),
      }))
      .filter((m) => m.text),
  };
}

/**
 * The one thing missing from Vantage that stands between this investor and a
 * meeting, or null. On 2026-10-16 every yes stalled for want of founder times
 * or a deck, and nobody could see it without opening Vantage.
 */
export function meetingBlocker(
  kind: string | undefined,
  policy: { hasDeck: boolean; bookingUrl: string | null } | undefined | null,
): string | null {
  if (!policy) return null;
  if (kind === "deck" && !policy.hasDeck) return "Deck isn't in Vantage yet";
  if ((kind === "interested" || kind === "question") && !policy.bookingUrl)
    return "Founder booking link isn't in Vantage yet";
  return null;
}

async function once<T>(work: () => Promise<T>): Promise<T> {
  // Clay's frontend API times a call out at 15s; the 2026-10-16 refresh
  // failed on one AbortError and kept the whole page stale.
  try {
    return await work();
  } catch {
    return work();
  }
}

export async function buildSnapshot(
  clientId: string,
): Promise<DashboardSnapshot> {
  const client = getReplybotClient(clientId);
  const live = client?.live;
  if (!client || !live)
    throw new Error(`No Clay workspace configured for ${clientId}`);
  const ws = live.clayWorkspaceId;
  const ours = (name: string) => name.startsWith(live.campaignPrefix);

  const [stats, replies] = await Promise.all([
    once(() => campaignStats(clientId, ws)),
    once(() => inboxReplies(clientId, ws)),
  ]);
  const mine = replies
    .filter((r) => ours(r.campaignName) && r.emailCampaignId && r.emailLeadId)
    .sort((a, b) => b.lastReply.localeCompare(a.lastReply));

  const byCompany = new Map<string, CompanyRow>();
  for (const c of stats.filter((s) => ours(s.name) && s.sent > 0)) {
    const name = companyOf(c.name) || c.name;
    const row = byCompany.get(name) || {
      company: name,
      reached: 0,
      sent: 0,
      replied: 0,
      reply_rate: 0,
      bounces: 0,
      bounce_rate: 0,
    };
    // A campaign that loaded 140 investors and sent 12 emails reached 12
    // (four September campaigns did exactly that), so reach is capped by sends.
    row.reached += Math.min(c.leads, c.sent);
    row.sent += c.sent;
    row.bounces += c.bounces;
    byCompany.set(name, row);
  }

  const reading = mine.slice(0, MAX_THREADS);
  const humans = new Map<string, Set<string>>();
  const conversations: Conversation[] = [];
  let read = 0;
  for (let i = 0; i < reading.length; i += 6) {
    const batch = await Promise.all(
      reading.slice(i, i + 6).map(async (r) => {
        const msgs = await thread(
          clientId,
          ws,
          r.emailCampaignId,
          r.emailLeadId,
        ).catch(() => null);
        return { r, msgs };
      }),
    );
    for (const { r, msgs } of batch) {
      if (!msgs) continue;
      read++;
      const company = companyOf(r.campaignName);
      const seen = readThread(msgs, r.leadEmail, company, client.replyCopy);
      if (!seen?.human) continue;
      if (!humans.has(company)) humans.set(company, new Set());
      humans.get(company)!.add(r.leadEmail.toLowerCase());
      if (seen.conversation)
        conversations.push({
          name: r.leadEmail,
          company,
          wants: seen.wants,
          said: seen.said,
          since: seen.at,
          status: seen.status,
          kind: seen.kind,
          thread: seen.thread,
        });
    }
  }
  // What Vantage holds for each open conversation, so the page can say what
  // stands between a yes and a meeting. A Vantage outage leaves it unsaid.
  if (vantageEnabled(clientId)) {
    for (let i = 0; i < conversations.length; i += 6) {
      await Promise.all(
        conversations.slice(i, i + 6).map(async (c) => {
          const ctx = await vantageContext(c.name).catch(() => null);
          c.blocker = meetingBlocker(c.kind, ctx?.policy);
        }),
      );
    }
  }
  const campaigns: CampaignRow[] = stats
    .filter((s) => ours(s.name) && s.sent > 0)
    .map((s) => ({
      name: s.name.split("|").slice(2).join("|").trim() || s.name,
      company: companyOf(s.name),
      status: s.status.toLowerCase(),
      sent: s.sent,
      replies: s.replies,
      bounces: s.bounces,
    }))
    .sort(
      (a, b) =>
        Number(b.status === "active") - Number(a.status === "active") ||
        b.sent - a.sent,
    );
  for (const row of byCompany.values()) {
    row.replied = humans.get(row.company)?.size || 0;
    row.reply_rate = pct(row.replied, row.reached);
    row.bounce_rate = pct(row.bounces, row.sent);
  }
  const companies = [...byCompany.values()].sort((a, b) => b.sent - a.sent);
  // Needs a reply first, then newest.
  conversations.sort(
    (a, b) =>
      Number(a.status === "answered") - Number(b.status === "answered") ||
      b.since.localeCompare(a.since),
  );
  return {
    client: client.displayName,
    as_of: new Date().toISOString(),
    totals: {
      reached: companies.reduce((s, c) => s + c.reached, 0),
      sent: companies.reduce((s, c) => s + c.sent, 0),
      replied: companies.reduce((s, c) => s + c.replied, 0),
      bounces: companies.reduce((s, c) => s + c.bounces, 0),
    },
    companies,
    campaigns,
    conversations,
    threads_read: read,
    threads_total: mine.length,
  };
}

const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] as string,
  );

const n = (x: unknown) => Number(x || 0).toLocaleString("en-US");

function ago(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (isNaN(t)) return "";
  const h = (now - t) / 3_600_000;
  if (h < 24) return `${Math.max(1, Math.round(h))}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "1 day ago" : `${d} days ago`;
}

export function renderDashboard(
  s: DashboardSnapshot,
  now = Date.now(),
  calendarHref?: string,
  nonce = "",
): string {
  const t = s.totals;
  const open = s.conversations.filter((c) => c.status === "needs_reply");
  const tile = (label: string, value: string, sub: string, accent = false) =>
    `<div class="tile${accent ? " accent" : ""}"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div><div class="sub">${esc(sub)}</div></div>`;
  const maxSent = Math.max(1, ...s.companies.map((c) => c.sent));
  const rows = s.companies
    .map(
      (c) =>
        `<tr><td class="co">${esc(c.company)}<div class="bar"><span style="width:${Math.round((100 * c.sent) / maxSent)}%"></span></div></td><td>${n(c.reached)}</td><td>${n(c.sent)}</td><td>${n(c.replied)}</td><td class="strong">${esc(c.reply_rate)}%</td><td>${esc(c.bounce_rate)}%</td></tr>`,
    )
    .join("");
  const blocked = s.conversations.filter((c) => c.blocker);
  const line = (m: ThreadLine) =>
    `<div class="msg ${m.from}"><div class="meta">${m.from === "them" ? "Investor" : "Us"} · ${esc(ago(m.at, now))}</div><div class="body">${esc(m.text)}</div></div>`;
  const card = (c: Conversation) =>
    `<div class="item ${c.status}${c.blocker ? " blocked" : ""}" data-co="${esc(c.company)}" data-status="${c.status}" data-q="${esc(`${c.name} ${c.company} ${c.said} ${c.wants}`.toLowerCase())}">
<button class="head" type="button" aria-expanded="false"><div class="top"><span class="who">${esc(c.name)}</span><span class="pill">${esc(c.company)}</span><span class="badge">${esc(c.wants)}</span><span class="when">${esc(ago(c.since, now))}</span></div><div class="said">&ldquo;${esc(c.said)}&rdquo;</div><div class="state">${c.status === "answered" ? "We replied. Waiting on them." : "Needs a reply from us."}${c.blocker ? `<span class="block">${esc(c.blocker)}</span>` : ""}</div></button>
${c.thread?.length ? `<div class="thread">${c.thread.map(line).join("")}</div>` : ""}</div>`;
  const convo = s.conversations.length
    ? s.conversations.map(card).join("")
    : `<div class="empty">No open investor conversations right now.</div>`;
  const companiesInConvo = [...new Set(s.conversations.map((c) => c.company))]
    .filter(Boolean)
    .sort();
  const chip = (
    key: string,
    value: string,
    label: string,
    count: number,
    on = false,
  ) =>
    `<button type="button" class="chip${on ? " on" : ""}" data-${key}="${esc(value)}">${esc(label)}<span>${n(count)}</span></button>`;
  const filters = `<div class="filters" role="toolbar" aria-label="Filter conversations">
${chip("status", "all", "All", s.conversations.length, true)}${chip("status", "needs_reply", "Needs us", open.length)}${chip("status", "answered", "Waiting on them", s.conversations.length - open.length)}${chip("status", "blocked", "Meeting blocked", blocked.length)}
<span class="sep"></span>${companiesInConvo.map((co) => chip("co", co, co, s.conversations.filter((c) => c.company === co).length)).join("")}
<input class="search" type="search" placeholder="Search investors or what they said" aria-label="Search conversations"></div>`;
  const campaignRows = (s.campaigns || [])
    .map(
      (c) =>
        `<tr><td class="co">${esc(c.name)}<div class="dim">${esc(c.company)}</div></td><td><span class="status ${esc(c.status)}">${esc(c.status)}</span></td><td>${n(c.sent)}</td><td>${n(c.replies)}</td><td>${esc(pct(c.bounces, c.sent))}%</td></tr>`,
    )
    .join("");
  const partial =
    s.threads_read < s.threads_total
      ? ` ${n(s.threads_read)} of ${n(s.threads_total)} threads were read this refresh.`
      : "";
  const updated = new Date(s.as_of).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(s.client)} outbound</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#0b0d10;--s1:#12151a;--s2:#181c22;--line:#232831;--fg:#eef0f3;--fg2:#a3aab5;--fg3:#6c7480;--accent:#7aa2ff;--warn:#f0a35e;--ok:#6fcf97}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(1200px 600px at 10% -10%,#161a2b 0%,var(--bg) 55%);color:var(--fg);font:15px/1.5 Inter,-apple-system,Segoe UI,sans-serif;-webkit-font-smoothing:antialiased;min-height:100vh}
.wrap{max-width:1080px;margin:0 auto;padding:40px 16px 64px}
h1{font-size:28px;letter-spacing:-.02em;margin:0}h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--fg2);margin:40px 0 12px;font-weight:600}
h2 .count{color:var(--fg3);font-weight:500;margin-left:6px}
.fresh{color:var(--fg3);font-size:13px;margin-top:6px}.fresh a{color:var(--fg2)}
.tiles{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-top:28px}
@media (min-width:640px){.tiles{grid-template-columns:repeat(3,1fr)}}@media (min-width:1000px){.tiles{grid-template-columns:repeat(6,1fr)}}
.tile{background:var(--s1);border:1px solid var(--line);border-radius:14px;padding:16px;transition:border-color .12s}
.tile.accent{border-color:#2b3a63;background:linear-gradient(180deg,#141a2a,var(--s1))}
@media (hover:hover) and (pointer:fine){.tile:hover{border-color:#343b47}}
.label{color:var(--fg2);font-size:12px}.value{font-size:30px;font-weight:700;letter-spacing:-.02em;margin-top:4px}.sub{color:var(--fg3);font-size:12px;margin-top:2px}
.tablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:14px;background:var(--s1)}
table{width:100%;border-collapse:collapse;min-width:600px}th,td{padding:12px 14px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}
th{color:var(--fg3);font-size:12px;font-weight:500}th:first-child,td.co{text-align:left}td.co{font-weight:600}tr:last-child td{border-bottom:0}td.strong{color:var(--accent);font-weight:600}
.bar{height:3px;background:var(--s2);border-radius:2px;margin-top:6px;width:140px}.bar span{display:block;height:3px;background:var(--accent);border-radius:2px;opacity:.7}
.item{background:var(--s1);border:1px solid var(--line);border-left:3px solid var(--line);border-radius:14px;padding:14px 16px;margin-bottom:10px}
.item.needs_reply{border-left-color:var(--warn)}.item.answered{border-left-color:#2c3a33}
.top{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.who{font-weight:600;word-break:break-all}.when{margin-left:auto;color:var(--fg3);font-size:12px}
.pill{font-size:12px;color:var(--fg2);background:var(--s2);border:1px solid var(--line);border-radius:999px;padding:2px 10px}
.badge{font-size:12px;border-radius:999px;padding:2px 10px;border:1px solid #2b3a63;color:var(--accent)}
.said{color:var(--fg2);margin-top:8px;font-size:14px}
.state{font-size:12px;margin-top:8px;color:var(--fg3)}.needs_reply .state{color:var(--warn)}.answered .state{color:var(--ok)}
.empty{color:var(--fg3);padding:16px;border:1px dashed var(--line);border-radius:14px}
.note{color:var(--fg3);font-size:12px;margin-top:40px;line-height:1.6}
.item{padding:0;overflow:hidden}.item .head{all:unset;display:block;width:100%;box-sizing:border-box;padding:14px 16px;cursor:pointer}
.item .head:focus-visible{outline:2px solid var(--accent);outline-offset:-2px;border-radius:12px}
@media (hover:hover) and (pointer:fine){.item .head:hover{background:#151920}}
.item.blocked{border-left-color:#c86a6a}.block{margin-left:10px;color:#e08a8a}.block::before{content:"· "}
.thread{display:none;border-top:1px solid var(--line);padding:12px 16px 16px;background:#0f1216}.item.open .thread{display:block}
.msg{max-width:88%;margin-top:10px;padding:10px 12px;border-radius:12px;border:1px solid var(--line);font-size:14px;color:var(--fg2)}
.msg.us{margin-left:auto;background:#141a2a;border-color:#2b3a63}.msg .meta{font-size:11px;color:var(--fg3);margin-bottom:4px}.msg .body{white-space:pre-wrap}
.filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:14px}.sep{width:1px;height:20px;background:var(--line);margin:0 4px}
.chip{all:unset;cursor:pointer;font-size:13px;color:var(--fg2);border:1px solid var(--line);background:var(--s1);border-radius:999px;padding:5px 12px;transition:border-color .1s,color .1s}
.chip span{color:var(--fg3);margin-left:6px}.chip.on{color:var(--fg);border-color:var(--accent)}.chip:focus-visible{outline:2px solid var(--accent)}
.chip:active{transform:scale(.97)}@media (hover:hover) and (pointer:fine){.chip:hover{border-color:#3a4252}}
.search{flex:1;min-width:200px;background:var(--s1);border:1px solid var(--line);border-radius:10px;padding:8px 12px;color:var(--fg);font:inherit;font-size:14px}
.search:focus{outline:none;border-color:var(--accent)}
.status{font-size:12px;border-radius:999px;padding:2px 10px;border:1px solid var(--line);color:var(--fg2)}.status.active{color:var(--ok);border-color:#2c4a3a}.status.paused{color:var(--warn);border-color:#5a4630}
.dim{color:var(--fg3);font-weight:400;font-size:12px}.hidden{display:none!important}
.live{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--ok);margin-right:8px;vertical-align:middle}
@media (prefers-reduced-motion:no-preference){.live{animation:pulse 2.4s linear infinite}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}}
</style></head><body><div class="wrap">
<h1>${esc(s.client)} outbound</h1>
<div class="fresh"><span class="live"></span>Live from the sending platform and Vantage. <span id="updated" data-asof="${esc(s.as_of)}">Updated ${esc(updated)} Pacific</span>. Refreshes every 10 minutes.${calendarHref ? ` <a href="${esc(calendarHref)}">Campaign calendar</a>` : ""}</div>
<div class="tiles">
${tile("Investors reached", n(t.reached), "across every company")}
${tile("Emails sent", n(t.sent), "first emails and follow ups")}
${tile("Replied", n(t.replied), `${pct(t.replied, t.reached)}% of investors, people only`, true)}
${tile("Open conversations", n(s.conversations.length), open.length ? `${n(open.length)} need a reply from us` : "all answered")}
${tile("Meeting blocked", n(blocked.length), blocked.length ? "missing a deck or booking link in Vantage" : "nothing missing in Vantage")}
${tile("Bounce rate", `${pct(t.bounces, t.sent)}%`, `${n(t.bounces)} of ${n(t.sent)} sends`)}
</div>
<h2>Investor conversations<span class="count">${n(s.conversations.length)}</span></h2>${s.conversations.length ? filters : ""}<div id="convos">${convo}</div><div class="empty hidden" id="nomatch">No conversations match this filter.</div>
<h2>By company</h2>
<div class="tablewrap"><table><thead><tr><th>Company</th><th>Investors reached</th><th>Emails sent</th><th>Replied</th><th>Reply rate</th><th>Bounce rate</th></tr></thead><tbody>${rows}</tbody></table></div>
${campaignRows ? `<h2>Campaigns<span class="count">${n((s.campaigns || []).length)}</span></h2><div class="tablewrap"><table><thead><tr><th>Campaign</th><th>Status</th><th>Emails sent</th><th>Replies</th><th>Bounce rate</th></tr></thead><tbody>${campaignRows}</tbody></table></div>` : ""}
<div class="note">Replied counts each investor once, and only when a person wrote: out-of-office notes, automatic replies and bounces are left out. Investor conversations are the people who asked a question, asked for materials or a meeting, or are still deciding. Passes and unsubscribes are not listed. Open a conversation to read the thread. Meeting blocked means Vantage has no deck or founder booking link for that investor yet. Campaign replies count every reply the platform logged, out-of-office notes included.${partial}</div>
</div>
<script nonce="${esc(nonce)}">
(function(){
var st="all",co=null,q="";
var items=[].slice.call(document.querySelectorAll("#convos .item"));
function apply(){var shown=0;items.forEach(function(el){var ok=(st==="all"||(st==="blocked"?el.classList.contains("blocked"):el.dataset.status===st))&&(!co||el.dataset.co===co)&&(!q||el.dataset.q.indexOf(q)>=0);el.classList.toggle("hidden",!ok);if(ok)shown++;});var nm=document.getElementById("nomatch");if(nm)nm.classList.toggle("hidden",shown>0||!items.length);}
document.querySelectorAll(".chip[data-status]").forEach(function(b){b.addEventListener("click",function(){st=b.dataset.status;document.querySelectorAll(".chip[data-status]").forEach(function(x){x.classList.toggle("on",x===b);});apply();});});
document.querySelectorAll(".chip[data-co]").forEach(function(b){b.addEventListener("click",function(){co=co===b.dataset.co?null:b.dataset.co;document.querySelectorAll(".chip[data-co]").forEach(function(x){x.classList.toggle("on",x.dataset.co===co);});apply();});});
var s=document.querySelector(".search");if(s)s.addEventListener("input",function(){q=s.value.trim().toLowerCase();apply();});
items.forEach(function(el){var h=el.querySelector(".head");if(!h||!el.querySelector(".thread"))return;h.addEventListener("click",function(){var o=el.classList.toggle("open");h.setAttribute("aria-expanded",o?"true":"false");});});
var u=document.getElementById("updated"),at=Date.parse(u&&u.dataset.asof);
function tick(){if(!u||isNaN(at))return;var m=Math.round((Date.now()-at)/60000);u.textContent="Updated "+(m<1?"just now":m+" min ago");if(m>=11&&document.visibilityState==="visible"){var last=0;try{last=+sessionStorage.getItem("dash-reload")||0;}catch(e){last=Date.now();}if(Date.now()-last>540000){try{sessionStorage.setItem("dash-reload",String(Date.now()));}catch(e){return;}location.reload();}}}
tick();setInterval(tick,30000);document.addEventListener("visibilitychange",tick);
})();
</script>
</body></html>`;
}

// One build reads Clay once plus every thread; 10 minutes keeps a page that
// several people refresh from calling Clay on every load.
const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; snap: DashboardSnapshot }>();

export async function snapshotFor(
  clientId: string,
): Promise<DashboardSnapshot> {
  const hit = cache.get(clientId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.snap;
  // A page opened while the cache is stale shows the last good build at once;
  // the shared rebuild replaces it.
  if (hit) {
    rebuild(clientId).catch((err: unknown) =>
      console.warn("dashboard.refresh_failed", clientId, String(err)),
    );
    return hit.snap;
  }
  return rebuild(clientId);
}

// A build reads every thread and took 90s on 2026-10-16, so one build per
// client at a time: page loads and the refresh tick share it.
const inFlight = new Map<string, Promise<DashboardSnapshot>>();

function rebuild(clientId: string): Promise<DashboardSnapshot> {
  const running = inFlight.get(clientId);
  if (running) return running;
  const build = buildSnapshot(clientId)
    .then((snap) => {
      cache.set(clientId, { at: Date.now(), snap });
      return snap;
    })
    .finally(() => inFlight.delete(clientId));
  inFlight.set(clientId, build);
  return build;
}

/**
 * Rebuild every dashboard client's view on the server every TTL, so a page is
 * instant when opened and the Clay session is used, and so renewed, even on
 * days nobody looks. A first build took 4.7s from the Mac on 2026-10-13.
 */
export function startDashboardRefresh(): void {
  const clients = () => {
    try {
      return [
        ...new Set(
          Object.values(JSON.parse(process.env.DASHBOARD_TOKENS || "{}")).map(
            String,
          ),
        ),
        // A calendar-only client has no Clay sign-in for this page to use.
      ].filter((id) => getReplybotClient(id)?.live);
    } catch {
      return [];
    }
  };
  const tick = () => {
    for (const id of clients()) {
      rebuild(id).catch((err) =>
        console.warn("dashboard.refresh_failed", id, String(err)),
      );
    }
  };
  tick();
  setInterval(tick, TTL_MS).unref();
}

export async function handleDashboard(
  req: Request,
  res: Response,
): Promise<void> {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Referrer-Policy", "no-referrer");
  const token = String(req.params.token || "");
  const clientId = clientForToken(token);
  if (!clientId) {
    res.status(404).send("Not found");
    return;
  }
  const client = getReplybotClient(clientId);
  const calendarHref = client?.campaignCalendar
    ? `/dash/${token}/calendar`
    : undefined;
  // A client with the campaign calendar but no Clay sign-in has only that page.
  if (!client?.live && calendarHref) {
    res.redirect(302, calendarHref);
    return;
  }
  try {
    const snap = await snapshotFor(clientId);
    // helmet's default CSP blocks inline script; the page's one script runs
    // by nonce, and nothing else may load or connect.
    const nonce = randomBytes(16).toString("base64");
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    );
    res
      .type("html")
      .send(renderDashboard(snap, Date.now(), calendarHref, nonce));
  } catch (err) {
    res
      .status(503)
      .send(
        `The dashboard couldn't reach the sending platform just now. Try again in a minute.`,
      );
    console.warn("dashboard.build_failed", clientId, String(err));
  }
}
