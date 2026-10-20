/**
 * The message Togari sends to Perplexity (plan step 06e).
 *
 * The INSTRUCTIONS half is step 11's job and is deliberately a placeholder —
 * step 09 writes the categories/voice document, step 11 writes the wording that
 * points at it. This file is where that wording lands; the plumbing around it
 * is finished.
 *
 * Two things that are NOT placeholders, because getting them wrong is silent:
 *
 *   1. The field names are the CALLBACK's (row_id, category, confidence, draft,
 *      reasoning) — what POST /replies/result parses. Not the replybot's
 *      internal sentiment/draft_body/reason: the adapter in routes/replies.ts
 *      does that translation. Asking for the internal names cost a live run —
 *      the endpoint accepted the post, saved the category, and silently
 *      dropped the draft and the reasoning, producing a card with no draft.
 *   2. The callback token is never written into this message. Perplexity keeps
 *      a readable record of everything a session does; the token lives in its
 *      credential store instead (step 10).
 */

import type { ReplyItemRow } from "../replies/store";
import { getReplybotClient } from "../agents/replybot/client-config";
import { htmlToText } from "../routes/client-dashboard";

function resultHost(): string {
  return new URL(resultEndpoint()).host;
}

function resultEndpoint(): string {
  const base = (
    process.env.TOGARI_PUBLIC_BASE_URL ||
    "https://togari-bma-prod.up.railway.app"
  ).replace(/\/+$/, "");
  return `${base}/replies/result`;
}

/**
 * This client's published categories/voice guide (step 09).
 *
 * Per client, because every client gets their own categories, edge cases and
 * voice — Serif's rules are not Zeutara's. Resolution is the client's named env var
 * first (SERIF_REPLY_GUIDE_URL), then the <CLIENT>_REPLY_GUIDE_URL convention
 * for a client with no explicit pointer.
 *
 * Deliberately no shared fallback: a client silently drafting against another
 * client's guide is worse than one drafting against none, which at least reads
 * as obviously generic.
 */
function guideUrlFor(clientId: string): string | null {
  const named = getReplybotClient(clientId)?.replyGuideUrlEnv;
  if (named) {
    const value = process.env[named]?.trim();
    if (value) return value;
  }
  const conventional = `${clientId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_REPLY_GUIDE_URL`;
  return process.env[conventional]?.trim() || null;
}

/** Step 11's instructions. */
function instructions(row: ReplyItemRow): string {
  const guide = guideUrlFor(row.client_id ?? "serif");
  return [
    "You are handling one inbound reply to a cold outreach email.",
    "",
    ...(guide
      ? [
          `First, open and read this document — it defines the categories, the`,
          `edge cases, and how a reply should sound: ${guide}`,
          "Follow it over your own judgement where the two differ.",
          "",
        ]
      : []),
    "Then do this, and stop:",
    "1. Decide one category: positive (interested), negative (not interested),",
    "   or needs_review (unclear, a human should look).",
    "2. Write a suggested reply for EVERY category except negative — including",
    "   needs_review. A verdict with no draft is discarded and nobody sees it,",
    "   so if you are unsure, write the short safe version rather than nothing.",
    `3. POST the result to ${resultEndpoint()} as JSON, authenticating with the`,
    `   saved credential for host ${resultHost()}. It is already stored in this`,
    "   project's credentials — use it directly. Do NOT open a credential",
    "   request form: nobody is watching this session to approve one, and the",
    "   request is denied, which blocks the whole task.",
    "   Fields, with exactly these names:",
    "     row_id     (use exactly the value given below)",
    "     category   positive | negative | needs_review",
    "     confidence a number from 0 to 1",
    "     draft      the suggested reply (omit when the category is negative)",
    "     reasoning  one line on why you chose that category",
    "4. Then stop. Do not send any email yourself.",
    "",
    `row_id: ${row.row_id}`,
  ].join("\n");
}

/** The instructions plus the email itself. */
export function buildTaskMessage(row: ReplyItemRow): string {
  return [
    instructions(row),
    "",
    "--- The reply to handle ---",
    `From: ${row.from_address ?? "(unknown)"}`,
    `Name: ${row.lead_name ?? "(unknown)"}`,
    `Title: ${row.lead_title ?? "(unknown)"}`,
    `Company: ${row.lead_company ?? "(unknown)"}`,
    `To: ${row.sender_account ?? "(unknown)"}`,
    `Campaign: ${row.campaign ?? "(unknown)"}`,
    `Subject: ${row.subject ?? "(none)"}`,
    "",
    htmlToText(row.body),
  ].join("\n");
}
