/**
 * @togari/admin — Slack interactivity handler for Smartlead buttons
 *
 * Handles Smartlead button clicks from Slack with a two-step confirmation flow:
 *   1. "Send as-is" / "Edit & Send" modal → posts a review thread reply
 *   2. "Confirm & Send" in thread → actually sends email via Gmail API
 *
 * Uses Gmail API (domain-wide delegation, raw fetch + JWT auth).
 */

import crypto from "crypto";
import { scheduleConversationFollowup } from "../../replies/conversation-cycle";
import {
  ContinuationRefused,
  replyInThread,
  thread,
  type ThreadMessage,
} from "../../integrations/clay/campaign-read";
import {
  confirmedMessage,
  ReplyDeliveryUnknown,
  ReplyPreflightError,
  VantageRefusal,
} from "../../replies/delivery";
import { createLogger } from "../../observability/logger";
import { classifyAndDraft } from "./classifier";
import { replyIntent } from "./reply-intent";
import { htmlToText } from "../../routes/client-dashboard";
import { fetchMessageHistory } from "./smartlead-api";
import { resolveStrategy } from "./campaign-strategies";
import {
  resolveReplybotClient,
  resolveReplybotClientFromCard,
  CARD_SCHEMA_VERSION,
  isApprover,
  type ReplybotClientConfig,
} from "../replybot/client-config";
import type { SmartleadReply } from "./index";
import {
  deleteReplyByThread,
  deleteAfterSendEnabled,
} from "../../replies/store";
import { recordCardAction, humanDisposition } from "../../replies/card-actions";
import { slackBotTokenFor } from "../../transports/slack/installations";
import {
  DECK_SEND_ACTION,
  FIT_ACTIONS,
  FIT_DONE_ACTION,
  FIT_GOOD_ACTION,
  sendButtons,
  splitCampaign,
} from "./fit-review";
import {
  cleanDeckUrl,
  deckReplyBody,
  getDeck,
  saveDeck,
} from "../../replies/decks";
import { linkProblem, linkWorks } from "../../replies/auto-send";
import { retainVantageReceipt } from "../../replies/vantage-outbox";
import { withReplySendClaim } from "../../replies/send-claim";
import {
  vantageContext,
  vantageEnabled,
  vantageLogSent,
  vantageProblem,
  vantageDisclosureProblem,
} from "../../replies/vantage";

const logger = createLogger("SmartleadSlackActions");

// Gmail sends impersonate the client's sender mailbox via domain-wide
// delegation: the GCP service account behind GCP_CREDENTIALS_BASE64 must
// have DWD enabled for that mailbox in its Google Admin Console (Patch I
// did this for sagar@bluemodernadvisory.com); otherwise the send /
// drafts.create calls below return 403 / "insufficient permissions".
const GMAIL_SCOPES =
  "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.compose";

// ── Access token cache (per impersonated mailbox) ────────────────

const cachedTokens = new Map<
  string,
  { accessToken: string; expiresAt: number }
>();

// ── Gmail JWT auth (domain-wide delegation via service account) ──

interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
}

function getCredentials(): ServiceAccountCredentials {
  const b64 = process.env.GCP_CREDENTIALS_BASE64;
  if (!b64) throw new Error("GCP_CREDENTIALS_BASE64 not set");
  const parsed = JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
  return { client_email: parsed.client_email, private_key: parsed.private_key };
}

/**
 * Build and sign an RS256 JWT, then exchange it for an access token
 * at Google's OAuth2 token endpoint. Caches the token until ~60s before expiry.
 */
async function getGmailAccessToken(senderEmail: string): Promise<string> {
  // Return cached token if still valid (60s buffer)
  const cached = cachedTokens.get(senderEmail);
  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return cached.accessToken;
  }

  const creds = getCredentials();
  const now = Math.floor(Date.now() / 1000);

  // Build JWT
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: creds.client_email,
    sub: senderEmail,
    scope: GMAIL_SCOPES,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signingInput = `${headerB64}.${payloadB64}`;

  // Sign with RS256
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signingInput);
  const signatureB64 = signer.sign(creds.private_key).toString("base64url");

  const jwt = `${signingInput}.${signatureB64}`;

  // Exchange JWT for access token
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${encodeURIComponent(jwt)}`,
  });

  if (!tokenRes.ok) {
    const errorBody = await tokenRes.text();
    throw new Error(
      `Google OAuth token exchange failed ${tokenRes.status}: ${errorBody}`,
    );
  }

  const tokenData = (await tokenRes.json()) as any;
  const accessToken = tokenData.access_token as string;
  const expiresIn = (tokenData.expires_in as number) || 3600;

  cachedTokens.set(senderEmail, {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  });

  logger.info("Gmail access token acquired", { senderEmail, expiresIn });
  return accessToken;
}

// ── RFC 2822 message builder ─────────────────────────────────────

/** Ensure a Message-ID is wrapped in angle brackets (<...>). */
function ensureAngleBrackets(id: string): string {
  if (!id) return "";
  const trimmed = id.trim();
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) return trimmed;
  return `<${trimmed}>`;
}

function buildRawMessage(
  sender: { name: string; email: string },
  to: string,
  subject: string,
  body: string,
  inReplyTo?: string,
): string {
  const headers: string[] = [
    `From: ${sender.name} <${sender.email}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
  ];

  // Add threading headers so the reply threads under the prospect's message
  if (inReplyTo) {
    const bracketed = ensureAngleBrackets(inReplyTo);
    headers.push(`In-Reply-To: ${bracketed}`);
    headers.push(`References: ${bracketed}`);
  }

  headers.push("Content-Type: text/plain; charset=utf-8");
  headers.push("MIME-Version: 1.0");

  const rawMessage = [...headers, "", body].join("\r\n");
  return Buffer.from(rawMessage).toString("base64url");
}

// ── Gmail API calls ──────────────────────────────────────────────

async function sendEmail(
  accessToken: string,
  sender: { name: string; email: string },
  to: string,
  subject: string,
  body: string,
  inReplyTo?: string,
): Promise<void> {
  const raw = buildRawMessage(sender, to, subject, body, inReplyTo);

  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/${sender.email}/messages/send`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ raw }),
    },
  );

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Gmail send failed ${res.status}: ${errorBody}`);
  }

  logger.info("Email sent via Gmail API", { to, subject });
}

async function createDraft(
  accessToken: string,
  sender: { name: string; email: string },
  to: string,
  subject: string,
  body: string,
  inReplyTo?: string,
): Promise<void> {
  const raw = buildRawMessage(sender, to, subject, body, inReplyTo);

  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/${sender.email}/drafts`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ message: { raw } }),
    },
  );

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Gmail draft creation failed ${res.status}: ${errorBody}`);
  }

  logger.info("Draft created via Gmail API", { to, subject });
}

// ── Send adapter ─────────────────────────────────────────────────
// Approved replies go out via the client's default send method. Gmail
// is implemented; the Smartlead reply-API adapter lands in Phase 4 of
// the per-client replybot work.

interface OutboundReply {
  followupAttempt?: number;
  requireUnanswered?: boolean;
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  /**
   * The person's name. Only used by the outreach route: a first-touch send has
   * no lead row in Clay to look anything up from, so whatever Clay needs to
   * create or match one has to travel with the message.
   */
  leadName?: string;
  /** Clay reply-to-lead keys — required when the send method is 'clay'. */
  leadId?: number;
  campaignId?: number;
  /**
   * Send route stamped on the card when it was minted. Overrides the
   * client default, so a campaign reply goes back through Clay while
   * first-touch outreach for the same client still goes out over Gmail.
   */
  sendVia?: "clay";
  /** Slack username of whoever pressed Send. Unset for Togari's own sends. */
  sentBy?: string;
}

function providerReplyText(body: string): string {
  // Provider thread bodies retain formatting and quoted history. Neither can
  // hide a current material request or turn an old request into current work.
  const quoted = body.search(
    /<(?:blockquote\b|div\b[^>]*\bclass\s*=\s*["'][^"']*\bgmail_quote\b)/i,
  );
  return htmlToText(quoted < 0 ? body : body.slice(0, quoted))
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (entity, value: string) => {
      const code =
        value[0].toLowerCase() === "x"
          ? parseInt(value.slice(1), 16)
          : Number(value);
      return code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : entity;
    })
    .replace(/&(?:hyphen|dash|ndash|mdash);/gi, "-")
    .replace(/[\u2010-\u2015]/g, "-");
}

/**
 * Which route this message actually takes.
 *
 * A card that stamped its own route keeps it. Otherwise — first-touch outreach,
 * which has no campaign to reply into — Clay outreach wins when it is
 * configured, and Gmail is the fallback until it is. That ordering is what lets
 * the switch happen by setting one variable rather than by a deploy that breaks
 * sending in the gap before Clay's side is built.
 */
function resolveSendMethod(
  client: ReplybotClientConfig,
  msg: OutboundReply,
): string {
  if (msg.sendVia) return msg.sendVia;
  const outreachEnv = client.clayOutreachWebhookUrlEnv;
  if (outreachEnv && process.env[outreachEnv]?.trim()) return "clay-outreach";
  return client.sendMethods[0];
}

/**
 * Every investor email goes through here: autopilot, the reply and deck cards
 * and the Togari assistant. So Vantage is checked here, once, for all of them.
 *
 * Ryan Korn, 2026-10-13: "I want Togari to check it before it answers anyone
 * and tell it what it sent after, so we stop sending bad links and nothing
 * Togari promises gets dropped." Vantage that can't be read stops the send;
 * a sent-log that fails never un-sends an email that already went.
 */
export async function sendReplyEmail(
  client: ReplybotClientConfig,
  msg: OutboundReply,
): Promise<void> {
  if (
    client.clientId === "zeutara" &&
    resolveSendMethod(client, msg) === "clay"
  ) {
    return withReplySendClaim(client.clientId, () =>
      sendReplyUnderClaim(client, msg),
    );
  }
  return sendReplyUnderClaim(client, msg);
}

async function sendReplyUnderClaim(
  client: ReplybotClientConfig,
  msg: OutboundReply,
): Promise<void> {
  let before: ThreadMessage[] = [];
  let confirmedSent: ThreadMessage | undefined;
  const verify =
    client.clientId === "zeutara" && resolveSendMethod(client, msg) === "clay";
  try {
    // Caleb, 2026-10-11: a reply is refused when its body is empty. Checked
    // on the text a person would read, so markup alone counts as empty.
    if (!htmlToText(String(msg.body || "")).trim())
      throw new Error("The reply body is empty");
    const ctx = vantageEnabled(client.clientId)
      ? await vantageContext(msg.to)
      : null;
    if (ctx) {
      const problem =
        vantageDisclosureProblem(msg.subject, ctx) ||
        vantageProblem(msg.body, ctx);
      if (problem) throw new VantageRefusal(problem, ctx, msg.body);
    }
    if (verify) {
      if (!client.live || !msg.campaignId || !msg.leadId)
        throw new Error("Missing thread identity for delivery verification");
      before = await thread(
        client.clientId,
        client.live.clayWorkspaceId,
        msg.campaignId,
        msg.leadId,
      );
      const inboundAt = Math.max(
        ...before
          .filter((m) => m.type === "REPLY")
          .map((m) => Date.parse(m.time))
          .filter(Number.isFinite),
      );
      const latestInbound = before
        .filter((m) => m.type === "REPLY")
        .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))[0];
      if (
        ctx?.policy?.materialDelivery === "vantage_attachments" &&
        latestInbound?.body
      ) {
        const currentReply = providerReplyText(latestInbound.body);
        if (!currentReply.trim())
          throw new Error(
            "Current provider reply text is unavailable for Vantage policy checks",
          );
        if (replyIntent(currentReply).kind === "deck")
          throw new Error(
            "Vantage owns material attachments; keep this request open for Vantage",
          );
      }
      if (
        msg.requireUnanswered &&
        (!latestInbound?.messageId || msg.inReplyTo !== latestInbound.messageId)
      )
        throw new Error(
          "The automated draft is not bound to the latest inbound message",
        );
      if (msg.followupAttempt !== undefined) {
        const parent = before.find((m) => m.messageId === msg.inReplyTo);
        if (
          !parent ||
          !Number.isFinite(Date.parse(parent.time)) ||
          before.some(
            (m) =>
              m.messageId !== parent.messageId &&
              ["SENT", "REPLY"].includes(m.type) &&
              Date.parse(m.time) >= Date.parse(parent.time),
          )
        )
          throw new Error(
            "Conversation advanced since this follow-up was scheduled",
          );
      }
      if (
        (msg.requireUnanswered || msg.followupAttempt !== undefined) &&
        Number.isFinite(inboundAt) &&
        (await humanDisposition(
          client.clientId,
          msg.to,
          msg.campaignId,
          new Date(inboundAt).toISOString(),
          latestInbound?.messageId || "",
        ))
      )
        throw new Error("A person closed this inbound conversation");
      if (
        msg.followupAttempt === undefined &&
        ((msg.requireUnanswered &&
          Number.isFinite(inboundAt) &&
          before.some(
            (m) => m.type === "SENT" && Date.parse(m.time) > inboundAt,
          )) ||
          confirmedMessage(
            [],
            before.filter((m) => Date.parse(m.time) > inboundAt),
            msg.body,
          ))
      )
        throw new Error(
          "A reply to this inbound is already present in provider history",
        );
    }
  } catch (error) {
    // The repair loop needs the policy and the exact reason, not just text.
    if (error instanceof VantageRefusal) throw error;
    throw new ReplyPreflightError(
      error instanceof Error ? error.message : String(error),
    );
  }
  try {
    await deliverReplyEmail(client, msg);
  } catch (error) {
    // Refused before Clay's reply endpoint: nothing was sent.
    if (error instanceof ContinuationRefused)
      throw new ReplyPreflightError(error.message);
    if (verify) throw new ReplyDeliveryUnknown(String(error));
    throw error;
  }
  if (verify && client.live && msg.campaignId && msg.leadId) {
    // A workflow's 2xx only acknowledges intake. Require a new matching SENT
    // message before reporting success. Otherwise hold for reconciliation.
    const after = await thread(
      client.clientId,
      client.live.clayWorkspaceId,
      msg.campaignId,
      msg.leadId,
    ).catch((error) => {
      throw new ReplyDeliveryUnknown(String(error));
    });
    let sent = confirmedMessage(before, after, msg.body);
    // 2026-10-16 07:02 PT: the workflow reported "Reply sent successfully"
    // for Akbar Poonawala and the provider recorded a SENT with no body.
    // Name it, so nobody retries into a second blank email.
    const seen = new Set(before.map((m) => m.messageId));
    const blank = after.find(
      (m) =>
        m.type === "SENT" &&
        !seen.has(m.messageId) &&
        !htmlToText(m.body || "").trim(),
    );
    if (!sent && blank) {
      logger.error(
        "reply.empty_provider_send",
        new Error("Provider recorded an empty email"),
        { clientId: client.clientId, messageId: blank.messageId },
      );
      throw new ReplyDeliveryUnknown(
        `Provider recorded an EMPTY email (${blank.messageId}); never resend without a person`,
      );
    }
    if (!sent)
      throw new ReplyDeliveryUnknown(
        "Delivery accepted but not yet visible in the thread",
      );
    // A native reply shows in history with an empty time for a few seconds
    // (Ethan Austin, 2026-10-16: "" at once, 19:50:26Z a minute later), and
    // Vantage refuses a receipt without one.
    for (
      let attempt = 0;
      attempt < 3 && sent.messageId && !sent.time;
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const later = await thread(
        client.clientId,
        client.live.clayWorkspaceId,
        msg.campaignId,
        msg.leadId,
      ).catch(() => [] as ThreadMessage[]);
      sent = later.find((m) => m.messageId === sent?.messageId) ?? sent;
    }
    await retainVantageReceipt(client.clientId, msg.to, sent).catch(() => {
      throw new ReplyDeliveryUnknown(
        "Reply delivered; Vantage log awaits recovery",
      );
    });
    if (sent)
      await scheduleConversationFollowup(
        client,
        msg,
        sent,
        after
          .filter((m) => m.type === "REPLY")
          .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))[0]?.time ||
          "",
        after,
      ).catch(() => {
        throw new ReplyDeliveryUnknown(
          "Reply delivered; follow-up scheduling awaits recovery",
        );
      });
    confirmedSent = sent;
  }
  // The campaign calendar stops counting this prospect as waiting on an
  // answer. Every path that emails a prospect comes through here: card
  // buttons, the edit and deck modals, auto-send and the assistant. Not
  // awaited: the modals have three seconds to answer Slack.
  if (client.campaignCalendar) {
    void recordCardAction(
      client.clientId,
      { leadEmail: msg.to, campaignId: msg.campaignId },
      "sent",
      msg.sentBy || "togari",
    );
  }
  if (vantageEnabled(client.clientId) && !confirmedSent) {
    await vantageLogSent({
      to_email: msg.to,
      from_email: client.sender?.email || "",
      subject: msg.subject,
      text: msg.body,
      sent_at: new Date().toISOString(),
    }).catch((err) => {
      logger.warn("vantage.log_sent_failed", {
        to: msg.to,
        error: String(err),
      });
      // Clay has confirmed delivery. Keep the queue entry unresolved so
      // result recovery retries the log without sending another email.
      throw new ReplyDeliveryUnknown(
        "Reply delivered; Vantage log awaits recovery",
      );
    });
  }
}

async function deliverReplyEmail(
  client: ReplybotClientConfig,
  msg: OutboundReply,
): Promise<void> {
  const method = resolveSendMethod(client, msg);
  if (method === "clay-outreach") {
    await sendOutreachViaClay(client, msg);
    return;
  }
  if (method === "gmail") {
    const accessToken = await getGmailAccessToken(client.sender.email);
    await sendEmail(
      accessToken,
      client.sender,
      msg.to,
      msg.subject,
      msg.body,
      msg.inReplyTo,
    );
    return;
  }
  if (method === "clay") {
    await sendViaClay(client, msg);
    return;
  }
  throw new Error(
    `Send method "${method}" is not implemented yet for client "${client.clientId}"`,
  );
}

/**
 * Hand an approved reply back to Clay, which sends it with its "reply to
 * lead in a campaign" action.
 *
 * The reason this exists rather than a Gmail send: Clay replies out of the
 * campaign's own sending mailbox, so the answer comes from the same
 * Smartsenders inbox and the same persona the prospect wrote to, threaded
 * where they expect it. Sending from a company-domain mailbox instead
 * would put a different address, and often a different name, on the reply.
 *
 * The action is keyed on lead id + campaign id, so both are required. A
 * card that lost them (an old card, or a payload that never carried them)
 * fails loudly here rather than POSTing a request Clay would silently drop.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function sendViaClay(
  client: ReplybotClientConfig,
  msg: OutboundReply,
): Promise<void> {
  if (client.clientId === "zeutara" && (msg.followupAttempt ?? 0) > 0) {
    if (
      process.env.REPLYBOT_ZEUTARA_NATIVE_CONTINUATION !== "1" ||
      !client.live ||
      !msg.campaignId ||
      !msg.leadId ||
      !msg.inReplyTo
    )
      throw new Error(
        "Verified native continuation and complete thread identity required",
      );
    await replyInThread(
      client.clientId,
      client.live.clayWorkspaceId,
      msg.campaignId,
      msg.leadId,
      msg.inReplyTo,
      msg.to,
      /<[a-z][^>]*>/i.test(msg.body)
        ? msg.body
        : escapeHtml(msg.body).replace(/\n/g, "<br>"),
    );
    return;
  }
  // Answers go natively too: the webhook workflow refuses a second answer to
  // a lead ("Already replied to this lead", Ethan Austin, 2026-10-16) while
  // reporting success. A refusal here happens before Clay's reply endpoint, so
  // the webhook below is still the first and only delivery request.
  if (
    client.clientId === "zeutara" &&
    process.env.REPLYBOT_ZEUTARA_NATIVE_CONTINUATION === "1" &&
    // Initial out-of-office follow-ups (attempt 0) go native too. The workflow
    // route sent Akbar Poonawala a blank email on 2026-10-16 while reporting
    // "Reply sent successfully", and native now accepts the investor's own
    // reply as its parent. A refusal still falls back to the workflow.
    (msg.followupAttempt ?? 0) === 0 &&
    client.live &&
    msg.campaignId &&
    msg.leadId &&
    msg.inReplyTo
  ) {
    try {
      await replyInThread(
        client.clientId,
        client.live.clayWorkspaceId,
        msg.campaignId,
        msg.leadId,
        msg.inReplyTo,
        msg.to,
        /<[a-z][^>]*>/i.test(msg.body)
          ? msg.body
          : escapeHtml(msg.body).replace(/\n/g, "<br>"),
      );
      return;
    } catch (error) {
      // Only "native can't take this parent" falls back. A newer message in
      // the thread (possibly our own answer, still timeless) stops here.
      if (!(error instanceof ContinuationRefused) || error.advanced)
        throw error;
      logger.info("reply.native_answer_unavailable", {
        clientId: client.clientId,
        reason: error.message,
      });
    }
  }
  const urlEnv = client.clayReplyWebhookUrlEnv;
  if (!urlEnv) {
    throw new Error(
      `Client "${client.clientId}" sends via Clay but has no clayReplyWebhookUrlEnv configured`,
    );
  }
  const url = process.env[urlEnv];
  if (!url) {
    throw new Error(
      `${urlEnv} is not set — cannot send ${client.displayName} replies via Clay`,
    );
  }
  if (!msg.leadId || !msg.campaignId) {
    throw new Error(
      `Clay reply needs both a lead id and a campaign id (got lead=${msg.leadId ?? "none"}, ` +
        `campaign=${msg.campaignId ?? "none"}). The inbound webhook must send lead_id and campaign_id.`,
    );
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      lead_id: msg.leadId,
      campaign_id: msg.campaignId,
      email: msg.to,
      subject: msg.subject,
      // Clay's reply action sends the body as HTML, so a plain-text draft's
      // line breaks would collapse into one paragraph.
      body: /<[a-z][^>]*>/i.test(msg.body)
        ? msg.body
        : escapeHtml(msg.body).replace(/\n/g, "<br>"),
      in_reply_to: msg.inReplyTo || "",
      client_id: client.clientId,
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text().catch(() => "");
    throw new Error(
      `Clay reply webhook failed ${res.status}: ${errorBody.slice(0, 300)}`,
    );
  }

  logger.info("Reply handed to Clay for sending", {
    clientId: client.clientId,
    leadId: msg.leadId,
    campaignId: msg.campaignId,
    to: msg.to,
  });
}

async function createReplyDraft(
  client: ReplybotClientConfig,
  msg: OutboundReply,
): Promise<void> {
  if (!client.sendMethods.includes("gmail")) {
    throw new Error(
      `Gmail drafts are not enabled for client "${client.clientId}"`,
    );
  }
  const accessToken = await getGmailAccessToken(client.sender.email);
  await createDraft(
    accessToken,
    client.sender,
    msg.to,
    msg.subject,
    msg.body,
    msg.inReplyTo,
  );
}

// ── Slack helpers ────────────────────────────────────────────────
//
// Every call here acts on a card, so it goes out with the token of the
// workspace the card's client lives in: its own install when it has one
// (slackTeamId), the home workspace otherwise. That is also the install the
// click arrived through, which matters for views.open: a trigger_id only
// works with the token of the workspace it came from.

/** Post a message via Slack chat.postMessage. Returns the message ts. */
async function slackPostMessage(
  client: ReplybotClientConfig,
  payload: Record<string, unknown>,
): Promise<string> {
  const token = await slackBotTokenFor(client.slackTeamId);

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Slack chat.postMessage HTTP ${response.status}: ${errorBody}`,
    );
  }

  const data = (await response.json()) as any;
  if (!data.ok) {
    throw new Error(`Slack chat.postMessage error: ${data.error || "unknown"}`);
  }

  return data.ts as string;
}

/** Update a Slack message via chat.update (by channel + ts). */
async function slackChatUpdate(
  client: ReplybotClientConfig,
  channel: string,
  ts: string,
  blocks: any[],
  text?: string,
): Promise<void> {
  const token = await slackBotTokenFor(client.slackTeamId);

  const response = await fetch("https://slack.com/api/chat.update", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      channel,
      ts,
      blocks,
      text: text || "",
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    logger.error("Slack chat.update HTTP error", undefined, {
      status: response.status,
      body: errorBody,
    });
  } else {
    const data = (await response.json()) as any;
    if (!data.ok) {
      logger.error("Slack chat.update API error", undefined, {
        error: data.error,
      });
    }
  }
}

/**
 * Update the original Slack message in-place via response_url.
 * Preserves all non-actions blocks from the original and appends the status.
 */
async function updateSlackMessage(
  responseUrl: string,
  originalBlocks: any[],
  statusBlocks: any[],
): Promise<void> {
  // Keep everything except the old actions and context blocks
  const preserved = originalBlocks.filter(
    (b: any) => b.type !== "actions" && b.type !== "context",
  );

  const res = await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      replace_original: true,
      blocks: [...preserved, ...statusBlocks],
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    logger.error("Failed to update Slack message via response_url", undefined, {
      status: res.status,
      body: errorBody,
    });
  }
}

/** Update a message via response_url with replace_original. */
async function updateViaResponseUrl(
  responseUrl: string,
  blocks: any[],
  text?: string,
): Promise<void> {
  const res = await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      replace_original: true,
      blocks,
      text: text || "",
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    logger.error("Failed to update via response_url", undefined, {
      status: res.status,
      body: errorBody,
    });
  }
}

/** Current timestamp in ET */
function nowET(): string {
  return (
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" }) + " ET"
  );
}

/** Format plain text as a Slack quote block (prefix each line with >). */
function quoteBlock(text: string): string {
  return text
    .split("\n")
    .map((line) => `>${line}`)
    .join("\n");
}

// ── Review thread reply builder ──────────────────────────────────

/** Post a review thread reply with Confirm & Send / Cancel buttons. */
async function postReviewThread(
  client: ReplybotClientConfig,
  threadTs: string,
  leadEmail: string,
  draftSubject: string,
  draftBody: string,
  leadName: string,
  campaignName: string,
  inReplyTo: string | undefined,
  channel: string,
  route: { leadId?: number; campaignId?: number; sendVia?: "clay" } = {},
): Promise<void> {
  // The confirm button is a fresh value, not the card's — so anything the
  // send needs has to be copied onto it here. Dropping the Clay keys would
  // send the reply out over Gmail from the client's default mailbox
  // instead of back through the campaign, silently and under the wrong
  // persona.
  const confirmValue = JSON.stringify({
    clientId: client.clientId,
    cv: CARD_SCHEMA_VERSION,
    leadEmail,
    draftSubject,
    draftBody,
    leadName,
    campaignName,
    inReplyTo,
    ...(route.leadId ? { leadId: route.leadId } : {}),
    ...(route.campaignId ? { campaignId: route.campaignId } : {}),
    ...(route.sendVia ? { sendVia: route.sendVia } : {}),
  });

  await slackPostMessage(client, {
    channel,
    thread_ts: threadTs,
    text: `Review before sending to ${leadEmail}`,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: "📋 *Review before sending:*" },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*To:* ${leadEmail}` },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Subject:* ${draftSubject}` },
      },
      { type: "divider" },
      {
        type: "section",
        text: { type: "mrkdwn", text: quoteBlock(draftBody) },
      },
      { type: "divider" },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "🚀 Confirm & Send",
              emoji: true,
            },
            action_id: "smartlead_confirm_send",
            style: "danger",
            value: confirmValue,
          },
          {
            type: "button",
            text: { type: "plain_text", text: "❌ Cancel", emoji: true },
            action_id: "smartlead_cancel_send",
            value: "{}",
          },
        ],
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Review carefully — this will send ${route.sendVia === "clay" ? "from the campaign mailbox via Clay" : `from ${client.sender.email}`}`,
          },
        ],
      },
    ],
  });
}

/** Replace the original message buttons with a status context block. */
async function replaceOriginalWithStatus(
  responseUrl: string,
  originalBlocks: any[],
  statusText: string,
): Promise<void> {
  await updateSlackMessage(responseUrl, originalBlocks, [
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: statusText }],
    },
  ]);
}

/** Replace original message buttons via chat.update (when response_url not available). */
async function replaceOriginalWithStatusViaUpdate(
  client: ReplybotClientConfig,
  messageTs: string,
  originalChannel: string,
  statusText: string,
): Promise<void> {
  // We don't have the original blocks when called from modal submit,
  // so just post a simple update with the status context.
  // This runs after the email has gone, so a missing token must not throw:
  // the modal would report a failed send for a reply that was sent.
  let token: string;
  try {
    token = await slackBotTokenFor(client.slackTeamId);
  } catch (err) {
    logger.warn(
      "Skipping card status update — no Slack token for this client",
      {
        clientId: client.clientId,
        error: err instanceof Error ? err.message : String(err),
      },
    );
    return;
  }

  // Fetch the original message to get blocks
  const histRes = await fetch(
    `https://slack.com/api/conversations.history?channel=${originalChannel}&latest=${messageTs}&limit=1&inclusive=true`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  let originalBlocks: any[] = [];
  if (histRes.ok) {
    const histData = (await histRes.json()) as any;
    if (histData.ok && histData.messages?.[0]?.blocks) {
      originalBlocks = histData.messages[0].blocks;
    }
  }

  // Keep everything except actions and context blocks
  const preserved = originalBlocks.filter(
    (b: any) => b.type !== "actions" && b.type !== "context",
  );

  await slackChatUpdate(client, originalChannel, messageTs, [
    ...preserved,
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: statusText }],
    },
  ]);
}

// ── Main action handler ──────────────────────────────────────────

export async function handleSmartleadSlackAction(payload: any): Promise<void> {
  try {
    const action = payload?.actions?.[0];
    if (!action) {
      logger.warn("Slack interactivity payload has no actions");
      return;
    }

    const actionId = action.action_id as string;
    const responseUrl = payload.response_url as string;
    const username = payload.user?.username || "unknown";
    const originalBlocks: any[] = payload.message?.blocks || [];
    const messageTs = (payload.message?.ts as string) || "";

    // Parse the button value JSON
    let valueData: {
      clientId?: string;
      /** Card schema version — absent on cards minted before 2026-09-02. */
      cv?: number;
      leadEmail: string;
      draftSubject: string;
      draftBody: string;
      leadName: string;
      campaignName: string;
      inReplyTo?: string;
      /** Clay reply-to-lead keys. Present only on cards for 'clay' clients. */
      leadId?: number;
      campaignId?: number;
      /** Send route stamped at card-mint time. Absent = client default. */
      sendVia?: "clay";
    };
    try {
      valueData = JSON.parse(action.value || "{}");
    } catch {
      logger.error("Failed to parse button value JSON", undefined, {
        value: action.value,
      });
      if (responseUrl) {
        await updateSlackMessage(responseUrl, originalBlocks, [
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `❌ Internal error: could not parse button data.`,
              },
            ],
          },
        ]);
      }
      return;
    }

    const {
      leadEmail,
      draftSubject,
      draftBody,
      leadName,
      campaignName,
      inReplyTo,
    } = valueData;
    const client = resolveReplybotClientFromCard(valueData);
    const slackUserId = payload.user?.id as string | undefined;
    // Thread replies must go to the channel the card is actually in, not
    // the client default — clients can route payload kinds to different
    // channels (see channelOverrides), and a thread_ts from another
    // channel would post to the wrong place or fail outright.
    const messageChannel =
      (payload.channel?.id as string) || client.slackChannelId;

    // Retired clients: refuse every action, not just the sending ones.
    // Cards left in an offboarded client's channels stay readable as
    // history, but nothing on them can still reach a mailbox.
    if (client.retired) {
      logger.warn("Blocked action for retired client", {
        actionId,
        clientId: client.clientId,
        slackUserId,
      });
      await slackPostMessage(client, {
        channel: messageChannel,
        thread_ts: messageTs,
        text: `🚫 ${client.displayName} is no longer an active replybot client. This card is archived — nothing was sent.`,
      }).catch(() => {});
      return;
    }

    // Approver gate — only for actions that send email or create drafts.
    // Clients without an approver list (BMA) let anyone in the channel act.
    // smartlead_send belongs here now that it sends on the first press rather
    // than opening a confirm step. Leaving it out would let anyone in the
    // channel mail a prospect for a client with an approver list.
    const sendActions = new Set([
      "smartlead_send",
      "smartlead_confirm_send",
      "smartlead_draft",
      // Fit calls belong to the approver too: Good fit is what unlocks Send.
      ...FIT_ACTIONS,
    ]);
    if (sendActions.has(actionId) && !isApprover(client, slackUserId)) {
      logger.warn("Blocked non-approver send attempt", {
        actionId,
        clientId: client.clientId,
        slackUserId,
        username,
      });
      await slackPostMessage(client, {
        channel: messageChannel,
        thread_ts: messageTs,
        text: `🚫 @${username} is not an approved sender for ${client.displayName}. Ask an approver to send this reply.`,
      }).catch(() => {});
      return;
    }

    if (actionId === "smartlead_send") {
      // Sends on the first press. The card already shows the full draft, so the
      // confirm step asked someone to re-read what they had just read, and the
      // thread it opened buried the decision a level down. Edit & Send remains
      // for anyone who wants to look before it goes.
      //
      // handleSendReview and the smartlead_confirm_send / smartlead_cancel_send
      // handlers stay: cards posted before this change still have confirm
      // buttons sitting in Slack threads, and those must keep working.
      await handleConfirmSend(
        client,
        valueData,
        username,
        responseUrl,
        messageTs,
        messageChannel,
      );
    } else if (actionId === "smartlead_edit_modal") {
      await handleEditModal(
        client,
        payload,
        valueData,
        messageTs,
        responseUrl,
        originalBlocks,
      );
    } else if (actionId === "smartlead_draft") {
      await handleDraft(
        client,
        leadEmail,
        draftSubject,
        draftBody,
        inReplyTo,
        username,
        responseUrl,
        originalBlocks,
      );
    } else if (actionId === "smartlead_confirm_send") {
      await handleConfirmSend(
        client,
        valueData,
        username,
        responseUrl,
        messageTs,
        messageChannel,
      );
    } else if (actionId === DECK_SEND_ACTION) {
      await handleDeckModal(client, payload, valueData, messageTs);
    } else if (FIT_ACTIONS.has(actionId)) {
      await handleFitDecision(
        client,
        valueData,
        actionId === FIT_GOOD_ACTION,
        action.value as string,
        username,
        slackUserId,
        responseUrl,
        originalBlocks,
        actionId === FIT_DONE_ACTION,
      );
    } else if (actionId === "smartlead_cancel_send") {
      await handleCancelSend(username, responseUrl);
    } else if (actionId === "send_proposal_email") {
      await handleProposalEmail(payload, action, responseUrl, originalBlocks);
    } else if (
      actionId === "smartlead_ambig_swe" ||
      actionId === "smartlead_ambig_bizops"
    ) {
      const track =
        actionId === "smartlead_ambig_swe"
          ? ("swe" as const)
          : ("bizops" as const);
      await handleAmbiguousTrack(
        client,
        payload,
        track,
        username,
        responseUrl,
        originalBlocks,
        messageTs,
      );
    } else {
      logger.info("Ignoring non-handled smartlead action", { actionId });
    }
  } catch (err) {
    logger.error(
      "Smartlead Slack action handler failed",
      err instanceof Error ? err : new Error(String(err)),
    );
  }
}

// ── Action handlers ──────────────────────────────────────────────

/**
 * Good fit / Not a fit on a fit-review card. Good fit swaps the two buttons
 * for the send row, built from the same card payload. Not a fit closes the
 * card. Neither sends anything. Every call is logged with the lead and
 * campaign so the client's picks can be read back per company later.
 */
async function handleFitDecision(
  client: ReplybotClientConfig,
  valueData: {
    leadEmail: string;
    leadName: string;
    campaignName: string;
    campaignId?: number;
    inReplyTo?: string;
  },
  goodFit: boolean,
  cardValue: string,
  username: string,
  slackUserId: string | undefined,
  responseUrl: string,
  originalBlocks: any[],
  doneOffEmail = false,
): Promise<void> {
  logger.info("Replybot fit decision", {
    clientId: client.clientId,
    fit: goodFit ? "good" : "not_a_fit",
    leadEmail: valueData.leadEmail,
    leadName: valueData.leadName,
    campaignName: valueData.campaignName,
    slackUserId,
  });
  // Good fit only unlocks Send; the answer is recorded when it goes out.
  if (!goodFit) {
    await recordCardAction(
      client.clientId,
      valueData,
      doneOffEmail ? "done" : "skipped",
      username,
      true,
    );
  }
  if (!responseUrl) return;
  const status = {
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: goodFit
          ? `@${username} is replying. Send the draft as-is or edit it first.`
          : doneOffEmail
            ? `Done by @${username} outside email. Nothing was sent.`
            : `Skipped by @${username}. Nothing was sent.`,
      },
    ],
  };
  // Swap the fit buttons in place and keep every other block, including the
  // grey detail line, so the card reads the same after the decision.
  const blocks = originalBlocks.flatMap((b: any) =>
    b.type !== "actions"
      ? [b]
      : goodFit
        ? [{ type: "actions", elements: sendButtons(client, cardValue) }]
        : [],
  );
  // A card whose blocks didn't come back with the click still gets the row.
  if (goodFit && !blocks.some((b: any) => b.type === "actions")) {
    blocks.push({ type: "actions", elements: sendButtons(client, cardValue) });
  }
  const res = await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      replace_original: true,
      blocks: [...blocks, status],
    }),
  });
  if (!res.ok) {
    logger.error("Failed to update fit-review card", undefined, {
      status: res.status,
    });
  }
}

/**
 * Step A: "Send as-is" → post review thread (do NOT send email).
 */
async function handleSendReview(
  client: ReplybotClientConfig,
  messageTs: string,
  leadEmail: string,
  draftSubject: string,
  draftBody: string,
  leadName: string,
  campaignName: string,
  inReplyTo: string | undefined,
  responseUrl: string,
  originalBlocks: any[],
  messageChannel: string,
  route: { leadId?: number; campaignId?: number; sendVia?: "clay" } = {},
): Promise<void> {
  try {
    // Post review thread reply
    await postReviewThread(
      client,
      messageTs,
      leadEmail,
      draftSubject,
      draftBody,
      leadName,
      campaignName,
      inReplyTo,
      messageChannel,
      route,
    );

    // Update original message to show review status
    await replaceOriginalWithStatus(
      responseUrl,
      originalBlocks,
      "📋 Review posted in thread...",
    );

    logger.info("smartlead_send: review thread posted", {
      leadEmail,
      draftSubject,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(
      "smartlead_send: failed to post review thread",
      err instanceof Error ? err : new Error(errMsg),
      { leadEmail },
    );

    await updateSlackMessage(responseUrl, originalBlocks, [
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: `❌ Failed to post review: ${errMsg}` },
        ],
      },
    ]).catch((updateErr) => {
      logger.error(
        "Failed to post error status to Slack",
        updateErr instanceof Error ? updateErr : new Error(String(updateErr)),
      );
    });
  }
}

/**
 * Step C: "Confirm & Send" — the ONLY place that actually sends email via Gmail.
 */
async function handleConfirmSend(
  client: ReplybotClientConfig,
  valueData: {
    leadEmail: string;
    draftSubject: string;
    draftBody: string;
    leadName: string;
    campaignName: string;
    inReplyTo?: string;
    leadId?: number;
    campaignId?: number;
    sendVia?: "clay";
  },
  username: string,
  responseUrl: string,
  messageTs: string,
  messageChannel: string,
): Promise<void> {
  const {
    leadEmail,
    draftSubject,
    draftBody,
    leadName,
    inReplyTo,
    leadId,
    campaignId,
    sendVia,
  } = valueData;

  try {
    await sendReplyEmail(client, {
      to: leadEmail,
      subject: draftSubject,
      body: draftBody,
      inReplyTo,
      leadName,
      leadId,
      campaignId,
      sendVia,
      sentBy: username,
    });
    await forgetAnsweredReply(inReplyTo);

    logger.info("smartlead_confirm_send: email sent successfully", {
      clientId: client.clientId,
      to: leadEmail,
      subject: draftSubject,
    });

    // Update the review message — replace buttons with sent status
    if (responseUrl) {
      await updateViaResponseUrl(responseUrl, [
        {
          type: "section",
          text: { type: "mrkdwn", text: "📋 *Review before sending:*" },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: `*To:* ${leadEmail}` },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: `*Subject:* ${draftSubject}` },
        },
        { type: "divider" },
        {
          type: "section",
          text: { type: "mrkdwn", text: quoteBlock(draftBody) },
        },
        { type: "divider" },
        {
          type: "context",
          elements: [
            { type: "mrkdwn", text: `✅ Sent by @${username} at ${nowET()}` },
          ],
        },
      ]);
    }

    // Post confirmation in thread
    await slackPostMessage(client, {
      channel: messageChannel,
      thread_ts: messageTs,
      text: `✅ Email sent to ${leadName} (${leadEmail})`,
    }).catch((err) => {
      logger.error(
        "Failed to post send confirmation thread reply",
        err instanceof Error ? err : new Error(String(err)),
      );
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(
      "smartlead_confirm_send: failed to send email",
      err instanceof Error ? err : new Error(errMsg),
      { to: leadEmail },
    );

    if (responseUrl) {
      await updateViaResponseUrl(responseUrl, [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text:
              err instanceof ReplyDeliveryUnknown
                ? "Delivery is being reconciled. Do not resend this reply."
                : `Failed before delivery: ${errMsg}`,
          },
        },
      ]);
    }
  }
}

/**
 * Step D: "Cancel" — update review message to show cancelled.
 */
async function handleCancelSend(
  username: string,
  responseUrl: string,
): Promise<void> {
  if (responseUrl) {
    await updateViaResponseUrl(responseUrl, [
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: `❌ Cancelled by @${username}` }],
      },
    ]);
  }
}

async function handleDraft(
  client: ReplybotClientConfig,
  to: string,
  subject: string,
  body: string,
  inReplyTo: string | undefined,
  username: string,
  responseUrl: string,
  originalBlocks: any[],
): Promise<void> {
  try {
    await createReplyDraft(client, { to, subject, body, inReplyTo });

    logger.info("smartlead_draft: draft created successfully", {
      clientId: client.clientId,
      to,
      subject,
    });

    await updateSlackMessage(responseUrl, originalBlocks, [
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "Open Drafts in Gmail",
              emoji: true,
            },
            url: "https://mail.google.com/mail/u/0/#drafts",
            action_id: "smartlead_open_gmail_drafts",
          },
        ],
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `✏️ Draft created by @${username} — open Gmail to review and send · ${nowET()}`,
          },
        ],
      },
    ]);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(
      "smartlead_draft: failed to create draft",
      err instanceof Error ? err : new Error(errMsg),
      { to },
    );

    await updateSlackMessage(responseUrl, originalBlocks, [
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `❌ Failed to create draft: ${errMsg}. Try again or compose manually.`,
          },
        ],
      },
    ]).catch((updateErr) => {
      logger.error(
        "Failed to post error status to Slack",
        updateErr instanceof Error ? updateErr : new Error(String(updateErr)),
      );
    });
  }
}

// ── Proposal email handler ───────────────────────────────────────

/**
 * Handle "Email Proposal" button — opens a modal to review/edit before sending.
 */
async function handleProposalEmail(
  payload: any,
  action: any,
  responseUrl: string,
  originalBlocks: any[],
): Promise<void> {
  const triggerId = payload.trigger_id;
  if (!triggerId) {
    logger.error("send_proposal_email: no trigger_id in payload");
    return;
  }

  let proposalData: {
    clientEmail: string;
    clientName: string;
    proposalText: string;
  };
  try {
    proposalData = JSON.parse(action.value || "{}");
  } catch {
    logger.error("send_proposal_email: failed to parse button value");
    return;
  }

  const { clientEmail, clientName, proposalText } = proposalData;
  const messageTs = (payload.message?.ts as string) || "";

  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN not set");

  // Proposal emails are a BMA-internal flow — always the default client.
  const replybotClient = resolveReplybotClient();
  const subject = `Blue Modern Advisory — Proposal for ${clientName}`;
  const channel = payload.channel?.id || replybotClient.slackChannelId;
  const privateMetadata = JSON.stringify({
    clientId: replybotClient.clientId,
    cv: CARD_SCHEMA_VERSION,
    leadEmail: clientEmail,
    leadName: clientName,
    campaignName: "proposal",
    channel,
    message_ts: messageTs,
  });

  const viewsRes = await fetch("https://slack.com/api/views.open", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      trigger_id: triggerId,
      view: {
        type: "modal",
        callback_id: "smartlead_send_edited",
        title: { type: "plain_text", text: "Email Proposal", emoji: true },
        submit: { type: "plain_text", text: "Send Now", emoji: true },
        close: { type: "plain_text", text: "Cancel", emoji: true },
        private_metadata: privateMetadata,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*To:* ${clientEmail}\n*Name:* ${clientName}`,
            },
          },
          { type: "divider" },
          {
            type: "input",
            block_id: "subject_block",
            label: { type: "plain_text", text: "Subject" },
            element: {
              type: "plain_text_input",
              action_id: "subject_input",
              initial_value: subject,
            },
          },
          {
            type: "input",
            block_id: "body_block",
            label: { type: "plain_text", text: "Email Body" },
            element: {
              type: "plain_text_input",
              action_id: "body_input",
              multiline: true,
              initial_value: proposalText,
            },
          },
          { type: "divider" },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `⚠️ Clicking *Send Now* will send this email immediately from ${replybotClient.sender.email}.`,
              },
            ],
          },
        ],
      },
    }),
  });

  if (!viewsRes.ok) {
    const errorBody = await viewsRes.text();
    logger.error("Failed to open proposal email modal (HTTP)", undefined, {
      status: viewsRes.status,
      body: errorBody,
    });
    return;
  }

  const viewsData = (await viewsRes.json()) as any;
  if (!viewsData.ok) {
    logger.error("Failed to open proposal email modal (API)", undefined, {
      error: viewsData.error,
    });
    return;
  }

  logger.info("Proposal email modal opened", { clientEmail, clientName });
}

// ── Edit & Send modal ────────────────────────────────────────────

/**
 * Open a Slack modal pre-filled with the draft subject/body for editing.
 * Includes message_ts in private_metadata so the modal submit can post a thread reply.
 */
async function handleEditModal(
  client: ReplybotClientConfig,
  payload: any,
  valueData: {
    leadEmail: string;
    draftSubject: string;
    draftBody: string;
    leadName: string;
    campaignName: string;
    inReplyTo?: string;
    leadId?: number;
    campaignId?: number;
    sendVia?: "clay";
  },
  messageTs: string,
  responseUrl: string,
  originalBlocks: any[],
): Promise<void> {
  const {
    leadEmail,
    draftSubject,
    draftBody,
    leadName,
    campaignName,
    inReplyTo,
    leadId,
    campaignId,
    sendVia,
  } = valueData;
  const triggerId = payload.trigger_id;

  if (!triggerId) {
    logger.error("smartlead_edit_modal: no trigger_id in payload");
    return;
  }

  // CHANGE 3: Defensive check — log if the message is already stuck in "Editing..." state
  const hasEditingContext = originalBlocks.some(
    (b: any) =>
      b.type === "context" &&
      JSON.stringify(b.elements || []).includes("Editing"),
  );
  if (hasEditingContext) {
    logger.warn(
      'smartlead_edit_modal: message already in "Editing..." state — proceeding anyway',
      { messageTs, leadEmail },
    );
  }

  const token = await slackBotTokenFor(client.slackTeamId);

  const channel = payload.channel?.id || client.slackChannelId;

  // Include channel, message_ts and inReplyTo in private_metadata so modal submit can update the original message
  // leadId/campaignId ride along so an edited reply can still go back
  // through Clay — the modal submit is a separate request with none of
  // the button's context.
  // draftSubject rides along because the modal no longer asks for it: this is a
  // reply into an existing thread, so the subject is the thread's, not
  // something to compose. The submit is a separate request with none of the
  // button's context, so anything it needs has to travel here.
  const privateMetadata = JSON.stringify({
    clientId: client.clientId,
    cv: CARD_SCHEMA_VERSION,
    leadEmail,
    leadName,
    campaignName,
    channel,
    message_ts: messageTs,
    inReplyTo,
    draftSubject,
    ...(leadId ? { leadId } : {}),
    ...(campaignId ? { campaignId } : {}),
    ...(sendVia ? { sendVia } : {}),
  });

  // Open the modal via views.open
  const viewsRes = await fetch("https://slack.com/api/views.open", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      trigger_id: triggerId,
      view: {
        type: "modal",
        callback_id: "smartlead_send_edited",
        title: { type: "plain_text", text: "Edit & Send Reply", emoji: true },
        submit: { type: "plain_text", text: "Send Now", emoji: true },
        close: { type: "plain_text", text: "Cancel", emoji: true },
        private_metadata: privateMetadata,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*To:* ${leadEmail}\n*Name:* ${leadName}\n*Campaign:* ${campaignName}`,
            },
          },
          { type: "divider" },
          // No subject field. The reply goes back into the prospect's existing
          // thread, so the subject is already decided — offering it as an
          // editable box invites someone to change it and break the threading.
          {
            type: "input",
            block_id: "body_block",
            label: { type: "plain_text", text: "Email Body" },
            element: {
              type: "plain_text_input",
              action_id: "body_input",
              multiline: true,
              initial_value: draftBody,
            },
          },
          { type: "divider" },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `⚠️ Clicking *Send Now* will send this email immediately ${sendVia === "clay" ? "from the campaign mailbox via Clay" : `from ${client.sender.email}`}.`,
              },
            ],
          },
        ],
      },
    }),
  });

  if (!viewsRes.ok) {
    const errorBody = await viewsRes.text();
    logger.error("Failed to open Slack modal (HTTP)", undefined, {
      status: viewsRes.status,
      body: errorBody,
    });
    return;
  }

  const viewsData = (await viewsRes.json()) as any;
  if (!viewsData.ok) {
    logger.error("Failed to open Slack modal (API)", undefined, {
      error: viewsData.error,
      response_metadata: viewsData.response_metadata,
    });
    return;
  }

  logger.info("Slack edit modal opened", { leadEmail, leadName });
}

// ── Modal submission handler ─────────────────────────────────────

/**
 * Handle the "smartlead_send_edited" modal submission (view_submission).
 * Sends the email directly via Gmail API (modal editing is the deliberate step).
 * Returns { response_action: "clear" } to close the modal.
 */
export async function handleSmartleadModalSubmit(
  payload: any,
): Promise<Record<string, any>> {
  try {
    const values = payload.view?.state?.values || {};
    const editedBody = values.body_block?.body_input?.value || "";
    const username = payload.user?.username || "unknown";

    let metadata: {
      clientId?: string;
      cv?: number;
      leadEmail: string;
      leadName: string;
      campaignName: string;
      channel?: string;
      message_ts: string;
      inReplyTo?: string;
      draftSubject?: string;
      leadId?: number;
      campaignId?: number;
      sendVia?: "clay";
    };
    try {
      metadata = JSON.parse(payload.view?.private_metadata || "{}");
    } catch {
      logger.error("Failed to parse modal private_metadata");
      return {
        response_action: "errors",
        errors: { body_block: "Internal error: could not read lead metadata." },
      };
    }

    const {
      leadEmail,
      leadName,
      message_ts,
      inReplyTo,
      leadId,
      campaignId,
      sendVia,
    } = metadata;

    // The modal no longer collects a subject; it comes from the card that
    // opened it. The values lookup stays as a fallback so a modal opened
    // before this change still submits rather than sending with none.
    const editedSubject =
      values.subject_block?.subject_input?.value || metadata.draftSubject || "";
    const client = resolveReplybotClientFromCard(metadata);
    const channel = metadata.channel || client.slackChannelId;

    // Retired clients: the button path blocks the action that opens this
    // modal, but a modal already on screen when the retirement deployed
    // would otherwise submit straight into their mailbox. Same refusal,
    // one layer deeper.
    if (client.retired) {
      logger.warn("Blocked modal send for retired client", {
        clientId: client.clientId,
        username,
      });
      return {
        response_action: "errors",
        errors: {
          body_block: `${client.displayName} is no longer an active replybot client — nothing was sent.`,
        },
      };
    }

    // Approver gate — modal submit sends immediately, so it needs the
    // same check as the confirm-send button.
    if (!isApprover(client, payload.user?.id as string | undefined)) {
      logger.warn("Blocked non-approver modal send", {
        clientId: client.clientId,
        username,
      });
      return {
        response_action: "errors",
        errors: {
          body_block: `You are not an approved sender for ${client.displayName}.`,
        },
      };
    }

    // Send email via the client's send method (modal editing is the deliberate step)
    await sendReplyEmail(client, {
      to: leadEmail,
      subject: editedSubject,
      body: editedBody,
      inReplyTo,
      leadName,
      leadId,
      campaignId,
      sendVia,
      sentBy: username,
    });
    await forgetAnsweredReply(inReplyTo);

    logger.info("smartlead_send_edited: email sent directly", {
      clientId: client.clientId,
      to: leadEmail,
      subject: editedSubject,
    });

    // Update the original message to show sent status
    await replaceOriginalWithStatusViaUpdate(
      client,
      message_ts,
      channel,
      `✅ Sent by @${username} at ${nowET()}`,
    );

    // Post confirmation in thread
    await slackPostMessage(client, {
      channel,
      thread_ts: message_ts,
      text: `✅ Email sent to ${leadName} (${leadEmail}) by @${username}`,
    }).catch((err) => {
      logger.error(
        "Failed to post send confirmation thread reply",
        err instanceof Error ? err : new Error(String(err)),
      );
    });

    return { response_action: "clear" };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(
      "smartlead_send_edited: failed to send",
      err instanceof Error ? err : new Error(errMsg),
    );
    if (err instanceof ReplyDeliveryUnknown) {
      await holdUnknownModal(payload);
      return { response_action: "clear" };
    }
    return {
      response_action: "errors",
      errors: { body_block: `Failed to send email: ${errMsg}` },
    };
  }
}

// ── Send the deck ────────────────────────────────────────────────

export const DECK_MODAL_CALLBACK = "replybot_deck_send";

/**
 * Open the send-the-deck modal from a deck-request card. The company's deck
 * link is prefilled when it's on file, so after the first time this is one
 * press: open, Send. The reply body is editable and already holds the link.
 */
async function handleDeckModal(
  client: ReplybotClientConfig,
  payload: any,
  valueData: {
    leadEmail: string;
    draftSubject: string;
    leadName: string;
    campaignName: string;
    inReplyTo?: string;
    leadId?: number;
    campaignId?: number;
    sendVia?: "clay";
  },
  messageTs: string,
): Promise<void> {
  const triggerId = payload.trigger_id;
  if (!triggerId) {
    logger.error("replybot_deck: no trigger_id in payload");
    return;
  }
  const company =
    splitCampaign(valueData.campaignName || "", client.displayName).company ||
    client.displayName;
  let url: string | null = null;
  try {
    url = await getDeck(client.clientId, company);
  } catch (err) {
    logger.warn("replybot_deck: deck lookup failed, opening empty", {
      error: String(err),
    });
  }
  const signoff = client.voice.signoffName;
  const channel = payload.channel?.id || client.slackChannelId;
  const meta = JSON.stringify({
    clientId: client.clientId,
    cv: CARD_SCHEMA_VERSION,
    company,
    leadEmail: valueData.leadEmail,
    leadName: valueData.leadName,
    campaignName: valueData.campaignName,
    channel,
    message_ts: messageTs,
    inReplyTo: valueData.inReplyTo,
    draftSubject: valueData.draftSubject,
    ...(valueData.leadId ? { leadId: valueData.leadId } : {}),
    ...(valueData.campaignId ? { campaignId: valueData.campaignId } : {}),
    ...(valueData.sendVia ? { sendVia: valueData.sendVia } : {}),
  });
  const token = await slackBotTokenFor(client.slackTeamId);
  const res = await fetch("https://slack.com/api/views.open", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      trigger_id: triggerId,
      view: {
        type: "modal",
        callback_id: DECK_MODAL_CALLBACK,
        title: { type: "plain_text", text: "Send the deck", emoji: true },
        submit: { type: "plain_text", text: "Send", emoji: true },
        close: { type: "plain_text", text: "Cancel", emoji: true },
        private_metadata: meta,
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*${company}* deck to ${valueData.leadName || valueData.leadEmail}`,
            },
          },
          // No upload box: every uploaded deck's /d/ link 404ed (Slack files.info
          // said file_not_found), and four investors got a dead link before
          // Ryan caught it on 2026-10-13. Links only until uploads are proven.
          {
            type: "input",
            block_id: "deck_url_block",
            optional: true,
            label: {
              type: "plain_text",
              text: url ? `${company} deck on file` : "Paste the deck link",
            },
            hint: {
              type: "plain_text",
              text: url
                ? "Leave it to send this one, or paste a new link to replace it."
                : "DocSend, Drive or Pitch. Open it logged out first.",
            },
            element: {
              type: "url_text_input",
              action_id: "deck_url",
              ...(url ? { initial_value: url } : {}),
            },
          },
          {
            type: "input",
            block_id: "body_block",
            label: { type: "plain_text", text: "Reply" },
            hint: {
              type: "plain_text",
              text: "DECK_LINK becomes the link above.",
            },
            element: {
              type: "plain_text_input",
              action_id: "body_input",
              multiline: true,
              initial_value: deckReplyBody(
                valueData.leadName,
                company,
                "DECK_LINK",
                signoff,
              ),
            },
          },
        ],
      },
    }),
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!data.ok)
    logger.error("replybot_deck: views.open failed", undefined, {
      error: data.error,
    });
}

/** Submit of the send-the-deck modal: save the link for the company, send the reply. */
export async function handleDeckModalSubmit(
  payload: any,
): Promise<Record<string, any>> {
  try {
    const values = payload.view?.state?.values || {};
    const typedUrl = cleanDeckUrl(values.deck_url_block?.deck_url?.value);
    // A Togari /d/ link is an old upload, and every one of those is dead.
    if (!typedUrl || /\/d\/[a-f0-9]{32}\b/.test(typedUrl)) {
      return {
        response_action: "errors",
        errors: {
          deck_url_block:
            "Paste a DocSend, Drive or Pitch link that starts with https://",
        },
      };
    }
    const meta = JSON.parse(payload.view?.private_metadata || "{}");
    const client = resolveReplybotClientFromCard(meta);
    const username = payload.user?.username || "unknown";
    if (client.retired) {
      return {
        response_action: "errors",
        errors: {
          body_block: `${client.displayName} is no longer an active replybot client. Nothing was sent.`,
        },
      };
    }
    if (!isApprover(client, payload.user?.id as string | undefined)) {
      return {
        response_action: "errors",
        errors: {
          body_block: `You are not an approved sender for ${client.displayName}.`,
        },
      };
    }
    const url = typedUrl;
    const raw = (values.body_block?.body_input?.value || "").trim();
    const body = raw.includes("DECK_LINK")
      ? raw.split("DECK_LINK").join(url)
      : raw.includes(url)
        ? raw
        : `${raw}\n\n${url}`;
    // Slack drops a modal submit that takes over 3s, so the check gets 2s.
    const dead = await linkProblem(body, (u) => linkWorks(u, 2000));
    if (dead) {
      return {
        response_action: "errors",
        errors: {
          deck_url_block: `Not sent: ${dead}. Open it logged out and paste a link that loads.`,
        },
      };
    }
    await saveDeck(client.clientId, meta.company, url, username);
    await sendReplyEmail(client, {
      to: meta.leadEmail,
      subject: meta.draftSubject || "",
      body,
      inReplyTo: meta.inReplyTo,
      leadName: meta.leadName,
      leadId: meta.leadId,
      campaignId: meta.campaignId,
      sendVia: meta.sendVia,
      sentBy: username,
    });
    await forgetAnsweredReply(meta.inReplyTo);
    const channel = meta.channel || client.slackChannelId;
    await replaceOriginalWithStatusViaUpdate(
      client,
      meta.message_ts,
      channel,
      `✅ ${meta.company} deck sent by @${username} at ${nowET()}`,
    );
    logger.info("replybot_deck: deck sent", {
      clientId: client.clientId,
      company: meta.company,
      to: meta.leadEmail,
    });
    return { response_action: "clear" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      "replybot_deck: send failed",
      err instanceof Error ? err : new Error(msg),
    );
    if (err instanceof ReplyDeliveryUnknown) {
      await holdUnknownModal(payload);
      return { response_action: "clear" };
    }
    return {
      response_action: "errors",
      errors: { body_block: `Failed to send: ${msg}` },
    };
  }
}

// ── Ambiguous track resolution handler ───────────────────────────

/**
 * Handle "Use SWE Links" or "Use BizOps Links" button clicks on an ambiguous
 * job posting message. Re-drafts with the forced track and posts a review thread.
 */
async function handleAmbiguousTrack(
  client: ReplybotClientConfig,
  payload: any,
  track: "swe" | "bizops",
  username: string,
  responseUrl: string,
  originalBlocks: any[],
  messageTs: string,
): Promise<void> {
  const action = payload?.actions?.[0];
  let buttonData: {
    clientId?: string;
    leadEmail: string;
    draftSubject: string;
    leadName: string;
    leadTitle?: string;
    leadCompany?: string;
    campaignName: string;
    campaignId: number;
    leadId: number;
    inReplyTo?: string;
    /** Conversation carried on the card — no Smartlead API to fetch it. */
    replyText?: string;
    originalOutbound?: string;
    /** Send route stamped at mint time; forwarded to the review card. */
    sendVia?: "clay";
  };

  try {
    buttonData = JSON.parse(action?.value || "{}");
  } catch {
    logger.error("smartlead_ambig: failed to parse button value");
    return;
  }

  const trackLabel = track === "swe" ? "SWE" : "BizOps";

  try {
    // Update the ambiguous message to show classification in progress
    if (responseUrl) {
      await updateSlackMessage(responseUrl, originalBlocks, [
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `🔄 Classified as *${trackLabel}* by @${username} — re-drafting with LinkedIn profiles…`,
            },
          ],
        },
      ]);
    }

    // The card carries the conversation; the Smartlead API is only a
    // fallback for cards minted before it did, and it no-ops without
    // SMARTLEAD_API_KEY (BMA runs through Clay only now).
    const needsHistory = !buttonData.replyText || !buttonData.originalOutbound;
    const history = needsHistory
      ? await fetchMessageHistory(buttonData.campaignId, buttonData.leadId)
      : { originalOutbound: null, latestInbound: null, allMessages: [] };

    // Resolve strategy (scoped to this client)
    const strategy = resolveStrategy(buttonData.campaignName, client.clientId);

    // Construct a minimal SmartleadReply for the classifier
    const reply: SmartleadReply = {
      leadId: buttonData.leadId,
      leadEmail: buttonData.leadEmail,
      leadName: buttonData.leadName,
      leadCompany: buttonData.leadCompany || "",
      leadTitle: buttonData.leadTitle || "",
      replyText: buttonData.replyText || history.latestInbound || "",
      replySubject: buttonData.draftSubject || "",
      replyTimestamp: "",
      sendingEmail: "",
      campaignId: buttonData.campaignId,
      campaignName: buttonData.campaignName,
      sequenceStep: 0,
      category: "",
      messageId: buttonData.inReplyTo || "",
      originalOutbound:
        buttonData.originalOutbound || history.originalOutbound || "",
      raw: {},
    };

    // Re-draft with forced track, in the client's voice
    const result = await classifyAndDraft(reply, {
      originalOutbound: reply.originalOutbound || null,
      strategy,
      forcedTrack: track,
      client,
    });

    // Update the ambiguous message to show classification result
    if (responseUrl) {
      await updateSlackMessage(responseUrl, originalBlocks, [
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `✅ Classified as *${trackLabel}* by @${username} — review posted in thread · ${nowET()}`,
            },
          ],
        },
      ]);
    }

    // Post review thread with the re-drafted content (includes LinkedIn links)
    await postReviewThread(
      client,
      messageTs,
      buttonData.leadEmail,
      result.draftSubject,
      result.draftBody,
      buttonData.leadName,
      buttonData.campaignName,
      buttonData.inReplyTo,
      (payload.channel?.id as string) || client.slackChannelId,
      {
        leadId: buttonData.leadId,
        campaignId: buttonData.campaignId,
        sendVia: buttonData.sendVia,
      },
    );

    logger.info(`smartlead_ambig_${track}: re-drafted and review posted`, {
      leadEmail: buttonData.leadEmail,
      track,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(
      `smartlead_ambig_${track}: failed`,
      err instanceof Error ? err : new Error(errMsg),
      {
        leadEmail: buttonData.leadEmail,
      },
    );

    if (responseUrl) {
      await updateSlackMessage(responseUrl, originalBlocks, [
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `❌ Failed to re-draft as ${trackLabel}: ${errMsg}`,
            },
          ],
        },
      ]).catch(() => {});
    }
  }
}

/**
 * Drop the reply's queue row once it has been answered.
 *
 * The row exists to get a draft in front of a person; once the reply is sent
 * it has done its job. Never allowed to fail the send — the mail has already
 * gone out by this point, so a bookkeeping error must not look like a failure
 * to whoever clicked.
 */
async function forgetAnsweredReply(inReplyTo?: string): Promise<void> {
  if (!deleteAfterSendEnabled() || !inReplyTo) return;
  try {
    await deleteReplyByThread(inReplyTo);
  } catch (err) {
    logger.warn("Could not delete the reply row after sending", {
      inReplyTo,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Send first-touch outreach through Clay.
 *
 * Deliberately NOT sendViaClay: that posts lead_id + campaign_id and refuses
 * without them, because it answers an existing campaign thread. A form fill has
 * no lead and no campaign — nobody emailed them first — so this posts the
 * person and the message and lets Clay's own send action do the rest.
 *
 * If Clay's action wants different field names, this is the only place they are
 * built.
 */
async function sendOutreachViaClay(
  client: ReplybotClientConfig,
  msg: OutboundReply,
): Promise<void> {
  const urlEnv = client.clayOutreachWebhookUrlEnv;
  const url = urlEnv ? process.env[urlEnv]?.trim() : "";
  if (!url) {
    throw new Error(
      `Client "${client.clientId}" is routing outreach through Clay but ${urlEnv ?? "its webhook env"} is not set`,
    );
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: msg.to,
      name: msg.leadName || "",
      subject: msg.subject,
      body: msg.body,
      client_id: client.clientId,
      // What tells Clay this row is a first-touch send, not a reply into a
      // campaign thread. A reply carries lead_id and campaign_id; this carries
      // neither, so the table needs `kind` to route it to the right action.
      kind: "outreach",
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Clay outreach webhook ${res.status}: ${detail.slice(0, 300)}`,
    );
  }
  logger.info("Outreach sent via Clay", {
    clientId: client.clientId,
    to: msg.to,
  });
}

async function holdUnknownModal(payload: {
  view?: { private_metadata?: string };
}): Promise<void> {
  const meta = JSON.parse(payload.view?.private_metadata || "{}");
  const client = resolveReplybotClientFromCard(meta);
  await replaceOriginalWithStatusViaUpdate(
    client,
    meta.message_ts,
    meta.channel || client.slackChannelId,
    "Delivery is being reconciled. Do not resend this reply.",
  );
}
