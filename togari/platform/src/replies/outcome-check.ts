/**
 * Once a day, check every investor who replied against what actually happened
 * to them, and DM Caleb the ones still stuck.
 *
 * 2026-10-13: Togari called a reply "done" once it posted a Slack card, so
 * Jill Koziol, Sudhir Kadam, Kellie O Hara and Darrel Frater all sat at "done"
 * for a week with no answer and no call, and Ryan found them before we did.
 * The truth is in the client's Clay inbox: a thread where the investor wrote
 * after our last email is waiting on us. Anything still waiting after 24 hours,
 * that the sequencer didn't file as a pass, opt-out, out-of-office or wrong
 * person, goes in the digest.
 *
 * The digest is internal, so it goes to Caleb's DM and never the client's
 * channel (Sagar, 2026-10-03: no process chatter in client channels).
 */
import {
  clayClients,
  clayWorkspace,
  getReplybotClient,
} from "../agents/replybot/client-config";
import { inboxReplies, thread } from "../integrations/clay/campaign-read";
import type { ThreadMessage } from "../integrations/clay/campaign-read";
import { replyIntent } from "../agents/smartlead-responder/reply-intent";
import { htmlToText } from "../routes/client-dashboard";
import { slackBotTokenFor } from "../transports/slack/installations";
import { takeLease } from "./inbox-poller";
import { humanDisposition } from "./card-actions";
import {
  settledByAutopilot,
  stalledFollowups,
  stalledReplyItems,
  type NextMove,
} from "./store";
import { createLogger } from "../observability/logger";
import { slackEscape, slackSafe } from "./repair";

const logger = createLogger("OutcomeCheck");

// Ryan's list on 10/13 ran 4 to 8 days old; a day is the longest an
// interested investor should wait before a person hears about it.
const STUCK_MS = 24 * 3_600_000;
// The 2026-10-16 auto-replies landed 2 to 20 seconds after our send; a person
// typing an answer in under a minute is rare. Guessed bound, never measured
// on a human reply.
const AUTO_REPLY_MS = 60_000;
// Caleb's Slack id in the workspace Togari posts to (#zeutara-cold-replies
// member list, 2026-10-13). Overridable without a deploy.
const ALERT_USER = () => process.env.OUTCOME_ALERT_SLACK_USER || "U0AEBS2UXRB";

export interface Stuck {
  email: string;
  company: string;
  hours: number;
  reason?: string;
  /** Who owes the next move. Unset reads as us. */
  owner?: NextMove;
  /** What the principal was asked for, when they owe it. */
  needText?: string;
}

// When one investor shows up in several places, the most urgent owner wins:
// anything waiting on us outranks a request to the principal, which outranks
// waiting for the investor to answer.
const OWNER_RANK: Record<NextMove, number> = {
  us: 0,
  principal: 1,
  investor: 2,
};

function firstOwner(a?: NextMove, b?: NextMove): NextMove {
  const x = a ?? "us";
  const y = b ?? "us";
  return OWNER_RANK[x] <= OWNER_RANK[y] ? x : y;
}

async function threadSettled(
  messages: ThreadMessage[],
  clientId: string,
  email: string,
  campaignId: number,
): Promise<boolean> {
  const latestReply = messages
    .filter((message) => message.type === "REPLY")
    .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))[0];
  if (!latestReply) return false;
  const disposition = await humanDisposition(
    clientId,
    email,
    campaignId,
    latestReply.time,
    latestReply.messageId,
  );
  if (disposition === "closed") return true;
  const intent = replyIntent(htmlToText(String(latestReply.body || "")));
  if (intent.isDeliveryFailure) return false;
  if (
    messages.some(
      (message) =>
        message.type === "SENT" &&
        Date.parse(message.time) > Date.parse(latestReply.time),
    )
  )
    return true;
  const kind = intent.kind;
  // A referral we already forwarded is handled: the forward is ours, not a SENT.
  if (
    messages.some(
      (message) =>
        message.type === "FORWARD" &&
        Date.parse(message.time) > Date.parse(latestReply.time),
    )
  )
    return true;
  // A reply inside a minute of our email is a machine answering it. On
  // 2026-10-16, 16 of 21 "waiting" investors in the digest replied 2 to 20
  // seconds after our send (out-of-office and left-the-firm notices). One
  // that names somewhere new to write still waits, for the forward.
  const priorSent = messages
    .filter(
      (message) =>
        message.type === "SENT" &&
        Date.parse(message.time) <= Date.parse(latestReply.time),
    )
    .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))[0];
  if (
    priorSent &&
    Date.parse(latestReply.time) - Date.parse(priorSent.time) < AUTO_REPLY_MS &&
    !["referral", "new_address", "unsubscribe"].includes(kind)
  )
    return true;
  return ["pass", "ignore"].includes(kind);
}

export async function findStuck(
  clientId: string,
  now = Date.now(),
): Promise<Stuck[]> {
  const client = getReplybotClient(clientId);
  const live = client && clayWorkspace(client);
  if (!live) return [];
  const all = await inboxReplies(clientId, live.workspaceId).catch((error) => {
    logger.warn("outcome_check.inbox_unavailable", {
      clientId,
      error: String(error),
    });
    return [];
  });
  const waiting = all.filter(
    (r) =>
      r.campaignName.startsWith(live.campaignPrefix) &&
      r.lastReply &&
      (!r.lastSent || Date.parse(r.lastReply) > Date.parse(r.lastSent)) &&
      now - Date.parse(r.lastReply) > STUCK_MS,
  );
  // The first dry run on 2026-10-14 listed Andrew at Dolby (opt-out,
  // blocklisted), Ganas (auto-reply, follow-up scheduled) and a bounce:
  // settled by Togari with nothing to email, so Clay still shows them open.
  const settled = await settledByAutopilot(clientId, waiting);
  const candidates = waiting.filter(
    (r) => !settled.has(`${r.emailCampaignId}:${r.emailLeadId}:${r.lastReply}`),
  );
  const unresolved = [] as typeof candidates;
  // Read the words even when Clay left the category unset. Bounded batches
  // keep the daily check from hitting Clay with every thread at once.
  for (let offset = 0; offset < candidates.length; offset += 5) {
    const batch = candidates.slice(offset, offset + 5);
    const keep = await Promise.all(
      batch.map(async (reply) => {
        if (!reply.emailCampaignId || !reply.emailLeadId) return true;
        try {
          return !(await threadSettled(
            await thread(
              clientId,
              live.workspaceId,
              reply.emailCampaignId,
              reply.emailLeadId,
            ),
            clientId,
            reply.leadEmail,
            reply.emailCampaignId,
          ));
        } catch (error) {
          logger.warn("outcome_check.thread_unavailable", {
            clientId,
            error: String(error),
          });
          return true;
        }
      }),
    );
    unresolved.push(...batch.filter((_, index) => keep[index]));
  }
  const unanswered = unresolved
    .map((r) => ({
      email: r.leadEmail,
      company: (r.campaignName.split("|")[1] || "").trim(),
      hours: Math.round((now - Date.parse(r.lastReply)) / 3_600_000),
      owner: "us" as NextMove,
    }))
    .sort((a, b) => b.hours - a.hours);
  const merged = new Map<string, Stuck>(
    unanswered.map((row) => [row.email.toLowerCase(), row]),
  );
  const [openReplies, followups] = await Promise.all([
    stalledReplyItems(clientId),
    stalledFollowups(clientId),
  ]);
  for (const item of openReplies) {
    const snapshot = all.find(
      (reply) =>
        reply.leadEmail.toLowerCase() === item.email.toLowerCase() &&
        (!item.leadId || reply.emailLeadId === item.leadId) &&
        (!item.campaignId || reply.emailCampaignId === item.campaignId),
    );
    if (
      snapshot &&
      snapshot.lastSent &&
      snapshot.lastReply &&
      Date.parse(snapshot.lastSent) > Date.parse(snapshot.lastReply)
    )
      continue;
    if (item.leadId && item.campaignId) {
      try {
        const messages = await thread(
          clientId,
          live.workspaceId,
          item.campaignId,
          item.leadId,
        );
        if (
          await threadSettled(messages, clientId, item.email, item.campaignId)
        )
          continue;
      } catch (error) {
        logger.warn("outcome_check.thread_unavailable", {
          clientId,
          error: String(error),
        });
      }
    }
    const key = item.email.toLowerCase();
    const existing = merged.get(key);
    merged.set(key, {
      email: item.email,
      company: existing?.company || "",
      hours: Math.max(existing?.hours || 0, Number(item.hours) || 0),
      reason: [existing?.reason, item.reason].filter(Boolean).join(", "),
      owner: "us",
    });
  }
  for (const item of followups) {
    // 2026-10-17: a handoff_required row stayed in the digest after a person
    // closed the conversation (Adam, Simon, Jill and Frank were answered on
    // 10-12 and 10-14 and still listed), because only rows still sending were
    // ever cancelled. A human closure of the latest inbound settles it here.
    if (item.leadId && item.campaignId) {
      try {
        const messages = await thread(
          clientId,
          live.workspaceId,
          item.campaignId,
          item.leadId,
        );
        const inbound = messages
          .filter((message) => message.type === "REPLY")
          .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))[0];
        if (
          inbound &&
          (await humanDisposition(
            clientId,
            item.email,
            item.campaignId,
            inbound.time,
            inbound.messageId,
          )) === "closed"
        )
          continue;
      } catch (error) {
        logger.warn("outcome_check.thread_unavailable", {
          clientId,
          error: String(error),
        });
      }
    }
    const key = item.email.toLowerCase();
    const existing = merged.get(key);
    merged.set(key, {
      email: item.email,
      company: existing?.company || "",
      hours: Math.max(existing?.hours || 0, Number(item.hours) || 0),
      reason: [existing?.reason, item.reason].filter(Boolean).join(", "),
      owner: existing
        ? firstOwner(existing.owner, item.owner)
        : (item.owner ?? "us"),
      ...(item.needText || existing?.needText
        ? { needText: item.needText || existing?.needText }
        : {}),
    });
  }
  return [...merged.values()].sort((a, b) => b.hours - a.hours);
}

/** The daily digest, grouped by who owes the next move. */
export function digest(
  clientName: string,
  stuck: Stuck[],
  principal = "the principal",
): string {
  const line = (s: Stuck) =>
    `- ${slackEscape(s.email)}${s.company ? ` (${s.company})` : ""}, waiting ${s.hours >= 48 ? `${Math.round(s.hours / 24)} days` : `${s.hours}h`}${s.reason ? `, ${s.reason}` : ""}${s.needText ? `. Needs: ${slackSafe(s.needText)}` : ""}`;
  const groups: Array<[NextMove, string]> = [
    ["us", "Waiting on us"],
    ["principal", `Waiting on ${principal}`],
    ["investor", "Waiting on the investor"],
  ];
  const sections = groups
    .map(([owner, title]) => {
      const rows = stuck.filter((s) => (s.owner ?? "us") === owner);
      return rows.length
        ? `${title} (${rows.length}):\n${rows.map(line).join("\n")}`
        : "";
    })
    .filter(Boolean);
  return `${clientName}: ${stuck.length} investor${stuck.length === 1 ? "" : "s"} need follow-through.\n${sections.join("\n\n")}`;
}

export async function runOutcomeCheck(clientId: string): Promise<number> {
  const client = getReplybotClient(clientId);
  if (!client) return 0;
  const stuck = await findStuck(clientId);
  if (!stuck.length) return 0;
  const token = await slackBotTokenFor(client.slackTeamId);
  const res = (await (
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        channel: client.clay?.outcomeAlertUser || ALERT_USER(),
        text: digest(client.displayName, stuck, client.replyCopy?.principal),
      }),
    })
  ).json()) as { ok?: boolean; error?: string };
  if (!res.ok) logger.warn("outcome_check.dm_failed", { error: res.error });
  return stuck.length;
}

/** Hourly tick; the 23-hour lease means one digest a day across every copy. */
export function startOutcomeCheck(
  clientIds = clayClients("outcomeCheck"),
): void {
  if (process.env.OUTCOME_CHECK_OFF === "1") return;
  const tick = () => {
    for (const id of clientIds) {
      takeLease(`outcome:${id}`, 23 * 3_600_000)
        .then((mine) => (mine ? runOutcomeCheck(id) : null))
        .then((n) => {
          if (n) logger.info("outcome_check.sent", { clientId: id, stuck: n });
        })
        .catch((err) =>
          logger.warn("outcome_check.failed", {
            clientId: id,
            error: String(err),
          }),
        );
    }
  };
  setTimeout(tick, 60_000).unref();
  setInterval(tick, 3_600_000).unref();
}
