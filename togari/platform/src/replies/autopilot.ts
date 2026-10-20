/**
 * Reply autopilot: the replies a person never needs to see, handled on the
 * server the moment Clay hands them over.
 *
 * Caleb, 2026-10-09, after a first version ran as a job on his laptop: "Bro why
 * is my mac the one handling the autopilot wtf????? The whole point is togari
 * does it!!!!!!!!!!" So it runs here. Clay's sequencer actions are reached
 * through webhook-triggered Clay workflows (forward, blocklist), and follow-ups
 * go through the same Clay reply hook the Slack Send button uses.
 *
 * Per reply, before any Perplexity spend:
 * - unsubscribe     added to Clay's global blocklist
 * - new address /
 *   referral        the original thread forwarded from the same mailbox to
 *                   each address they gave, with a one-line note
 * - out of office   one follow-up scheduled in the thread, two business days
 *                   after the return date they wrote, sent mornings US time
 * - pass, ignore    nothing sent
 * Everything else carries on to Perplexity and the Slack card. Replies for a
 * company in the client's copy list are also mailed to the client as a copy.
 */

import { google } from "googleapis";
import { BigQueryClient } from "../bigquery/client";
import { resolveDataset } from "../services/dataset-resolver";
import { createLogger } from "../observability/logger";
import {
  getReplybotClient,
  type ReplybotClientConfig,
} from "../agents/replybot/client-config";
import {
  replyIntent,
  type ReplyIntent,
} from "../agents/smartlead-responder/reply-intent";
import type { ReplyIngestPayload } from "./types";
import { ReplyPreflightError, VantageRefusal } from "./delivery";
import { humanDisposition } from "./card-actions";
import { thread, type ThreadMessage } from "../integrations/clay/campaign-read";
import { vantageEnabled } from "./vantage";
import {
  followupAttempt,
  followupDisposition,
  followupObsolete,
} from "./conversation-cycle";
import { parkForPrincipal, repairRefusal, type RepairModel } from "./repair";

const logger = createLogger("replies/autopilot");
const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";

// Redirect addresses come from a stranger's email. A reply naming more than
// this many is not a referral, and stops for a person.
const MAX_FORWARDS_PER_REPLY = 4;
// Two business days after they're back: the first day back is the backlog.
const BUSINESS_DAYS_AFTER_RETURN = 2;
// No return date in the auto-reply: assume a week away.
const DEFAULT_AWAY_DAYS = 7;
// Follow-ups leave 6 to 10am Pacific on a weekday, 9am to 1pm Eastern, when a
// partner back from a trip is clearing the inbox.
const SEND_HOURS_PT = { start: 6, end: 10 };

export type AutopilotOutcome = "handled" | "continue" | "handoff";

function bq(): BigQueryClient {
  return new BigQueryClient(
    PROJECT_ID,
    null,
    process.env.GCP_CREDENTIALS_BASE64 ||
      process.env.GOOGLE_CREDENTIALS_BASE64 ||
      null,
  );
}

export function followupsTable(): string {
  return `\`${PROJECT_ID}.${resolveDataset()}.reply_followups\``;
}

function companyOf(campaign: string | null | undefined): string {
  return (campaign || "").split("|")[1]?.trim() || "";
}

async function postHook(
  url: string,
  body: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok)
    throw new Error(
      `Clay hook ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
}

function hookUrl(envName: string | undefined): string | null {
  return envName ? process.env[envName]?.trim() || null : null;
}

// ── Dates ─────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/** When they said they'd be back, read from the auto-reply text. */
export function returnDate(text: string, replied: Date): Date {
  const t = text.toLowerCase();
  const weeks = t.match(/\b(\d+|two|three|four) weeks\b/);
  if (weeks) {
    const n =
      ({ two: 2, three: 3, four: 4 } as Record<string, number>)[weeks[1]] ??
      Number(weeks[1]);
    return new Date(replied.getTime() + n * 7 * 86_400_000);
  }
  const cands: Array<[number, number]> = [];
  for (const m of t.matchAll(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:\s*-\s*(\d{1,2}))?/g,
  )) {
    cands.push([MONTHS[m[1]], Number(m[3] || m[2])]);
  }
  for (const m of t.matchAll(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/g))
    cands.push([Number(m[2]) - 1, Number(m[1])]);
  for (const m of t.matchAll(/\bau (\d{1,2})\/(\d{1,2})\b/g))
    cands.push([Number(m[2]) - 1, Number(m[1])]);
  if (!cands.length) {
    for (const m of t.matchAll(/\b(\d{1,2})\/(\d{1,2})\b/g))
      cands.push([Number(m[1]) - 1, Number(m[2])]);
  }
  for (const [month, day] of cands) {
    if (month < 0 || month > 11 || day < 1 || day > 31) continue;
    const d = new Date(Date.UTC(replied.getUTCFullYear(), month, day, 12));
    if (d.getTime() < replied.getTime() - 86_400_000)
      d.setUTCFullYear(d.getUTCFullYear() + 1);
    if (d.getTime() - replied.getTime() < 120 * 86_400_000) return d;
  }
  return new Date(replied.getTime() + DEFAULT_AWAY_DAYS * 86_400_000);
}

/** The first send-window morning at least two business days after the return. */
export function followUpDue(back: Date): Date {
  const d = new Date(back);
  let n = BUSINESS_DAYS_AFTER_RETURN;
  while (n > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) n--;
  }
  // 6am Pacific is 13:00 or 14:00 UTC; 14:00 is inside the window either way.
  d.setUTCHours(14, 0, 0, 0);
  return d;
}

export function inSendWindow(now = new Date()): boolean {
  const pt = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }),
  );
  const wd = pt.getDay();
  return (
    wd !== 0 &&
    wd !== 6 &&
    pt.getHours() >= SEND_HOURS_PT.start &&
    pt.getHours() < SEND_HOURS_PT.end
  );
}

// ── Copies to the client ─────────────────────────────────────────

async function mailCopy(
  client: ReplybotClientConfig,
  p: ReplyIngestPayload,
  intent: ReplyIntent,
): Promise<void> {
  const copy = client.autopilot?.copy;
  const company = companyOf(p.campaign);
  if (!copy || !copy.companies.includes(company)) return;
  const raw64 =
    process.env.GCP_CREDENTIALS_BASE64 || process.env.GOOGLE_CREDENTIALS_BASE64;
  if (!raw64) throw new Error("GCP_CREDENTIALS_BASE64 not set");
  const creds = JSON.parse(Buffer.from(raw64, "base64").toString("utf-8"));
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/gmail.send"],
    subject: copy.from,
  });
  const subject = `Fwd: ${company} reply from ${p.from ?? "an investor"}`;
  const body = [
    `${company} investor reply.`,
    `${intent.label}. ${intent.nextStep}`,
    "",
    "---------- Forwarded message ---------",
    `From: ${p.lead_name ? `${p.lead_name} <${p.from}>` : p.from}`,
    `To: ${p.sender_account ?? ""}`,
    `Campaign: ${p.campaign ?? ""}`,
    "",
    p.body,
  ].join("\n");
  const raw = Buffer.from(
    [
      `From: ${copy.fromName} <${copy.from}>`,
      `To: ${copy.to}`,
      `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "",
      body,
    ].join("\r\n"),
  ).toString("base64url");
  await google
    .gmail({ version: "v1", auth })
    .users.messages.send({ userId: "me", requestBody: { raw } });
}

// ── The per-reply step ──────────────────────────────────────────

function forwardNote(
  intent: ReplyIntent,
  leadName: string | null | undefined,
  signoff: string,
): string {
  const who = (leadName || "").split(" ")[0] || "Your colleague";
  const line =
    intent.kind === "new_address"
      ? "Resending my note below to your new address."
      : `${who} suggested I reach out to you. My note to them is below.`;
  return `Hi,<br><br>${line}<br><br>${signoff}`;
}

/**
 * Act on a freshly queued reply. "handled" means nothing more is needed and the
 * row should not go to Perplexity; "continue" means it still needs a draft.
 * Any failure falls back to "continue", so a broken hook costs a card, never a
 * dropped reply.
 */
export async function runAutopilot(
  p: ReplyIngestPayload,
  clientId: string,
): Promise<{
  outcome: AutopilotOutcome;
  kind: string;
  forwardedTo?: string[];
  followUpOn?: string;
}> {
  const client = getReplybotClient(clientId);
  const cfg = client?.autopilot;
  if (!client || !cfg) return { outcome: "continue", kind: "off" };
  const intent = replyIntent(p.body, {
    leadEmail: p.from ?? undefined,
    sendingEmail: p.sender_account ?? undefined,
    companyName: companyOf(p.campaign),
    client: client.replyCopy,
  });
  if (intent.isDeliveryFailure)
    return { outcome: "handoff", kind: "delivery_failure" };

  try {
    await mailCopy(client, p, intent);
  } catch (err) {
    logger.error(
      "autopilot.copy_failed",
      err instanceof Error ? err : new Error(String(err)),
      { rowId: p.row_id },
    );
  }

  try {
    if (intent.kind === "unsubscribe") {
      const url = hookUrl(cfg.blocklistHookEnv);
      if (!url || !p.from) return { outcome: "continue", kind: intent.kind };
      await postHook(url, { email: p.from });
      logger.info("autopilot.blocklisted", { rowId: p.row_id, lead: p.from });
      return { outcome: "handled", kind: intent.kind };
    }

    if (
      (intent.kind === "new_address" || intent.kind === "referral") &&
      intent.addresses?.length
    ) {
      // This hook forwards opaque original mail. It cannot expose the complete
      // outgoing content for Vantage checks or return a confirmed send receipt.
      if (vantageEnabled(clientId))
        return { outcome: "handoff", kind: intent.kind };
      const url = hookUrl(cfg.forwardHookEnv);
      if (!url || !p.lead_id || !p.campaign_id)
        return { outcome: "continue", kind: intent.kind };
      if (intent.addresses.length > MAX_FORWARDS_PER_REPLY)
        return { outcome: "continue", kind: intent.kind };
      const own = (cfg.ownDomainHint || "").toLowerCase();
      for (const to of intent.addresses) {
        if (own && to.toLowerCase().includes(own)) continue;
        await postHook(url, {
          campaign_id: String(p.campaign_id),
          lead_id: String(p.lead_id),
          to_email: to,
          note: forwardNote(intent, p.lead_name, client.voice.signoffName),
        });
      }
      logger.info("autopilot.forwarded", {
        rowId: p.row_id,
        to: intent.addresses,
      });
      return {
        outcome: "handled",
        kind: intent.kind,
        forwardedTo: intent.addresses,
      };
    }

    if (intent.kind === "later") {
      if (!intent.isAway) return { outcome: "continue", kind: intent.kind };
      if (!p.lead_id || !p.campaign_id)
        return { outcome: "continue", kind: intent.kind };
      const replied = p.received_at ? new Date(p.received_at) : new Date();
      const due = followUpDue(
        returnDate(p.body, isNaN(replied.getTime()) ? new Date() : replied),
      );
      await bq().executeWrite(
        `INSERT INTO ${followupsTable()}
           (id, client_id, row_id, lead_id, campaign_id, lead_email, lead_name, thread_id, due_at, created_at, status)
         VALUES (@id, @clientId, @rowId, SAFE_CAST(@leadId AS INT64), SAFE_CAST(@campaignId AS INT64),
                 @leadEmail, @leadName, @threadId, TIMESTAMP(@dueAt), CURRENT_TIMESTAMP(), 'scheduled')`,
        {
          id: `${clientId}:${p.row_id}`,
          clientId,
          rowId: p.row_id,
          leadId: String(p.lead_id),
          campaignId: String(p.campaign_id),
          leadEmail: p.from ?? null,
          leadName: p.lead_name ?? null,
          threadId: p.thread_id ?? null,
          dueAt: due.toISOString(),
        },
      );
      logger.info("autopilot.followup_scheduled", {
        rowId: p.row_id,
        due: due.toISOString(),
      });
      return {
        outcome: "handled",
        kind: intent.kind,
        followUpOn: due.toISOString(),
      };
    }

    if (intent.kind === "pass" || intent.kind === "ignore") {
      return { outcome: "handled", kind: intent.kind };
    }
  } catch (err) {
    logger.error(
      "autopilot.failed",
      err instanceof Error ? err : new Error(String(err)),
      { rowId: p.row_id, kind: intent.kind },
    );
  }
  return { outcome: "continue", kind: intent.kind };
}

// ── Follow-up sweep ─────────────────────────────────────────────

export function followupBody(leadName: string | null, signoff: string): string {
  const first = (leadName || "").split(" ")[0] || "there";
  return `Hi ${first},\n\nHope the time away went well. Bringing my note below back to the top of your inbox in case it's useful now.\n\nOpen to a short call?\n\n${signoff}`;
}

/** Send every follow-up that is due, inside the morning window. */
export async function sweepFollowups(
  send: (
    client: ReplybotClientConfig,
    msg: {
      to: string;
      subject: string;
      body: string;
      inReplyTo?: string;
      leadName: string;
      leadId?: number;
      campaignId?: number;
      sendVia: "clay";
      followupAttempt?: number;
    },
  ) => Promise<void>,
  now = new Date(),
  repair: {
    model?: RepairModel;
    post?: (channel: string, text: string) => Promise<void>;
  } = {},
): Promise<number> {
  if (!inSendWindow(now)) return 0;
  const { rows } = (await bq().executeQuery(
    `SELECT id, client_id, lead_id, campaign_id, lead_email, lead_name, thread_id, status,
       CAST(created_at AS STRING) AS created_at
       FROM ${followupsTable()}
      WHERE status IN ('scheduled', 'retry_1', 'retry_2') AND due_at <= CURRENT_TIMESTAMP()
      LIMIT 20`,
  )) as unknown as { rows: Array<Record<string, any>> };
  let sent = 0;
  for (const r of rows ?? []) {
    const client = getReplybotClient(r.client_id);
    if (!client?.autopilot) continue;
    // Claim first, so a second replica can't send the same follow-up.
    const claim = await bq().executeWrite(
      `UPDATE ${followupsTable()} SET status = 'sending', due_at = CURRENT_TIMESTAMP() WHERE id = @id AND status = @status`,
      { id: r.id, status: r.status || "scheduled" },
    );
    if (Number(claim.numDmlAffectedRows ?? "0") === 0) continue;
    let deliveryAttempted = false;
    try {
      let subject = "Re: Question";
      let history: ThreadMessage[] = [];
      if (client.live) {
        try {
          history = await thread(
            client.clientId,
            client.live.clayWorkspaceId,
            Number(r.campaign_id),
            Number(r.lead_id),
          );
        } catch (error) {
          throw new ReplyPreflightError(String(error));
        }
        const latestInbound = history
          .filter((message) => message.type === "REPLY")
          .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))[0];
        const human = latestInbound
          ? await humanDisposition(
              client.clientId,
              String(r.lead_email),
              Number(r.campaign_id),
              latestInbound.time,
              latestInbound.messageId,
            )
          : null;
        if (
          followupObsolete(history, String(r.created_at || "")) ||
          human === "closed"
        ) {
          await bq().executeWrite(
            `UPDATE ${followupsTable()} SET status = 'cancelled' WHERE id = @id AND status = 'sending'`,
            { id: r.id },
          );
          continue;
        }
        if (human === "legacy_hold") {
          await bq().executeWrite(
            `UPDATE ${followupsTable()} SET status = 'handoff_required' WHERE id = @id AND status = 'sending'`,
            { id: r.id },
          );
          continue;
        }
        const disposition = followupDisposition(
          history,
          !String(r.id).startsWith("cycle:"),
        );
        if (disposition !== "send") {
          await bq().executeWrite(
            `UPDATE ${followupsTable()} SET status = @status WHERE id = @id AND status = 'sending'`,
            {
              id: r.id,
              status:
                disposition === "cancel" ? "cancelled" : "handoff_required",
            },
          );
          continue;
        }
        const prior = [...history]
          .reverse()
          .find((message) => message.type === "SENT");
        if (prior?.subject)
          subject = /^re:/i.test(prior.subject)
            ? prior.subject
            : `Re: ${prior.subject}`;
      }
      // The 2026-10-16 workflow graph showed lead-reply-from-master-inbox-v2
      // accepts no parent-message key. Three cycle nudges completed with
      // "Already replied to this lead" and no SENT receipt. Preserve eligible
      // work until a supported continuation transport is verified.
      if (
        client.clientId === "zeutara" &&
        client.clayReplyWebhookUrlEnv === "REPLYBOT_ZEUTARA_CLAY_REPLY_URL" &&
        process.env.REPLYBOT_ZEUTARA_NATIVE_CONTINUATION !== "1" &&
        String(r.id).startsWith("cycle:")
      ) {
        await bq().executeWrite(
          `UPDATE ${followupsTable()} SET status = 'handoff_required' WHERE id = @id AND status = 'sending'`,
          { id: r.id },
        );
        logger.warn("autopilot.continuation_transport_unavailable", {
          id: r.id,
        });
        continue;
      }
      const attempt = followupAttempt(String(r.id));
      const msg = {
        to: r.lead_email,
        subject,
        body: attempt
          ? `Hi ${String(r.lead_name || "").split(" ")[0] || "there"},\n\nFollowing up on the next step below. Does that work for you?\n\n${client.voice.signoffName}`
          : followupBody(r.lead_name, client.voice.signoffName),
        inReplyTo: r.thread_id ?? undefined,
        leadName: r.lead_name ?? "",
        leadId: Number(r.lead_id),
        campaignId: Number(r.campaign_id),
        sendVia: "clay" as const,
        followupAttempt: attempt,
      };
      deliveryAttempted = true;
      try {
        await send(client, msg);
      } catch (refusal) {
        if (!(refusal instanceof VantageRefusal)) throw refusal;
        // A gate refused the words and nothing was sent. The model proposes
        // a fix; the same gates and the same send path decide.
        const result = await repairRefusal({
          client,
          history,
          subject,
          refusal,
          draft: refusal.draft ?? msg.body,
          model: repair.model,
          deliver: (body) => send(client, { ...msg, body }),
        });
        if (result.kind === "unavailable") throw refusal;
        if (result.kind === "needs_principal") {
          try {
            await parkForPrincipal(
              client,
              { id: r.id, lead_name: r.lead_name, lead_email: r.lead_email },
              result.need,
              result.needText,
              repair.post,
            );
          } catch (parkError) {
            // Nothing was sent, so this is a retry, never delivery_unknown
            // (independent review, 2026-10-17).
            throw new ReplyPreflightError(
              `parking for the principal failed: ${String(parkError)}`,
            );
          }
          logger.info("autopilot.followup_waiting_on_principal", {
            id: r.id,
            need: result.need,
          });
          continue;
        }
        logger.info("autopilot.followup_repaired", {
          id: r.id,
          attempts: result.attempts,
        });
      }
      await bq().executeWrite(
        `UPDATE ${followupsTable()} SET status = 'sent', sent_at = CURRENT_TIMESTAMP() WHERE id = @id`,
        { id: r.id },
      );
      sent++;
    } catch (err) {
      logger.error(
        "autopilot.followup_failed",
        err instanceof Error ? err : new Error(String(err)),
        { id: r.id },
      );
      // The old queue abandoned every failure. Retry only when no delivery
      // request was made. Network/HTTP ambiguity must never double-email.
      const retry =
        !deliveryAttempted || err instanceof ReplyPreflightError
          ? r.status === "retry_2"
            ? "retry_exhausted"
            : r.status === "retry_1"
              ? "retry_2"
              : "retry_1"
          : "delivery_unknown";
      await bq().executeWrite(
        `UPDATE ${followupsTable()} SET status = @status,
           due_at = TIMESTAMP_ADD(CURRENT_TIMESTAMP(), INTERVAL 15 MINUTE)
         WHERE id = @id AND status = 'sending'`,
        { id: r.id, status: retry },
      );
    }
  }
  return sent;
}
