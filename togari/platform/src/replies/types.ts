/**
 * Perplexity reply loop — shared types for the reply_items work queue.
 *
 * The wire payload Clay sends is defined in section 6 of the implementation
 * plan and is NOT the column list: `thread_id` lands in `email_thread_id` and
 * `from` lands in `from_address`, because both wire names collide with words
 * that mean something else inside Togari.
 */

import { z } from "zod";

/**
 * BigQuery stores state as STRING. Keep delivery and human review distinct:
 * queued -> dispatching -> dispatched -> processing -> done or unresolved.
 * A result is done only after delivery confirmation and durable follow-through.
 */
export const REPLY_STATES = [
  "queued",
  "dispatching",
  "dispatched",
  "done",
  "failed",
  "processing",
  "awaiting_review",
  "needs_draft",
  "delivery_unknown",
] as const;

export type ReplyState = (typeof REPLY_STATES)[number];

/**
 * Clay is a spreadsheet, so a column that is usually text arrives as a number
 * often enough to matter — a numeric row id, a received_at that Clay decided
 * was a date. Coerce scalars rather than rejecting: a 400 here means a real
 * reply from a real prospect is dropped on the floor over a type.
 */
const looseText = (schema: z.ZodString) =>
  z.preprocess(
    (v) => (typeof v === "number" || typeof v === "boolean" ? String(v) : v),
    schema,
  );

/** Same tolerance for numeric fields: Clay and models both send "123". */
const looseNumber = z.preprocess((v) => {
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : v;
  }
  return v;
}, z.number());

/**
 * What Clay POSTs to /replies.
 *
 * Only row_id and body are required — they are the two things the queue cannot
 * work without, and the plan says to reject on either being absent. Everything
 * else is best-effort: a missing subject or campaign is a worse Slack card, not
 * a lost reply. An empty-string body counts as missing; a reply with no text is
 * nothing for the AI to read.
 */
export const ReplyIngestPayload = z.object({
  row_id: looseText(z.string().trim().min(1)),
  body: looseText(z.string().trim().min(1)),
  campaign: looseText(z.string()).nullish(),
  thread_id: looseText(z.string()).nullish(),
  from: looseText(z.string()).nullish(),
  sender_account: looseText(z.string()).nullish(),
  subject: looseText(z.string()).nullish(),
  received_at: looseText(z.string()).nullish(),
  /**
   * Clay's lead and campaign ids. Not in the plan's section 6 payload, but the
   * send is keyed on the pair — sendViaClay refuses without both rather than
   * answering from the wrong mailbox — so they have to ride from here to the
   * Slack card. Coerced because Clay sends them as either numbers or strings.
   */
  lead_id: looseNumber.nullish(),
  campaign_id: looseNumber.nullish(),
  /**
   * Who replied. Shown on the Slack card and given to Perplexity so a draft can
   * greet the prospect by name and speak to their role. lead_name is the full
   * name as one string — Clay's Full Name column, not first + last.
   */
  lead_name: looseText(z.string()).nullish(),
  lead_title: looseText(z.string()).nullish(),
  lead_company: looseText(z.string()).nullish(),
  /** Optional tenant override; defaults to REPLIES_DEFAULT_CLIENT_ID. */
  client_id: looseText(z.string()).nullish(),
});

export type ReplyIngestPayload = z.infer<typeof ReplyIngestPayload>;

/**
 * What Perplexity POSTs back when it has finished a reply (plan step 04).
 *
 * `draft` is absent when the category is negative — that is the documented
 * shape, not a malformed payload, so it must not be treated as an error.
 * Confidence is clamped rather than rejected: a model returning 1.2 is not a
 * reason to drop a finished draft on the floor.
 */
export const ReplyResultPayload = z
  .object({
    row_id: looseText(z.string().trim().min(1)),
    category: looseText(z.string().trim().min(1)).optional(),
    confidence: looseNumber.nullish(),
    draft: looseText(z.string()).nullish(),
    reasoning: looseText(z.string()).nullish(),
    session_ref: looseText(z.string()).nullish(),
    // Aliases. A model handed a list of field names will still sometimes use
    // the neighbouring synonym, and a live run lost a finished draft to
    // exactly that — the post succeeded, the category saved, and the draft
    // silently vanished. Cheaper to accept both than to debug an empty card.
    draft_body: looseText(z.string()).nullish(),
    reason: looseText(z.string()).nullish(),
    sentiment: looseText(z.string()).nullish(),
  })
  .transform((v) => ({
    ...v,
    category: (v.category ?? v.sentiment ?? "").trim(),
    draft: v.draft ?? v.draft_body ?? null,
    reasoning: v.reasoning ?? v.reason ?? null,
  }))
  .refine((v) => v.category.length > 0, {
    message: "category (or sentiment) is required",
    path: ["category"],
  });

export type ReplyResultPayload = z.infer<typeof ReplyResultPayload>;

/**
 * The plan's three categories, mapped to the sentiment vocabulary
 * upstreamDraftedReply() already speaks (smartlead-responder/index.ts).
 *
 * positive -> interested -> send-ready card.
 * negative -> not_interested -> manual review, no Send buttons (no draft).
 * needs_review is deliberately passed through unmapped: it matches none of the
 * accepted words, lands on sentiment 'other', and 'other' routes to manual
 * review — the safe default the responder already implements.
 */
export function categoryToSentiment(category: string): string {
  const c = category.trim().toLowerCase();
  if (c === "positive") return "positive";
  if (c === "negative") return "negative";
  return "needs_review";
}
