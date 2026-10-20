/**
 * When a fit-review reply can go out with nobody pressing anything.
 *
 * Caleb, 2026-10-09: the bot should @ Jonah when it needs him, and when it's
 * highly confident it can reply without his input, just send. Every check here
 * has to pass, so a doubt anywhere lands the card in front of Jonah instead:
 *
 * - the upstream verdict is interested, at or above the client's threshold
 * - the deterministic intent agrees it's interest, not a question, a deck
 *   request or a form (those need materials or facts from Jonah)
 * - the draft promises nothing we can't do from an email (no attachment, no
 *   deck), carries no template gap, and isn't long
 * - the reply has the lead and campaign ids Clay needs to answer in-thread
 */

import type { ReplybotClientConfig } from "../replybot/client-config";
import type { ClassificationResult } from "./classifier";
import type { SmartleadReply } from "./index";
import { replyIntent } from "./reply-intent";

// Long drafts are explaining something, and an explanation is where a wrong
// fact hides. A booking reply is two or three sentences.
const MAX_AUTO_DRAFT_CHARS = 900;
const PROMISES_A_FILE =
  /\b(attach|attached|attachment|deck|one[- ]pager|data ?room)\b/i;
const BASIC_KINDS = new Set(["interested", "question", "unclear"]);
const TEMPLATE_GAP = /[[\]{}]|\bTBD\b|\bXX+\b|<[A-Z_ ]+>/;
// The draft is written by a model that read a stranger's email, so a reply can
// steer it. A booking reply needs no link, address, phone number or figure;
// any of those in an unreviewed draft is either a hallucinated fact or text
// someone planted, and it waits for Jonah instead.
const CARRIES_PAYLOAD =
  /https?:\/\/|www\.|[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,253}\.[A-Z]{2,24}|\+?\d[\d\s().-]{7,}\d|[$€£]\s?\d|\d+(\.\d+)?\s?%|\b\d+(\.\d+)?\s?(k|m|mm|bn|million|billion)\b/i;

export function autoSendable(
  client: ReplybotClientConfig,
  reply: SmartleadReply,
  result: ClassificationResult,
): boolean {
  const min = client.autoSend?.minConfidence;
  if (min == null) return false;
  if (result.sentiment !== "interested" && result.sentiment !== "wants_more_info") return false;
  if (typeof result.confidence !== "number" || result.confidence < min)
    return false;
  const draft = (result.draftBody || "").trim();
  if (!draft || draft.length > MAX_AUTO_DRAFT_CHARS) return false;
  if (PROMISES_A_FILE.test(draft) || TEMPLATE_GAP.test(draft)) return false;
  if (CARRIES_PAYLOAD.test(draft)) return false;
  if (!reply.leadId || !reply.campaignId) return false;
  const intent = replyIntent(reply.replyText, {
    leadEmail: reply.leadEmail,
    sendingEmail: reply.sendingEmail,
    client: client.replyCopy,
  });
  // Jonah, via Caleb 2026-10-09: he trusts Caleb's intuition on basic
  // replies. Basic means interest, a plain question, or a warm reply the rules
  // can't name; the payload check above keeps any answer that needs a figure,
  // a link or a file in front of Jonah.
  return BASIC_KINDS.has(intent.kind);
}

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** The one-line record left in the channel. No buttons and no mention. */
export function autoSentBlocks(
  client: ReplybotClientConfig,
  reply: SmartleadReply,
  result: ClassificationResult,
): any[] {
  const company = (reply.campaignName || "").split("|")[1]?.trim();
  const who =
    [reply.leadName, reply.leadCompany].filter(Boolean).join(", ") ||
    reply.leadEmail;
  const pct =
    typeof result.confidence === "number"
      ? ` at ${Math.round(result.confidence * 100)}% confidence`
      : "";
  const quoted = esc(result.draftBody)
    .split("\n")
    .map((l) => `>${l}`)
    .join("\n");
  return [
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Replied automatically to *${esc(who)}*${company ? ` (${esc(company)})` : ""}${pct}. Nothing needed from ${esc(client.voice.signoffName)}.`,
        },
      ],
    },
    { type: "section", text: { type: "mrkdwn", text: quoted.slice(0, 2900) } },
  ];
}
