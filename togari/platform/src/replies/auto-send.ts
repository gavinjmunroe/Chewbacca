/**
 * Replies Togari answers on its own, once Perplexity has written the draft.
 *
 * Caleb, 2026-10-11, after 16 investors sat a weekend with drafts waiting on a
 * Send button: "Jonah said we always handle replies he trusts us, only ping him
 * when there's something that NEEDS him!" So a question, an interested reply or
 * one that needs a read goes out in its thread straight away, and a deck
 * request goes out with the deck when one is on file. Jonah is tagged only
 * when the reply needs something only he has: a form to fill as him, a deck
 * nobody has uploaded, or a draft that is not finished.
 *
 * Every send posts a line in the client's channel with no mention, saying who
 * wrote, what they said and what went back.
 */

import { lookup } from "node:dns/promises";
import { getDeck, deckReplyBody } from "./decks";
import {
  deckComingBody,
  vantageProblem,
  type VantageContext,
  type VantageSent,
} from "./vantage";
import { replyIntent } from "../agents/smartlead-responder/reply-intent";
import type { ReplybotClientConfig } from "../agents/replybot/client-config";

export interface AutoSendRow {
  row_id: string;
  campaign: string | null;
  email_thread_id: string | null;
  from_address: string | null;
  sender_account: string | null;
  subject: string | null;
  body: string;
  lead_id: number | null;
  campaign_id: number | null;
  lead_name: string | null;
}

export interface AutoSendMessage {
  requireUnanswered?: boolean;
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  leadName: string;
  leadId: number;
  campaignId: number;
  sendVia: "clay";
}

export interface AutoSendDeps {
  send: (client: ReplybotClientConfig, msg: AutoSendMessage) => Promise<void>;
  deckFor?: (clientId: string, company: string) => Promise<string | null>;
  /** Opens a link before it goes to an investor. */
  linkWorks?: (url: string) => Promise<boolean>;
  /**
   * Vantage, when on for this client: read before answering (throwing means
   * no send), logged after. Its deck link replaces Togari's deck library.
   */
  vantage?: {
    context: (email: string) => Promise<VantageContext>;
    /** Unused here since 2026-10-13: sendReplyEmail logs every send. */
    logSent?: (msg: VantageSent) => Promise<void>;
  };
}

export type AutoSendResult =
  | { sent: true; kind: string; body: string }
  | { sent: false; kind: string; reason: string };

// A draft that still has a hole in it goes to a person. The long dashes are
// banned in anything Jonah's name goes out on (zeutara-gtme DECISIONS.json).
const UNFINISHED =
  /\[(NEED|INSERT|TODO|NAME|COMPANY|LINK)|\{\{|\}\}|–|—|lorem ipsum/i;
// Promising a file the send can't carry would be a lie in Jonah's name.
const PROMISES_ATTACHMENT = /\b(attached|attaching|see attachment|enclosed)\b/i;
const MIN_DRAFT_CHARS = 20;

export function draftProblem(draft: string): string | null {
  const d = draft.trim();
  if (d.length < MIN_DRAFT_CHARS) return "the draft is empty";
  if (UNFINISHED.test(d)) return "the draft has a placeholder or a long dash";
  if (PROMISES_ATTACHMENT.test(d)) return "the draft promises an attachment";
  return null;
}

function companyOf(campaign: string | null): string {
  return (campaign || "").split("|")[1]?.trim() || "";
}

export function replySubject(subject: string | null): string {
  const s = (subject || "").trim();
  if (!s) return "Re: Question";
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

/**
 * Answer the reply in its own thread unless it needs Jonah. Never throws on a
 * reply that needs him; a failed send throws, and the caller falls back to
 * the card.
 */
export async function autoSend(
  client: ReplybotClientConfig,
  row: AutoSendRow,
  draft: string,
  deps: AutoSendDeps,
): Promise<AutoSendResult> {
  const company = companyOf(row.campaign);
  const intent = replyIntent(row.body, {
    leadEmail: row.from_address ?? undefined,
    sendingEmail: row.sender_account ?? undefined,
    companyName: company,
    client: client.replyCopy,
  });
  const kind = intent.kind;
  if (intent.isDeliveryFailure)
    return {
      sent: false,
      kind,
      reason: "Failed delivery needs repair and recipient confirmation",
    };
  if (!client.autopilot)
    return { sent: false, kind, reason: "autopilot is off" };
  if (!row.from_address || !row.lead_id || !row.campaign_id) {
    return {
      sent: false,
      kind,
      reason: "the reply has no lead or campaign to answer in",
    };
  }
  if (kind === "form") {
    return {
      sent: false,
      kind,
      reason: client.replyCopy?.principal
        ? `they want a form filled out as ${client.replyCopy.principal}`
        : "they want a form filled out",
    };
  }

  let ctx: VantageContext | null = null;
  if (deps.vantage) {
    try {
      ctx = await deps.vantage.context(row.from_address);
    } catch (err) {
      return {
        sent: false,
        kind,
        reason: `Vantage didn't answer (${err instanceof Error ? err.message : String(err)})`,
      };
    }
  }

  let body = draft;
  if (ctx && kind === "deck") {
    if (ctx.policy?.materialDelivery === "vantage_attachments")
      return {
        sent: false,
        kind,
        reason:
          "Vantage owns material attachments; leave this request open for Vantage",
      };
    body = ctx.deckUrl
      ? deckReplyBody(
          row.lead_name,
          company,
          ctx.deckUrl,
          client.voice.signoffName,
        )
      : deckComingBody(row.lead_name, company, client.voice.signoffName);
  } else if (kind === "deck") {
    const url =
      company && deps.deckFor
        ? await deps.deckFor(client.clientId, company)
        : null;
    if (!url)
      return {
        sent: false,
        kind,
        reason: `no ${company || "company"} deck is on file`,
      };
    body = deckReplyBody(row.lead_name, company, url, client.voice.signoffName);
  } else {
    const problem = draftProblem(draft);
    if (problem) return { sent: false, kind, reason: problem };
  }
  if (ctx) {
    const problem = vantageProblem(body, ctx);
    if (problem) return { sent: false, kind, reason: problem };
  }
  // Caleb, 2026-10-13, after four investors got 404 deck links: "WHY TF WOULD
  // TOGARI SEND DEAD LINKS???" Every link in a reply is opened first; one that
  // doesn't answer 2xx sends the reply to a person instead.
  if (deps.linkWorks) {
    const problem = await linkProblem(body, deps.linkWorks);
    if (problem) return { sent: false, kind, reason: problem };
  }

  await deps.send(client, {
    to: row.from_address,
    subject: replySubject(row.subject),
    body,
    inReplyTo: row.email_thread_id ?? undefined,
    leadName: row.lead_name ?? "",
    leadId: row.lead_id,
    campaignId: row.campaign_id,
    sendVia: "clay",
    requireUnanswered: true,
  });
  // The sent-log to Vantage happens inside deps.send (sendReplyEmail), so
  // every path that emails an investor logs once.
  return { sent: true, kind, body };
}

export const defaultDeckLookup = getDeck;

// A link written without https:// ("docsend.com/view/x", "www.pitch.com/v")
// is still clickable in most mail clients, so it can't slip past the check.
const BARE_LINK =
  /(^|[\s(<"'])(?:www\.[a-z0-9-]+\.[a-z]{2,}|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|io|co|vc|ai|app|link|me|net|org|so))\/\S*/i;

/**
 * Why the links in an outgoing email can't go to an investor, or null. Every
 * path that emails an investor runs this: autopilot, the deck modal and the
 * Togari assistant. A deck reply carries one link; past three it goes to a
 * person unopened, since each check can take 8s (security review, 10/13).
 */
export async function linkProblem(
  body: string,
  works: (url: string) => Promise<boolean> = linkWorks,
): Promise<string | null> {
  const links = body.match(/https?:\/\/[^\s<>)"']+/gi) || [];
  if (BARE_LINK.test(body.replace(/https?:\/\/[^\s<>)"']+/gi, " ")))
    return "the email has a link without https://";
  if (links.length > 3) return "the email has more than three links";
  for (const u of links) {
    const link = u.replace(/[.,;:!?]+$/, "");
    let host = "";
    try {
      host = new URL(link).hostname;
    } catch {
      /* unparseable: refused just below */
    }
    if (!isAllowedLinkHost(host))
      return `the link ${link} isn't on a known deck host`;
    if (!(await works(link).catch(() => false)))
      return `the link ${link} doesn't open`;
  }
  return null;
}

/**
 * The only hosts Togari will open, and so the only hosts an auto-reply may
 * link to. A private-address check alone still left DNS rebinding open
 * (security review, 10/13): a host the attacker controls can answer public on
 * the check and private on the fetch. Deck hosts we name can't be steered
 * that way. A link anywhere else goes to a person, unopened.
 */
const LINK_HOSTS = [
  "docsend.com",
  "docs.google.com",
  "drive.google.com",
  "pitch.com",
  "dropbox.com",
  "zeutara.com",
  "calendly.com",
];

export function isAllowedLinkHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  return LINK_HOSTS.some((d) => h === d || h.endsWith(`.${d}`));
}

/**
 * Whether a final status means the page is there. Measured 2026-10-13 from
 * the Mac: docsend.com and dropbox.com answer a plain GET with 403 (bot
 * wall) even on their homepages, so 2xx-only marked every working DocSend
 * deck dead. The dead deck links that started this were 404. So 401, 403
 * and 429 count as there but gated; 404, 410, other 4xx and 5xx are dead.
 */
export function linkAlive(status: number): boolean {
  return (
    (status >= 200 && status < 300) ||
    status === 401 ||
    status === 403 ||
    status === 429
  );
}

/** Loopback, private, link-local, CGNAT and unique-local addresses. */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) {
    const [a, b] = v4.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const l = ip.toLowerCase();
  return l === "::" || l === "::1" || /^f[cd]/.test(l) || /^fe[89ab]/.test(l);
}

/**
 * True when a GET of the link answers 2xx within 8s. The URL comes from a
 * draft written off an investor's reply, so it is untrusted: https only, at
 * most three redirects, and every hop must resolve to public addresses, or
 * Togari would fetch its own private network for whoever wrote the reply
 * (security review, 10/13).
 */
export async function linkWorks(
  url: string,
  budgetMs = 8000,
): Promise<boolean> {
  let current = url;
  // One 8s budget across every redirect hop, so three links cost 24s at worst.
  const signal = AbortSignal.timeout(budgetMs);
  for (let hop = 0; hop <= 3; hop++) {
    let u: URL;
    try {
      u = new URL(current);
    } catch {
      return false;
    }
    if (u.protocol !== "https:" || !isAllowedLinkHost(u.hostname)) return false;
    const host = u.hostname.replace(/^\[|\]$/g, "");
    const addrs = await lookup(host, { all: true }).catch(() => []);
    if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address)))
      return false;
    const res = await fetch(u, {
      redirect: "manual",
      signal,
    });
    res.body?.cancel().catch(() => undefined);
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) return false;
      current = new URL(next, u).toString();
      continue;
    }
    return linkAlive(res.status);
  }
  return false;
}

/** First sentence of an email, plain text, at most `max` characters. */
export function gist(s: string, max = 90): string {
  // A reply body is attacker-controlled text. Only the first 2,000 characters
  // can hold a first sentence, and the quote-marker split uses [ \t]* so a body
  // of thousands of newlines can't make it backtrack (security review, 10/12).
  const flat = s
    .slice(0, 2000)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]{0,500}>/g, "")
    .split(/\n[ \t]*(?:-----|On .{0,80}wrote:|From:)/)[0]
    .replace(/\s+/g, " ")
    .trim();
  const first = (flat.match(/^.+?[.!?](?=\s|$)/) || [flat])[0];
  return first.length > max ? first.slice(0, max - 1).trimEnd() + "…" : first;
}

/**
 * The no-mention channel post for a reply Togari answered: one short line.
 * Caleb, 2026-10-12: "the updates on auto sends are wayyyy too big just give a
 * short summary". The full They wrote / We sent quotes ran 10 to 15 lines a
 * reply; the whole exchange is already in the email thread.
 */
export function sentPost(
  leadName: string | null,
  company: string,
  theirReply: string,
  _ourReply: string,
): { text: string; blocks: unknown[] } {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const who = leadName || "An investor";
  const said = gist(theirReply);
  const line = `${who} on ${company || "the raise"}${said ? `: "${said}"` : "."} Togari replied.`;
  return {
    text: line,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: `:white_check_mark: ${esc(line)}` },
      },
    ],
  };
}
