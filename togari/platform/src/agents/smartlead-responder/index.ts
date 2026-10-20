/**
 * @togari/admin — Smartlead webhook handler
 *
 * Processes incoming Smartlead webhook events (EMAIL_REPLY, LEAD_CATEGORY_UPDATED).
 * Normalizes the inconsistent webhook payload, fetches conversation history,
 * resolves campaign strategy, classifies the reply via Claude, and posts
 * one of four Slack notification tiers to Sagar:
 *
 *   postSendReadyToSlack         — interested / wants_more_info (send button + edit)
 *   postManualReviewToSlack      — not_interested / other (no draft, link to Smartlead)
 *   postAmbiguousJobPostingToSlack — job posting campaign, ambiguous track (SWE/BizOps/Edit buttons)
 *   (skip)                       — out_of_office (no Slack notification)
 */

import { createLogger } from "../../observability/logger";
import {
  classifyAndDraft,
  draftOutreach,
  draftLinkedInOutreach,
  type ClassificationResult,
  type FormFillLead,
  type LinkedInInteractionLead,
  type OutreachResult,
} from "./classifier";
import { fetchMessageHistory } from "./smartlead-api";
import { cleanReplyText, stripEmDashes } from "./reply-text";
import { resolveStrategy } from "./campaign-strategies";
import {
  fitReviewCardBlocks,
  replyCardButtons,
  splitCampaign,
} from "./fit-review";
import { getDeck } from "../../replies/decks";
import { deckButtonLabel } from "../../replies/card-copy";
import { AUTO_HANDLED, replyIntent } from "./reply-intent";
import { autoSendable, autoSentBlocks } from "./auto-send";
import { sendReplyEmail } from "./slack-actions";
import {
  vantageContext,
  vantageEnabled,
  vantageProblem,
} from "../../replies/vantage";
import {
  resolveReplybotClient,
  resolveChannel,
  CARD_SCHEMA_VERSION,
  type ReplybotClientConfig,
} from "../replybot/client-config";
import { slackBotTokenFor } from "../../transports/slack/installations";
import { sendUrgentAlert } from "../../perplexity/tokens";

const logger = createLogger("SmartleadWebhook");

// ── Interfaces ───────────────────────────────────────────────────

export interface SmartleadReply {
  leadId: number;
  leadEmail: string;
  leadName: string;
  leadCompany: string;
  leadTitle: string;
  replyText: string;
  replySubject: string;
  replyTimestamp: string;
  sendingEmail: string;
  campaignId: number;
  campaignName: string;
  sequenceStep: number;
  category: string;
  messageId: string;
  /**
   * The outbound we originally sent, when the payload carries it.
   *
   * Replies now arrive via Clay and there is no Smartlead API key any
   * more, so fetchMessageHistory can no longer supply this — the sender
   * has to put it in the webhook body or Claude drafts blind.
   */
  originalOutbound: string;
  raw: Record<string, any>;
}

/** Categories we skip entirely — no Slack notification needed. */
const SKIP_CATEGORIES = new Set([
  "out of office",
  "unsubscribe",
  "do not contact",
]);

// ── Smartlead numeric reply_category → string mapping ────────────

const REPLY_CATEGORY_MAP: Record<number, string> = {
  1: "Interested",
  2: "Meeting Request",
  3: "Not Interested",
  4: "Do Not Contact",
  5: "Information Request",
  6: "Out of Office",
  7: "Wrong Person",
  8: "Uncategorizable by AI",
  9: "Sender Originated Bounce",
};

// ── Payload normalizer ───────────────────────────────────────────

function normalizePayload(body: Record<string, any>): SmartleadReply {
  const lead = body.lead || body.lead_data || {};
  const replyMessage = body.reply_message || {};

  const leadEmail =
    body.sl_lead_email || body.to_email || lead.email || body.lead_email || "";

  const leadName =
    body.to_name ||
    (() => {
      const firstName =
        lead.first_name || lead.firstName || body.first_name || "";
      const lastName = lead.last_name || lead.lastName || body.last_name || "";
      return firstName || lastName ? `${firstName} ${lastName}`.trim() : "";
    })() ||
    body.lead_name ||
    lead.name ||
    "";

  const leadCompany =
    lead.company_name ||
    lead.companyName ||
    lead.company ||
    body.company_name ||
    body.company ||
    "";

  const leadTitle =
    lead.title || lead.job_title || lead.jobTitle || body.lead_title || "";

  // Mail clients send full HTML documents, quoted threads and all. Clean
  // it here so both the Slack card and the prompt get what the prospect
  // actually typed — see reply-text.ts.
  const replyTextRaw =
    replyMessage.text ||
    body.preview_text ||
    body.text ||
    body.email_body ||
    body.reply_text ||
    body.body ||
    body.message ||
    "";
  const replyText = cleanReplyText(replyTextRaw);

  const replySubject = body.subject || body.email_subject || "";

  const replyTimestamp =
    body.time_replied ||
    body.event_timestamp ||
    body.time ||
    body.timestamp ||
    body.reply_time ||
    body.created_at ||
    new Date().toISOString();

  const sendingEmail =
    body.from_email ||
    body.email_account ||
    body.sending_email ||
    body.from_account ||
    "";

  const campaignId = Number(body.campaign_id || body.campaignId || 0);

  const campaignName = body.campaign_name || body.campaignName || "";

  const sequenceStep = Number(
    body.sequence_number ||
      body.seq_number ||
      body.sequenceStep ||
      body.step ||
      0,
  );

  let category = "";
  if (body.reply_category != null) {
    const rc = body.reply_category;
    if (
      typeof rc === "number" ||
      (typeof rc === "string" && /^\d+$/.test(rc))
    ) {
      category = REPLY_CATEGORY_MAP[Number(rc)] || "Custom";
    } else {
      category = String(rc);
    }
  } else {
    category = body.lead_category || body.category || lead.category || "";
  }

  const messageId =
    replyMessage.message_id || body.message_id || replyMessage.id || "";

  const sentMessage =
    typeof body.sent_message === "object" && body.sent_message
      ? body.sent_message
      : {};
  const originalOutbound = cleanReplyText(
    body.original_outbound ||
      body.outbound_body ||
      body.outbound_email ||
      body.original_email ||
      (typeof body.sent_message === "string"
        ? body.sent_message
        : sentMessage.text) ||
      body.sent_body ||
      "",
  );

  return {
    leadId: Number(lead.id || body.lead_id || body.leadId || 0),
    leadEmail,
    leadName,
    leadCompany,
    leadTitle,
    replyText,
    replySubject,
    replyTimestamp,
    sendingEmail,
    campaignId,
    campaignName,
    sequenceStep,
    category,
    messageId,
    originalOutbound,
    raw: body,
  };
}

// ── Form-fill payloads (first-touch outreach, no inbound reply) ──

/** Clay sets event_type: "form_fill" in the HTTP API column body. */
function isFormFillPayload(body: Record<string, any>): boolean {
  const t = String(body.event_type || body.lead_type || "")
    .toLowerCase()
    .replace(/[-\s]/g, "_");
  return t === "form_fill" || body.form_fill === true;
}

function normalizeFormFill(body: Record<string, any>): FormFillLead {
  const name =
    body.name ||
    (() => {
      const first = body.first_name || body.firstName || "";
      const last = body.last_name || body.lastName || "";
      return first || last ? `${first} ${last}`.trim() : "";
    })();

  return {
    email: body.email || body.lead_email || body.sl_lead_email || "",
    name,
    companyName: body.company_name || body.company || "",
    companyDescription: body.company_description || body.description || "",
    domain: body.domain || body.company_domain || body.primary_domain || "",
    industry: body.industry || "",
    companySize: body.company_size || body.size || body.employees || "",
    title: body.title || body.lead_title || "",
    formName: body.form_name || body.form || body.signup_source || "",
  };
}

async function processFormFill(
  client: ReplybotClientConfig,
  body: Record<string, any>,
): Promise<void> {
  const lead = normalizeFormFill(body);

  logger.info("Processing form-fill lead", {
    clientId: client.clientId,
    leadEmail: lead.email,
    companyName: lead.companyName,
  });

  if (!lead.email) {
    logger.warn("Form fill has no email — posting notice instead of draft", {
      clientId: client.clientId,
      companyName: lead.companyName,
    });
    await slackPostMessage(client, {
      channel: resolveChannel(client, "form_fill"),
      text: `⚠️ Form fill received without an email address — can't draft outreach. Company: ${lead.companyName || "Unknown"}, Name: ${lead.name || "Unknown"}`,
    });
    return;
  }

  const result = await draftOutreach(lead, client);
  await postOutreachReadyToSlack(client, lead, result);
}

// ── LinkedIn post interactions (first-touch outreach) ────────────

/** Clay sets event_type: "linkedin_interaction" in the HTTP API column body. */
function isLinkedInInteractionPayload(body: Record<string, any>): boolean {
  const t = String(body.event_type || body.lead_type || "")
    .toLowerCase()
    .replace(/[-\s]/g, "_");
  return t === "linkedin_interaction" || t === "post_interaction";
}

function normalizeLinkedInInteraction(
  body: Record<string, any>,
): LinkedInInteractionLead {
  const name =
    body.interactor_name ||
    body.name ||
    (() => {
      const first = body.first_name || body.firstName || "";
      const last = body.last_name || body.lastName || "";
      return first || last ? `${first} ${last}`.trim() : "";
    })();

  return {
    email: body.email || body.lead_email || body.sl_lead_email || "",
    name,
    linkedinUrl:
      body.interactor_profile ||
      body.linkedin_url ||
      body.profile_url ||
      body.linkedin ||
      "",
    interactionType: String(
      body.interaction_type || body.interaction || "reaction",
    ).toLowerCase(),
    reactionType: body.reaction_type || body.reaction || "",
    commentText: body.text || body.comment_text || body.comment || "",
    postUrl: body.post_url || body.post_link || "",
    postText: body.post_text || body.post_summary || body.post_content || "",
    companyName: body.company_name || body.company || "",
    title: body.title || body.lead_title || body.job_title || "",
  };
}

/** Loose LinkedIn profile equality: protocol/www/trailing-slash insensitive. */
function sameLinkedInProfile(a?: string, b?: string): boolean {
  const norm = (u?: string) =>
    (u || "")
      .toLowerCase()
      .replace(/^https?:\/\/(www\.)?/, "")
      .replace(/\/+$/, "");
  return !!a && !!b && norm(a) === norm(b);
}

async function processLinkedInInteraction(
  client: ReplybotClientConfig,
  body: Record<string, any>,
): Promise<void> {
  const lead = normalizeLinkedInInteraction(body);

  logger.info("Processing LinkedIn interaction lead", {
    clientId: client.clientId,
    leadEmail: lead.email,
    leadName: lead.name,
    interactionType: lead.interactionType,
  });

  // The sender engaging with their own post (e.g. replying to comments)
  // shows up in the interactions table too — never draft to them.
  if (sameLinkedInProfile(lead.linkedinUrl, client.sender.linkedinUrl)) {
    logger.info("Skipping LinkedIn interaction — interactor is the sender", {
      clientId: client.clientId,
      linkedinUrl: lead.linkedinUrl,
    });
    return;
  }

  if (!lead.email) {
    logger.warn(
      "LinkedIn interaction has no email — posting notice instead of draft",
      {
        clientId: client.clientId,
        leadName: lead.name,
      },
    );
    await slackPostMessage(client, {
      channel: resolveChannel(client, "linkedin_interaction"),
      text: `⚠️ LinkedIn interaction received without an email address — can't draft outreach. Name: ${lead.name || "Unknown"}, Profile: ${lead.linkedinUrl || "Unknown"}`,
    });
    return;
  }

  // Clients with fixed copy skip Claude entirely — every engager gets
  // the same note, personalized only by first name.
  const template = client.linkedinInteractionTemplate;
  if (template) {
    const firstName = (lead.name || "").trim().split(/\s+/)[0] || "there";
    const fill = (s: string) => s.replace(/\{firstName\}/g, firstName);
    await postLinkedInOutreachToSlack(client, lead, {
      draftSubject: fill(template.subject),
      draftBody: fill(template.body),
      reason: "fixed template copy — no Claude call",
    });
    return;
  }

  const result = await draftLinkedInOutreach(lead, client);
  await postLinkedInOutreachToSlack(client, lead, result);
}

/**
 * Upstream-drafted replies (Perplexity Computer, Clay, any caller).
 *
 * Interactive Slack buttons require an app with a configured
 * interactivity Request URL — Slack POSTs the click to us and we must
 * verify and answer it. No LLM platform can hold that endpoint, so when
 * drafting moves upstream this service still renders the card and owns
 * the Send / Edit / Draft loop. The caller supplies the classification
 * and the copy; we supply the approval surface and the mailbox.
 *
 * Callers are expected to drop junk (out of office, unsubscribe, do not
 * contact) upstream rather than POST it — but sentiment is honoured
 * here too, so an out_of_office that slips through is still skipped.
 */
function upstreamDraftedReply(
  body: Record<string, any>,
): ClassificationResult | null {
  // A caller may hand us the model's raw output instead of pre-split
  // fields. Perplexity returns its JSON as a *string* inside
  // choices[0].message.content, so splitting it upstream means four
  // parse expressions in a Clay formula column — fiddly to write and
  // silent when one drifts. Passing the string through and parsing it
  // here is less work for the caller and easier to fix when a model
  // starts wrapping its JSON in prose or code fences.
  const merged = { ...body, ...parseUpstreamJson(body) };

  const draftBody =
    merged.draft_body || merged.email_body || merged.drafted_reply || "";
  // No draft normally means "this caller didn't draft anything", so we fall
  // through and draft here. The reply loop is the exception: it deliberately
  // sends a verdict with no draft when the category is negative, and falling
  // through there would pay Claude to write a reply to someone who said no,
  // then post it with Send buttons. The flag is opt-in so every existing
  // caller keeps the old behaviour.
  if (!draftBody && !merged.upstream_classified_only) return null;

  const raw = String(merged.sentiment || merged.category_label || "")
    .toLowerCase()
    .trim();
  // Accept the words a human or an upstream model actually writes.
  const sentiment: ClassificationResult["sentiment"] = [
    "interested",
    "positive",
  ].includes(raw)
    ? "interested"
    : ["wants_more_info", "more_info", "question", "neutral"].includes(raw)
      ? "wants_more_info"
      : ["not_interested", "negative"].includes(raw)
        ? "not_interested"
        : ["out_of_office", "ooo", "auto_reply"].includes(raw)
          ? "out_of_office"
          : "other";

  return {
    action: sentiment === "not_interested" ? "manual_review" : "auto_draft",
    draftSubject: merged.draft_subject || merged.email_subject || "",
    draftBody,
    reason:
      merged.reason || merged.reasoning || "classified and drafted upstream",
    urgency: "medium",
    sentiment,
    ...(merged.confidence != null &&
    merged.confidence !== "" &&
    Number.isFinite(Number(merged.confidence))
      ? { confidence: Number(merged.confidence) }
      : {}),
  };
}

/**
 * Pull the drafting fields out of a raw model response passed through as a
 * string, so the caller doesn't have to split it up first.
 *
 * Tolerates what models actually emit around their JSON: code fences,
 * a sentence of preamble, trailing commentary. Returns {} for anything
 * unparseable, which leaves the top-level fields to speak for themselves
 * rather than blanking a draft the caller sent properly.
 */
function parseUpstreamJson(body: Record<string, any>): Record<string, any> {
  const raw = body.draft_json || body.perplexity_content || body.llm_output;
  if (!raw || typeof raw !== "string") return {};

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) {
    logger.warn("Upstream draft JSON had no JSON object in it — ignoring", {
      preview: raw.slice(0, 120),
    });
    return {};
  }

  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    logger.warn("Upstream draft JSON failed to parse — ignoring", {
      preview: raw.slice(0, 120),
    });
    return {};
  }
}

// ── Main handler ─────────────────────────────────────────────────

export async function processSmartleadWebhook(
  body: unknown,
  clientId?: string,
  options: { throwOnError?: boolean; skipAutoSend?: boolean } = {},
): Promise<void> {
  console.log("[smartlead] Raw payload:", JSON.stringify(body, null, 2));

  try {
    if (!body || typeof body !== "object") {
      logger.warn("Smartlead webhook received non-object body, skipping");
      return;
    }

    const client = resolveReplybotClient(clientId);

    // Website form fills are first-touch outreach, not replies — they
    // take a separate drafting path with the client's outreach voice.
    if (isFormFillPayload(body as Record<string, any>)) {
      await processFormFill(client, body as Record<string, any>);
      return;
    }

    // Same for LinkedIn post interactions (comments/reactions/shares on
    // the sender's posts) — first-touch outreach, no inbound reply.
    if (isLinkedInInteractionPayload(body as Record<string, any>)) {
      await processLinkedInInteraction(client, body as Record<string, any>);
      return;
    }

    const reply = normalizePayload(body as Record<string, any>);

    logger.info("Processing Smartlead webhook", {
      clientId: client.clientId,
      leadEmail: reply.leadEmail,
      leadName: reply.leadName,
      category: reply.category,
      campaignName: reply.campaignName,
    });

    // Skip categories we don't need to act on
    const categoryLower = String(reply.category || "")
      .toLowerCase()
      .trim();
    if (SKIP_CATEGORIES.has(categoryLower)) {
      logger.info("Skipping webhook — auto-skip category", {
        category: reply.category,
        leadEmail: reply.leadEmail,
      });
      return;
    }

    // Fit-review clients (Zeutara) only see replies that need them. Passes,
    // out-of-office, new addresses, referrals and unsubscribes are handled by
    // zeutara-gtme's autopilot straight from Clay's inbox. Caleb, 2026-10-09:
    // "Jonah should never have to see something if it doesn't require his
    // input."
    if (client.fitReview) {
      const intent = replyIntent(reply.replyText, {
        leadEmail: reply.leadEmail,
        sendingEmail: reply.sendingEmail,
        client: client.replyCopy,
      });
      if (
        AUTO_HANDLED.has(intent.kind) &&
        !intent.isDeliveryFailure &&
        (intent.kind !== "later" || intent.isAway)
      ) {
        logger.info("Fit-review reply handled without a card", {
          clientId: client.clientId,
          leadEmail: reply.leadEmail,
          intent: intent.kind,
        });
        return;
      }
    }

    // 1-3. Classification + drafting, either upstream or here.
    let strategy: ReturnType<typeof resolveStrategy> = null;
    let result: ClassificationResult;

    const upstream = upstreamDraftedReply(body as Record<string, any>);
    if (upstream) {
      result = upstream;
      // The dash ban is a deterministic pass, not a request to the model, and
      // an upstream draft has only ever been asked nicely by a guide. Same
      // pass a Claude draft gets, or the voice setting means nothing for any
      // client drafting on Perplexity.
      if (client.voice.banEmDashes)
        result.draftBody = stripEmDashes(result.draftBody);
      logger.info("Using upstream draft — skipping Claude", {
        clientId: client.clientId,
        leadEmail: reply.leadEmail,
        sentiment: result.sentiment,
      });
    } else {
      // 1. Resolve campaign strategy (scoped to this client)
      strategy = resolveStrategy(reply.campaignName, client.clientId);

      // 2. Original outbound context. Clay-fed clients put it in the
      //    payload; the Smartlead API lookup is only a fallback for
      //    anything still arriving on the legacy /smartlead/webhook path,
      //    and it no-ops without SMARTLEAD_API_KEY (which BMA no longer
      //    sets — it runs through Clay only). With neither, the prompt
      //    says so outright rather than inventing context.
      let originalOutbound: string | null = reply.originalOutbound || null;
      if (!originalOutbound) {
        const history = await fetchMessageHistory(
          reply.campaignId,
          reply.leadId,
        );
        originalOutbound = history.originalOutbound;
      }
      if (!originalOutbound) {
        logger.warn(
          "Drafting without the original outbound — reply context is one-sided",
          {
            clientId: client.clientId,
            leadEmail: reply.leadEmail,
            campaignName: reply.campaignName,
          },
        );
      }

      // 3. Classify and draft via Claude, in the client's voice
      result = await classifyAndDraft(reply, {
        originalOutbound,
        strategy,
        client,
      });
    }

    // 4. Skip out-of-office replies (defense in depth — Smartlead may miscategorize)
    if (result.sentiment === "out_of_office") {
      logger.info("Skipping webhook — Claude classified as out_of_office", {
        leadEmail: reply.leadEmail,
      });
      return;
    }

    // 5. A confident yes needs nobody: send the draft and leave a one-line
    //    record. Caleb, 2026-10-09: "if it is highly confident it can reply
    //    without input it just" sends it.
    if (
      !options.skipAutoSend &&
      client.fitReview &&
      client.autoSend &&
      autoSendable(client, reply, result)
    ) {
      await sendReplyEmail(client, {
        to: reply.leadEmail,
        subject: result.draftSubject,
        body: result.draftBody,
        inReplyTo: reply.messageId,
        leadName: reply.leadName,
        leadId: reply.leadId,
        campaignId: reply.campaignId,
        sendVia: "clay",
      });
      await slackPostMessage(client, {
        channel: resolveChannel(client, "reply"),
        text: `Replied automatically to ${reply.leadName || reply.leadEmail}`,
        blocks: autoSentBlocks(client, reply, result),
      });
      logger.info("Fit-review reply sent automatically", {
        clientId: client.clientId,
        leadEmail: reply.leadEmail,
        confidence: result.confidence,
      });
      return;
    }

    // 6. Route to Slack
    if (
      strategy?.name === "job_posting_placement" &&
      result.track === "ambiguous"
    ) {
      await postAmbiguousJobPostingToSlack(client, reply, result);
    } else if (
      result.sentiment === "interested" ||
      result.sentiment === "wants_more_info"
    ) {
      await postSendReadyToSlack(client, reply, result);
    } else if (result.sentiment === "not_interested") {
      await postManualReviewToSlack(client, reply, result);
    } else {
      // 'other' or unknown sentiment — post as manual review
      await postManualReviewToSlack(client, reply, result);
    }

    logger.info("Smartlead webhook fully processed", {
      action: result.action,
      clientId: client.clientId,
      leadEmail: reply.leadEmail,
      sentiment: result.sentiment,
      track: result.track,
      strategy: strategy?.name || null,
    });
  } catch (err) {
    const rawBody = JSON.stringify(body, null, 2);
    console.error(
      "[smartlead] Processing error:",
      err instanceof Error ? err.message : err,
    );
    console.error(
      "[smartlead] Stack:",
      err instanceof Error ? err.stack : "no stack",
    );
    console.error("[smartlead] Raw body that caused error:", rawBody);
    logger.error(
      "Failed to process Smartlead webhook",
      err instanceof Error ? err : new Error(String(err)),
      { rawBody },
    );
    if (options.throwOnError) throw err;
  }
}

// ── Slack helpers ────────────────────────────────────────────────

/** Post into the client's workspace: its own install when it has one
 *  (slackTeamId), otherwise the home workspace. */
export async function slackPostMessage(
  client: ReplybotClientConfig,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const token = await slackBotTokenFor(client.slackTeamId);
    const call = async (
      method: string,
      body: Record<string, unknown>,
    ): Promise<any> => {
      const response = await fetch(`https://slack.com/api/${method}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Slack API HTTP ${response.status}: ${errorBody}`);
      }
      return response.json();
    };

    let data = await call("chat.postMessage", payload);
    // A public channel Togari was never invited to: join it and post once
    // more instead of dropping the card. Needs channels:join, and never works
    // for a private channel (#zeutara-cold-replies is one): there the join
    // fails, the original error stands, and someone has to /invite @Togari.
    if (!data.ok && data.error === "not_in_channel" && payload.channel) {
      const joined = await call("conversations.join", {
        channel: payload.channel,
      });
      if (joined.ok) data = await call("chat.postMessage", payload);
    }
    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error || "unknown"}`);
    }
  } catch (err) {
    // A card that fails in the home workspace shows up in our logs and our
    // channels. One that fails in a client's workspace (they removed the app,
    // or the bot was kicked from the channel) is invisible to BMA, and the
    // reply just never gets answered. Say so where BMA will see it.
    // Zeutara (fitReview) posts in our workspace now, but a lost card there
    // is a lost investor reply, so it gets the same alert.
    if (client.slackTeamId || client.fitReview) {
      const reason = err instanceof Error ? err.message : String(err);
      await sendUrgentAlert(
        `:warning: A ${client.displayName} reply card didn't post ` +
          `(${client.slackTeamId ? `workspace ${client.slackTeamId}, ` : ""}channel ${String(payload.channel)}): ${reason}. ` +
          "Check Togari is installed there and invited to the channel.",
      );
    }
    throw err;
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

function escapeSlackText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function quoteBlock(text: string): string {
  return text
    .split("\n")
    .map((line) => `>${line}`)
    .join("\n");
}

function leadInfoLine(reply: SmartleadReply): string {
  return `*Name:* ${escapeSlackText(reply.leadName || "Unknown")} | *Title:* ${escapeSlackText(reply.leadTitle || "Unknown")} | *Company:* ${escapeSlackText(reply.leadCompany || "Unknown")} | *Email:* ${escapeSlackText(reply.leadEmail)}`;
}

/**
 * How the card describes where an approved reply will go out from.
 *
 * For Gmail clients that's a fixed mailbox we impersonate. For Clay
 * clients it's whichever campaign mailbox the prospect wrote to, which we
 * don't choose and shouldn't claim to — Clay resolves it from the lead and
 * campaign ids at send time.
 */
function sendOriginLabel(
  client: ReplybotClientConfig,
  reply: SmartleadReply,
): string {
  // Reply cards take the Clay route whenever the client has it, regardless
  // of what sendMethods[0] says — [0] is the default for outreach cards,
  // which cannot go through Clay. Same condition as the button stamping in
  // buttonPayload, and they must not drift apart.
  if (client.sendMethods.includes("clay")) {
    return reply.sendingEmail
      ? `Ready to send from ${reply.sendingEmail}`
      : "Ready to send from the campaign mailbox";
  }
  return `Ready to send from ${client.sender.email}`;
}

function campaignLine(reply: SmartleadReply): string {
  // Smartlead is out of the loop entirely now (replies come via Clay), so
  // its category is no longer shown — it was always 'Unknown' anyway.
  //
  // The mailbox the prospect replied to is shown because it is the routing
  // signal: Serif's cold outbound runs several named personas across the
  // Smartsenders inboxes, and whoever's name is on the mailbox owns the
  // thread. Without it the card gives no clue whose reply this is. Omitted
  // when the payload doesn't carry it rather than printing 'Unknown'.
  const parts = [
    `Campaign: ${escapeSlackText(reply.campaignName || "Unknown")}`,
  ];
  if (reply.sendingEmail) {
    parts.push(`Replied to: ${escapeSlackText(reply.sendingEmail)}`);
  }
  return parts.join(" | ");
}

function nowET(): string {
  return (
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" }) + " ET"
  );
}

/** Blocks for a fit-review client's reply card (see fit-review.ts). */
async function fitCard(
  client: ReplybotClientConfig,
  reply: SmartleadReply,
  classification: ClassificationResult,
  verdict: string,
): Promise<any[]> {
  // A deck card's button says which deck and whether it needs an upload first.
  let primaryLabel: string | undefined;
  const intent = replyIntent(reply.replyText || "", {
    leadEmail: reply.leadEmail,
    sendingEmail: reply.sendingEmail,
    client: client.replyCopy,
  });
  if (intent.kind === "deck") {
    const company =
      splitCampaign(reply.campaignName || "", client.displayName).company ||
      client.displayName;
    const onFile = await getDeck(client.clientId, company)
      .then(Boolean)
      .catch(() => false);
    primaryLabel = await deckButtonLabel(company, onFile);
  }
  return fitReviewCardBlocks(
    {
      verdict,
      leadName: reply.leadName,
      leadTitle: reply.leadTitle,
      leadCompany: reply.leadCompany,
      leadEmail: reply.leadEmail,
      campaignName: reply.campaignName,
      sendingEmail: reply.sendingEmail,
      replyText: reply.replyText,
      draftBody: classification.draftBody,
      reason: classification.reason,
      value: buttonPayload(client, reply, classification),
      postedAt: nowET(),
      // A card only reaches the channel when it needs a person, so it @s the
      // one who can act (Caleb, 2026-10-09).
      mention: client.approvers?.[0],
      primaryLabel,
      replyCopy: client.replyCopy,
      copiedTo: (() => {
        const company =
          splitCampaign(reply.campaignName || "", client.displayName).company ||
          "";
        const copy = client.autopilot?.copy;
        return copy &&
          copy.companies.some((c) => c.toLowerCase() === company.toLowerCase())
          ? copy.to
          : undefined;
      })(),
    },
    client.displayName,
  );
}

/** Build the standard button value JSON payload. */
function buttonPayload(
  client: ReplybotClientConfig,
  reply: SmartleadReply,
  classification: ClassificationResult,
): string {
  return JSON.stringify({
    clientId: client.clientId,
    cv: CARD_SCHEMA_VERSION,
    leadEmail: reply.leadEmail,
    draftSubject: classification.draftSubject,
    draftBody: classification.draftBody,
    leadName: reply.leadName,
    campaignName: reply.campaignName,
    inReplyTo: reply.messageId,
    // Clay's "reply to lead in a campaign" action is keyed on these two,
    // so a 'clay' client cannot send without them. Omitted when zero so
    // they don't take up room in the 2000-char button value for the
    // Gmail clients that have no use for them.
    ...(reply.leadId ? { leadId: reply.leadId } : {}),
    ...(reply.campaignId ? { campaignId: reply.campaignId } : {}),
    // Which send route this card's buttons take, decided here because
    // this is where we know what kind of card it is. Only campaign
    // replies can go back through Clay — first-touch outreach (website
    // form fills, LinkedIn) has no lead or campaign to reply into, and
    // those cards mint their own values without this field, so they keep
    // using the client's default method.
    //
    // Inferring the route from the ids instead would be worse: a reply
    // whose payload lost lead_id would silently fall back to Gmail and go
    // out of the wrong mailbox under the wrong persona, which is the exact
    // failure Clay sending exists to prevent. Stamped explicitly, a
    // missing id is an error at send time instead.
    ...(client.sendMethods.includes("clay")
      ? { sendVia: "clay" as const }
      : {}),
  });
}

/** The Vantage rule a draft breaks, or null. Never throws: a card still posts. */
export async function vantageDraftProblem(
  clientId: string,
  leadEmail: string,
  draft: string,
): Promise<string | null> {
  try {
    if (!vantageEnabled(clientId) || !draft) return null;
    const ctx = await vantageContext(leadEmail);
    return ctx ? vantageProblem(draft, ctx) : null;
  } catch {
    return null;
  }
}

// ── Notification functions ───────────────────────────────────────

/**
 * Interested / wants_more_info — polished send-ready draft.
 * "Send as-is" button + "Edit & Send" button + "Save as Gmail Draft" button.
 */
async function postSendReadyToSlack(
  client: ReplybotClientConfig,
  reply: SmartleadReply,
  classification: ClassificationResult,
): Promise<void> {
  const escapedReply = escapeSlackText(truncate(reply.replyText, 2000));
  const escapedDraft = escapeSlackText(
    truncate(classification.draftBody, 2000),
  );
  // Name a Vantage rule the draft breaks on the card itself. On 2026-10-16 a
  // card drafted "The company is Ivy" for a client Vantage says never to name,
  // so pressing send could only fail.
  const blocked = await vantageDraftProblem(
    client.clientId,
    reply.leadEmail,
    classification.draftBody,
  );
  if (blocked)
    classification = {
      ...classification,
      reason:
        `Draft breaks a Vantage rule (${blocked}). Edit before sending. ${classification.reason || ""}`.trim(),
    };
  const value = buttonPayload(client, reply, classification);

  const sentimentLabel =
    classification.sentiment === "interested"
      ? "📬 Quick Reply Needed"
      : "📬 Reply Needed";

  try {
    await slackPostMessage(client, {
      channel: resolveChannel(client, "reply"),
      text: `${sentimentLabel} — ${reply.leadName || reply.leadEmail} at ${reply.leadCompany || "Unknown"}`,
      blocks: client.fitReview
        ? await fitCard(client, reply, classification, "Interested")
        : [
            {
              type: "header",
              text: {
                type: "plain_text",
                text: `${sentimentLabel} — ${truncate(reply.leadName || reply.leadEmail, 50)} at ${truncate(reply.leadCompany || "Unknown", 40)}`,
                emoji: true,
              },
            },
            {
              type: "section",
              text: { type: "mrkdwn", text: leadInfoLine(reply) },
            },
            {
              type: "section",
              text: { type: "mrkdwn", text: campaignLine(reply) },
            },
            { type: "divider" },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*Their reply:*\n${quoteBlock(escapedReply)}`,
              },
            },
            { type: "divider" },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `*${sendOriginLabel(client, reply)}:*\n${quoteBlock(escapedDraft)}`,
              },
            },
            {
              type: "actions",
              // Send / Edit, or Good fit / Not a fit first for a fit-review client.
              // Gmail drafts are left off for Clay clients: they would land in a
              // mailbox the reply never goes out of (see fit-review.ts).
              elements: replyCardButtons(client, value),
            },
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `${classification.sentiment || "unknown"} · ${classification.reason ? truncate(classification.reason, 100) : ""} · ${nowET()}`,
                },
              ],
            },
          ],
    });

    logger.info("Posted send-ready notification to Slack", {
      leadEmail: reply.leadEmail,
      sentiment: classification.sentiment,
    });
  } catch (err) {
    logger.error(
      "Failed to post send-ready notification to Slack",
      err instanceof Error ? err : new Error(String(err)),
      {
        leadEmail: reply.leadEmail,
      },
    );
    throw err;
  }
}

/**
 * Website form fill — first-touch outreach draft, same approval buttons
 * as send-ready replies (no inReplyTo: it starts a fresh thread).
 */

/**
 * True while first-touch outreach still leaves over Gmail. Once a client has a
 * Clay outreach webhook configured it does not, and a "save as draft" button
 * would file into a mailbox the mail no longer comes from.
 */
function outreachGoesViaGmail(client: ReplybotClientConfig): boolean {
  const env = client.clayOutreachWebhookUrlEnv;
  if (env && process.env[env]?.trim()) return false;
  return client.sendMethods[0] === "gmail";
}

async function postOutreachReadyToSlack(
  client: ReplybotClientConfig,
  lead: FormFillLead,
  result: OutreachResult,
): Promise<void> {
  const escapedDraft = escapeSlackText(truncate(result.draftBody, 2000));
  const value = JSON.stringify({
    clientId: client.clientId,
    cv: CARD_SCHEMA_VERSION,
    leadEmail: lead.email,
    draftSubject: result.draftSubject,
    draftBody: result.draftBody,
    leadName: lead.name,
    campaignName: lead.formName
      ? `form fill: ${lead.formName}`
      : "website form fill",
  });

  const companyBits = [
    lead.industry && `Industry: ${escapeSlackText(lead.industry)}`,
    lead.companySize && `Size: ${escapeSlackText(lead.companySize)}`,
    lead.domain && `Domain: ${escapeSlackText(lead.domain)}`,
    lead.formName && `Form: ${escapeSlackText(lead.formName)}`,
  ]
    .filter(Boolean)
    .join(" | ");

  try {
    await slackPostMessage(client, {
      channel: resolveChannel(client, "form_fill"),
      text: `🆕 Website Form Fill — ${lead.name || lead.email} at ${lead.companyName || "Unknown"}`,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `🆕 Website Form Fill — ${truncate(lead.name || lead.email, 50)} at ${truncate(lead.companyName || "Unknown", 40)}`,
            emoji: true,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Name:* ${escapeSlackText(lead.name || "Unknown")} | *Title:* ${escapeSlackText(lead.title || "Unknown")} | *Company:* ${escapeSlackText(lead.companyName || "Unknown")} | *Email:* ${escapeSlackText(lead.email)}`,
          },
        },
        ...(companyBits
          ? [{ type: "section", text: { type: "mrkdwn", text: companyBits } }]
          : []),
        ...(lead.companyDescription
          ? [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `*About them:* ${escapeSlackText(truncate(lead.companyDescription, 500))}`,
                },
              },
            ]
          : []),
        { type: "divider" },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Ready to send from ${client.sender.email}:*\n*Subject:* ${escapeSlackText(result.draftSubject)}\n${quoteBlock(escapedDraft)}`,
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "✅ Send as-is", emoji: true },
              action_id: "smartlead_send",
              style: "primary",
              value,
            },
            {
              type: "button",
              text: { type: "plain_text", text: "✏️ Edit & Send", emoji: true },
              action_id: "smartlead_edit_modal",
              value,
            },
            // Dropped once outreach goes out through Clay: a Gmail draft
            // would file into the client's own mailbox, which is not where
            // the mail leaves from any more.
            ...(outreachGoesViaGmail(client)
              ? [
                  {
                    type: "button",
                    text: {
                      type: "plain_text",
                      text: "📝 Save as Gmail Draft",
                      emoji: true,
                    },
                    action_id: "smartlead_draft",
                    value,
                  },
                ]
              : []),
          ],
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `first-touch outreach · ${result.reason ? truncate(result.reason, 100) : ""} · ${nowET()}`,
            },
          ],
        },
      ],
    });

    logger.info("Posted form-fill outreach draft to Slack", {
      clientId: client.clientId,
      leadEmail: lead.email,
    });
  } catch (err) {
    logger.error(
      "Failed to post form-fill outreach draft to Slack",
      err instanceof Error ? err : new Error(String(err)),
      {
        clientId: client.clientId,
        leadEmail: lead.email,
      },
    );
  }
}

/** Human-readable one-liner of how the lead engaged with the post. */
function interactionSummary(lead: LinkedInInteractionLead): string {
  const t = (lead.interactionType || "").toLowerCase();
  if (t === "comment") {
    return lead.commentText
      ? `Commented: "${escapeSlackText(truncate(lead.commentText, 300))}"`
      : "Commented on the post";
  }
  if (t === "share") return "Shared the post";
  return `Reacted${lead.reactionType ? ` with *${escapeSlackText(lead.reactionType)}*` : ""}`;
}

/**
 * LinkedIn post interaction — first-touch personal hello draft, same
 * approval buttons as form fills (no inReplyTo: it starts a fresh thread).
 */
async function postLinkedInOutreachToSlack(
  client: ReplybotClientConfig,
  lead: LinkedInInteractionLead,
  result: OutreachResult,
): Promise<void> {
  const escapedDraft = escapeSlackText(truncate(result.draftBody, 2000));
  const value = JSON.stringify({
    clientId: client.clientId,
    cv: CARD_SCHEMA_VERSION,
    leadEmail: lead.email,
    draftSubject: result.draftSubject,
    draftBody: result.draftBody,
    leadName: lead.name,
    campaignName: `linkedin ${lead.interactionType || "interaction"}`,
  });

  const profileBits = [
    lead.linkedinUrl && `<${lead.linkedinUrl}|LinkedIn profile>`,
    lead.postUrl && `<${lead.postUrl}|The post>`,
  ]
    .filter(Boolean)
    .join(" | ");

  try {
    await slackPostMessage(client, {
      channel: resolveChannel(client, "linkedin_interaction"),
      text: `👋 LinkedIn Interaction — ${lead.name || lead.email} engaged with ${client.sender.name}'s post`,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `👋 LinkedIn Interaction — ${truncate(lead.name || lead.email, 60)}`,
            emoji: true,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Name:* ${escapeSlackText(lead.name || "Unknown")} | *Title:* ${escapeSlackText(lead.title || "Unknown")} | *Company:* ${escapeSlackText(lead.companyName || "Unknown")} | *Email:* ${escapeSlackText(lead.email)}`,
          },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*How they engaged:* ${interactionSummary(lead)}${profileBits ? `\n${profileBits}` : ""}`,
          },
        },
        { type: "divider" },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Ready to send from ${client.sender.email}:*\n*Subject:* ${escapeSlackText(result.draftSubject)}\n${quoteBlock(escapedDraft)}`,
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "✅ Send as-is", emoji: true },
              action_id: "smartlead_send",
              style: "primary",
              value,
            },
            {
              type: "button",
              text: { type: "plain_text", text: "✏️ Edit & Send", emoji: true },
              action_id: "smartlead_edit_modal",
              value,
            },
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "📝 Save as Gmail Draft",
                emoji: true,
              },
              action_id: "smartlead_draft",
              value,
            },
          ],
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `linkedin post outreach · ${result.reason ? truncate(result.reason, 100) : ""} · ${nowET()}`,
            },
          ],
        },
      ],
    });

    logger.info("Posted LinkedIn interaction outreach draft to Slack", {
      clientId: client.clientId,
      leadEmail: lead.email,
      interactionType: lead.interactionType,
    });
  } catch (err) {
    logger.error(
      "Failed to post LinkedIn interaction outreach draft to Slack",
      err instanceof Error ? err : new Error(String(err)),
      {
        clientId: client.clientId,
        leadEmail: lead.email,
      },
    );
  }
}

/**
 * Manual review — the reply + reason, plus either BMA's "Open in
 * Smartlead" deep link (default) or, for clients with
 * approvalButtonsOnManualReview set and a non-empty draft, the drafted
 * reply with the standard Send / Edit / Draft buttons (Clay-fed clients
 * have no Smartlead inbox link to open).
 */
async function postManualReviewToSlack(
  client: ReplybotClientConfig,
  reply: SmartleadReply,
  classification: ClassificationResult,
): Promise<void> {
  const escapedReply = escapeSlackText(truncate(reply.replyText, 2000));

  const showApprovalButtons =
    !!client.approvalButtonsOnManualReview && !!classification.draftBody;

  const draftAndButtons = showApprovalButtons
    ? (() => {
        const escapedDraft = escapeSlackText(
          truncate(classification.draftBody, 2000),
        );
        const value = buttonPayload(client, reply, classification);
        return [
          { type: "divider" },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Draft (review carefully — read as "${classification.sentiment}"), ${sendOriginLabel(client, reply).replace(/^Ready to send /, "")}:*\n${quoteBlock(escapedDraft)}`,
            },
          },
          {
            type: "actions",
            elements: replyCardButtons(client, value),
          },
        ];
      })()
    : [
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "Open in Smartlead",
                emoji: true,
              },
              url: reply.raw.ui_master_inbox_link || "https://app.smartlead.ai",
              action_id: "smartlead_open_external",
            },
          ],
        },
      ];

  try {
    await slackPostMessage(client, {
      channel: resolveChannel(client, "reply"),
      text: `👀 Manual Review — ${reply.leadName || reply.leadEmail} at ${reply.leadCompany || "Unknown"}`,
      blocks:
        client.fitReview && showApprovalButtons
          ? await fitCard(client, reply, classification, "Needs a look")
          : [
              {
                type: "header",
                text: {
                  type: "plain_text",
                  text: `👀 Manual Review — ${truncate(reply.leadName || reply.leadEmail, 50)} at ${truncate(reply.leadCompany || "Unknown", 40)}`,
                  emoji: true,
                },
              },
              {
                type: "section",
                text: { type: "mrkdwn", text: leadInfoLine(reply) },
              },
              {
                type: "section",
                text: { type: "mrkdwn", text: campaignLine(reply) },
              },
              { type: "divider" },
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `*Their reply:*\n${quoteBlock(escapedReply)}`,
                },
              },
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `*Reason:* ${escapeSlackText(classification.reason)}`,
                },
              },
              ...draftAndButtons,
              {
                type: "context",
                elements: [{ type: "mrkdwn", text: nowET() }],
              },
            ],
    });

    logger.info("Posted manual-review notification to Slack", {
      leadEmail: reply.leadEmail,
      reason: classification.reason,
    });
  } catch (err) {
    logger.error(
      "Failed to post manual-review notification to Slack",
      err instanceof Error ? err : new Error(String(err)),
      {
        leadEmail: reply.leadEmail,
      },
    );
    throw err;
  }
}

/**
 * Ambiguous job posting reply — couldn't auto-classify track.
 * Shows SWE / BizOps / Edit buttons for human classification.
 */
async function postAmbiguousJobPostingToSlack(
  client: ReplybotClientConfig,
  reply: SmartleadReply,
  classification: ClassificationResult,
): Promise<void> {
  const escapedReply = escapeSlackText(truncate(reply.replyText, 2000));
  const escapedDraft = escapeSlackText(
    truncate(classification.draftBody, 2000),
  );

  // Build button value with all the context needed for re-drafting
  const ambigValue = JSON.stringify({
    clientId: client.clientId,
    cv: CARD_SCHEMA_VERSION,
    leadEmail: reply.leadEmail,
    draftSubject: classification.draftSubject,
    leadName: reply.leadName,
    leadTitle: reply.leadTitle,
    leadCompany: reply.leadCompany,
    campaignName: reply.campaignName,
    campaignId: reply.campaignId,
    leadId: reply.leadId,
    inReplyTo: reply.messageId,
    // The re-draft needs the conversation, and with no Smartlead API key
    // the card is the only place it can come from. The old draft body
    // used to sit here but was never read back — re-drafting regenerates
    // it — so its share of Slack's 2000-char button-value budget goes to
    // the two fields that actually matter.
    replyText: truncate(reply.replyText, 700),
    originalOutbound: truncate(reply.originalOutbound, 500),
    // Same route stamp as buttonPayload. Easy to think this card doesn't
    // need it, since the track buttons re-draft rather than send: but the
    // re-draft posts a review card built from THIS value, so a missing
    // stamp there means the send falls back to the client default and
    // leaves the campaign mailbox. Only BMA sees these cards (the
    // job-posting strategy is scoped to its two personas), so Serif never
    // exercised this path.
    ...(client.sendMethods.includes("clay")
      ? { sendVia: "clay" as const }
      : {}),
  });

  // Standard edit value (reuses existing edit modal handler)
  const editValue = buttonPayload(client, reply, classification);

  try {
    await slackPostMessage(client, {
      channel: resolveChannel(client, "reply"),
      text: `⚠️ Job Posting Reply — Couldn't auto-classify — ${reply.leadName || reply.leadEmail}`,
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `⚠️ Job Posting Reply — Couldn't auto-classify`,
            emoji: true,
          },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: leadInfoLine(reply) },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: campaignLine(reply) },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Claude's reasoning:* ${escapeSlackText(classification.reason || "No reasoning provided")}`,
          },
        },
        { type: "divider" },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Their reply:*\n${quoteBlock(escapedReply)}`,
          },
        },
        { type: "divider" },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Draft (without LinkedIn links):*\n${quoteBlock(escapedDraft)}`,
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Use SWE Links", emoji: true },
              action_id: "smartlead_ambig_swe",
              style: "primary",
              value: ambigValue,
            },
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "Use BizOps Links",
                emoji: true,
              },
              action_id: "smartlead_ambig_bizops",
              value: ambigValue,
            },
            {
              type: "button",
              text: { type: "plain_text", text: "✏️ Edit & Send", emoji: true },
              action_id: "smartlead_edit_modal",
              value: editValue,
            },
          ],
        },
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: `ambiguous track · ${nowET()}` }],
        },
      ],
    });

    logger.info("Posted ambiguous job posting notification to Slack", {
      leadEmail: reply.leadEmail,
      reasoning: classification.reason,
    });
  } catch (err) {
    logger.error(
      "Failed to post ambiguous job posting notification to Slack",
      err instanceof Error ? err : new Error(String(err)),
      {
        leadEmail: reply.leadEmail,
      },
    );
    throw err;
  }
}
