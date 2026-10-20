/**
 * Clay → Togari reply intake for the Perplexity reply loop.
 *
 * POST /replies
 *   Authorization: Bearer <REPLIES_INGEST_TOKEN>
 *   Body: section 6 of the implementation plan (row_id, campaign, thread_id,
 *         from, sender_account, subject, body, received_at)
 *
 * Response:
 *   201 { id, row_id, state: 'queued', duplicate: false }  — new row
 *   200 { id, row_id, state, duplicate: true }             — already had it
 *   400 { error: 'invalid_payload' }                       — no row_id or no body
 *   401 { error: 'unauthorized' }
 *   500 { error: 'internal_error' | 'REPLIES_INGEST_TOKEN not configured' }
 *
 * The 200-on-duplicate is the whole point of this endpoint, not a nicety. Clay
 * resends rows routinely and has auto-retry on, so the second POST is the
 * common case, and an error there would make Clay retry harder.
 *
 * Router applies its own scoped express.json(), so it mounts before the global
 * one (same pattern as createIcpCallbackRouter).
 */

import { runAutopilot } from "../replies/autopilot";
import { cleanLeadName } from "../replies/lead-name";
import { isAutoReply, winLine, type Win } from "../replies/card-copy";
import { slackBotTokenFor } from "../transports/slack/installations";
import {
  autoSend,
  defaultDeckLookup,
  linkWorks,
  sentPost,
} from "../replies/auto-send";
import {
  vantageContext,
  vantageEnabled,
  vantageLogSent,
} from "../replies/vantage";
import { sendReplyEmail } from "../agents/smartlead-responder/slack-actions";
import { ReplyPreflightError } from "../replies/delivery";
import { replyIntent } from "../agents/smartlead-responder/reply-intent";
import { htmlToText } from "./client-dashboard";

const WIN_KINDS = new Set(["new_address", "referral", "later"]);

function companyOf(campaign: string | null | undefined): string {
  return (campaign || "").split("|")[1]?.trim() || "";
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function postToChannel(
  client: NonNullable<ReturnType<typeof getReplybotClient>>,
  msg: { text: string; blocks: unknown[] },
): Promise<void> {
  if (!client.slackChannelId) return;
  const token = await slackBotTokenFor(client.slackTeamId);
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ channel: client.slackChannelId, ...msg }),
  });
}

/**
 * Caleb, 2026-10-11: "everything we handle should be sent in the slack but
 * just not with jonah tagged". The quiet outcomes get one plain line too.
 */
export function quietLine(
  kind: string,
  leadName: string | null | undefined,
  company: string,
  body: string,
): string | null {
  const who = leadName || "An investor";
  const what = company || "the raise";
  if (kind === "pass") return `${who} passed on ${what}. Logged, nothing sent.`;
  if (kind === "unsubscribe")
    return `${who} asked to be taken off the list. Togari removed them.`;
  if (kind === "ignore")
    return `${who} sent an automatic reply about ${what}. Logged, nothing sent.`;
  if (kind === "later" && isAutoReply(body))
    return `${who} is out of the office. Togari follows up when they're back.`;
  return null;
}

async function postWin(
  p: { body: string; lead_name?: string | null; campaign?: string | null },
  clientId: string,
  auto: { kind: string; forwardedTo?: string[]; followUpOn?: string },
): Promise<void> {
  const client = getReplybotClient(clientId);
  if (!client?.fitReview || !client.slackChannelId) return;
  const company = companyOf(p.campaign) || client.displayName;
  const quiet = quietLine(auto.kind, p.lead_name, company, p.body);
  if (quiet) {
    await postToChannel(client, {
      text: quiet,
      blocks: [
        { type: "context", elements: [{ type: "mrkdwn", text: esc(quiet) }] },
      ],
    });
    return;
  }
  if (!WIN_KINDS.has(auto.kind)) return;
  const line = await winLine({
    kind: auto.kind as Win["kind"],
    leadName: p.lead_name ?? null,
    company,
    replyText: p.body,
    forwardedTo: auto.forwardedTo,
    followUpOn: auto.followUpOn ? new Date(auto.followUpOn) : undefined,
  });
  const token = await slackBotTokenFor(client.slackTeamId);
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      channel: client.slackChannelId,
      text: line,
      blocks: [
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `:white_check_mark:  ${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}`,
            },
          ],
        },
      ],
    }),
  });
}
import crypto from "crypto";
import express, {
  type Request,
  type Response,
  type Router,
  type NextFunction,
} from "express";
import { createLogger } from "../observability/logger";
import {
  ReplyIngestPayload,
  ReplyResultPayload,
  categoryToSentiment,
} from "../replies/types";
import { getReplybotClient } from "../agents/replybot/client-config";
import {
  cardRequiresDraft,
  defaultClientId,
  deleteReplyByRowId,
  findReplyItem,
  insertQueuedReply,
  markHandledByAutopilot,
  replyItemId,
  getReplyItem,
  claimReplyResult,
  finishReplyResult,
  saveExpectedReply,
  inboundReplyId,
  reconcileResultState,
} from "../replies/store";
import { processSmartleadWebhook } from "../agents/smartlead-responder";

const logger = createLogger("routes/replies");

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Accepted tokens, comma-separated so a token handed to Clay can be rotated
 * without a window where replies bounce: add the new one, swap Clay's column
 * header, then drop the old one.
 */
function acceptedTokens(): string[] {
  return (process.env.REPLIES_INGEST_TOKEN ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function tokensFrom(envVar: string): string[] {
  return (process.env[envVar] ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Bearer auth against a comma-separated token variable. Shared with
 * /connections, whose intake and callback use these same two tokens: the same
 * Clay workspace sends both, and the same Perplexity project vault answers
 * both.
 */
export function bearerAuth(envVar: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const expected = tokensFrom(envVar);
    if (expected.length === 0) {
      logger.error(`${envVar} not configured; refusing request`);
      res.status(500).json({ error: `${envVar} not configured` });
      return;
    }
    const provided = (req.header("authorization") || "")
      .replace(/^Bearer\s+/i, "")
      .trim();
    if (!provided || !expected.some((token) => safeEqual(provided, token))) {
      logger.warn("replies.auth.rejected", {
        route: req.path,
        hasHeader: !!provided,
      });
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };
}

function requireRepliesAuth(req: Request, res: Response, next: NextFunction) {
  const expected = acceptedTokens();
  if (expected.length === 0) {
    // Fail closed. An unset token must not mean "open endpoint" on a route
    // whose whole job is to accept writes from outside.
    logger.error("REPLIES_INGEST_TOKEN not configured; refusing intake");
    res.status(500).json({ error: "REPLIES_INGEST_TOKEN not configured" });
    return;
  }
  const provided = (req.header("authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!provided || !expected.some((token) => safeEqual(provided, token))) {
    logger.warn("replies.auth.rejected", { hasHeader: !!provided });
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

export function createRepliesRouter(): Router {
  const router: Router = express.Router();
  // Reply bodies are whole email threads; 1mb leaves room for a long quoted
  // chain without letting an unbounded payload through.
  router.use(express.json({ limit: "1mb" }));

  router.post("/", requireRepliesAuth, async (req: Request, res: Response) => {
    const parsed = ReplyIngestPayload.safeParse(req.body);
    if (!parsed.success) {
      // Nothing is saved on a 400 — a row with no body is not work we can do.
      logger.warn("replies.invalid_payload", {
        fields: Object.keys(parsed.error.flatten().fieldErrors),
      });
      return res.status(400).json({
        error: "invalid_payload",
        details: parsed.error.flatten(),
      });
    }
    const payload = parsed.data;
    // The feeder appends a stray "e" to names; see src/replies/lead-name.ts.
    payload.lead_name =
      cleanLeadName(
        payload.lead_name,
        payload.from,
        Boolean(
          getReplybotClient(payload.client_id || defaultClientId() || "")
            ?.leadNameTrailingE,
        ),
      ) ?? payload.lead_name;
    let rowId = payload.row_id.trim();

    // Which client this reply belongs to decides its Slack channel, its voice,
    // its Perplexity account and the mailbox any answer leaves from. Getting it
    // wrong is a cross-client leak, so it is never inferred: the payload says,
    // or a configured fallback says, or the request is refused.
    const clientId = payload.client_id?.trim() || defaultClientId();
    if (!clientId) {
      logger.warn("replies.no_client_id", { rowId });
      return res.status(400).json({
        error: "client_id_required",
        detail:
          "Send client_id in the payload (each client's Clay column sends its own), " +
          "or set REPLIES_DEFAULT_CLIENT_ID for a column that cannot yet.",
      });
    }
    if (!getReplybotClient(clientId)) {
      // A typo must not become a silent misattribution.
      logger.warn("replies.unknown_client_id", { rowId, clientId });
      return res.status(400).json({
        error: "unknown_client_id",
        detail: `No replybot client "${clientId}"`,
      });
    }
    if (!payload.client_id?.trim()) {
      logger.warn("replies.client_id_defaulted", { rowId, clientId });
    }

    rowId = inboundReplyId(clientId, payload);
    payload.row_id = rowId;
    try {
      const existing = await findReplyItem(rowId);
      if (existing) {
        logger.info("replies.duplicate", { rowId, state: existing.state });
        return res.status(200).json({
          id: existing.id,
          row_id: existing.row_id,
          state: existing.state,
          duplicate: true,
        });
      }

      const { id, inserted } = await insertQueuedReply(payload, clientId);
      if (!inserted) {
        // Lost a race with a concurrent POST of the same row_id. The other one
        // created the row, so this is a duplicate like any other.
        return res
          .status(200)
          .json({ id, row_id: rowId, state: "queued", duplicate: true });
      }

      logger.info("replies.queued", { rowId, id });

      // Replies nobody needs to see are finished here, before the sweeper can
      // pay Perplexity for them. A failure inside falls back to the normal path.
      const auto = await runAutopilot(payload, clientId);
      if (auto.outcome === "handoff") {
        await reconcileResultState(rowId, "queued", "awaiting_review");
        return res.status(201).json({
          id,
          row_id: rowId,
          state: "awaiting_review",
          duplicate: false,
          handoff: auto.kind,
        });
      }
      if (auto.outcome === "handled") {
        await markHandledByAutopilot(rowId, auto.kind);
        logger.info("replies.autopilot_handled", { rowId, kind: auto.kind });
        // Good news Togari handled itself still shows up in the client's
        // channel, as one line with no buttons. Caleb, 2026-10-09: "the
        // positive things happening that togari handled on its own should
        // still show up there". Never blocks or fails the intake.
        postWin(payload, clientId, auto).catch((err) =>
          logger.warn("replies.win_post_failed", { rowId, error: String(err) }),
        );
        return res.status(201).json({
          id,
          row_id: rowId,
          state: "done",
          duplicate: false,
          autopilot: auto.kind,
        });
      }

      return res
        .status(201)
        .json({ id, row_id: rowId, state: "queued", duplicate: false });
    } catch (err) {
      logger.error(
        "replies.intake_failed",
        err instanceof Error ? err : new Error(String(err)),
        { rowId, id: replyItemId(rowId) },
      );
      return res.status(500).json({ error: "internal_error" });
    }
  });

  /**
   * POST /replies/result — where Perplexity posts a finished draft (step 04).
   *
   * The callback carries only row_id and the verdict, so the email itself is
   * read back from the queue row. That is the point of keying on row_id: the
   * alternative, having Perplexity echo the whole email back, both bloats the
   * prompt and lets a model mangle the ids the send depends on.
   *
   * Always 200 on an authorized, well-formed request once the row is known —
   * Perplexity retrying a non-2xx would re-run paid work.
   */
  router.post(
    "/result",
    bearerAuth("REPLY_RESULT_TOKEN"),
    async (req: Request, res: Response) => {
      const parsed = ReplyResultPayload.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "invalid_payload",
          details: parsed.error.flatten(),
        });
      }
      const result = parsed.data;
      const rowId = result.row_id.trim();
      let deliveryAttempted = false;
      let ownsClaim = false;

      try {
        const row = await getReplyItem(rowId);
        if (!row) {
          logger.warn("replies.result.unknown_row", { rowId });
          return res.status(404).json({ error: "unknown_row_id" });
        }

        // Claim before posting. Wins the race or finds the row already done;
        // either way exactly one card is ever created for a row_id.
        const claimed = await claimReplyResult({
          rowId,
          category: result.category,
          confidence: result.confidence,
          draft: result.draft,
          reasoning: result.reasoning,
          sessionRef: result.session_ref,
        });
        if (!claimed) {
          logger.info("replies.result.duplicate", { rowId });
          return res
            .status(200)
            .json({ row_id: rowId, state: row.state, duplicate: true });
        }
        ownsClaim = true;
        // Dispatch can race intake. A model's negative verdict cannot erase
        // a delivery failure that still needs operational repair.
        if (replyIntent(htmlToText(row.body)).isDeliveryFailure) {
          await finishReplyResult(rowId, "awaiting_review");
          return res.status(200).json({
            row_id: rowId,
            state: "awaiting_review",
            card_posted: false,
            reason: "delivery repair required",
          });
        }

        // Rebuild the payload the replybot already speaks. Field names are
        // deliberately its names, not the plan's: `sentiment` and `draft_body`
        // are what upstreamDraftedReply() reads, so nothing in the responder
        // needs to change to understand a Perplexity verdict.
        // Negative is discarded, not filed. Nobody answers a no, so the row
        // has no further purpose and keeping a prospect's email in BigQuery
        // for one is worse than dropping it. Deleted before the claim, since
        // there is nothing to claim it for.
        if (categoryToSentiment(result.category) === "negative") {
          await deleteReplyByRowId(rowId);
          logger.info("replies.result.negative_discarded", { rowId });
          return res.status(200).json({
            row_id: rowId,
            state: "discarded",
            card_posted: false,
            reason: "negative",
          });
        }

        // A verdict with no draft is not worth a card. The AI writes no draft
        // for `negative` by instruction, and for an out-of-office because the
        // guide says so — both produce a card nobody can act on, which is
        // noise in the channel people are meant to be working out of. The row
        // still records the classification; only the Slack post is skipped.
        const draft = (result.draft ?? "").trim();
        if (!draft && cardRequiresDraft()) {
          await finishReplyResult(rowId, "needs_draft");
          logger.info("replies.result.no_card_without_draft", {
            rowId,
            category: result.category,
          });
          return res.status(200).json({
            row_id: rowId,
            state: "needs_draft",
            card_posted: false,
            reason: "no draft",
          });
        }

        // Replies that don't need Jonah go out now, and the channel gets a
        // line with what came in and what went back, no mention. A send that
        // fails falls through to the card, so nothing is ever dropped.
        const autoClient = getReplybotClient(row.client_id ?? "");
        let deliveryUnknown = false;
        if (
          autoClient?.autopilot &&
          !process.env.REPLIES_FORCE_CLIENT_ID?.trim()
        ) {
          try {
            const sent = await autoSend(autoClient, row, draft, {
              send: async (client, message) => {
                await saveExpectedReply(rowId, message.body);
                deliveryAttempted = true;
                await sendReplyEmail(client, message);
              },
              deckFor: defaultDeckLookup,
              linkWorks,
              ...(vantageEnabled(autoClient.clientId)
                ? {
                    vantage: {
                      context: vantageContext,
                      logSent: vantageLogSent,
                    },
                  }
                : {}),
            });
            if (sent.sent) {
              await finishReplyResult(rowId, "done");
              logger.info("replies.result.auto_sent", {
                rowId,
                kind: sent.kind,
              });
              postToChannel(
                autoClient,
                sentPost(
                  row.lead_name,
                  companyOf(row.campaign),
                  row.body,
                  sent.body,
                ),
              ).catch((err) =>
                logger.warn("replies.sent_post_failed", {
                  rowId,
                  error: String(err),
                }),
              );
              return res
                .status(200)
                .json({ row_id: rowId, state: "done", auto_sent: true });
            }
            logger.info("replies.result.needs_person", {
              rowId,
              kind: sent.kind,
              reason: sent.reason,
            });
          } catch (err) {
            deliveryUnknown =
              deliveryAttempted && !(err instanceof ReplyPreflightError);
            if (err instanceof ReplyPreflightError) deliveryAttempted = false;
            logger.error(
              "replies.result.auto_send_failed",
              err instanceof Error ? err : new Error(String(err)),
              { rowId },
            );
          }
        }

        if (deliveryUnknown) {
          await finishReplyResult(rowId, "delivery_unknown");
          return res.status(202).json({
            row_id: rowId,
            state: "delivery_unknown",
            card_posted: false,
          });
        }

        // Belt and braces on top of the default. A row stored earlier can carry
        // a live client_id, and a test run must not be able to reach the
        // channel a client works out of — that has happened once. While this
        // is set, every card goes to the named client regardless of the row.
        const forced = process.env.REPLIES_FORCE_CLIENT_ID?.trim();
        const cardClientId = forced || row.client_id || undefined;
        if (forced && forced !== row.client_id) {
          logger.warn("replies.result.client_forced", {
            rowId,
            stored: row.client_id,
            forced,
          });
        }

        await processSmartleadWebhook(
          {
            to_email: row.from_address ?? "",
            text: row.body,
            subject: row.subject ?? "",
            campaign_name: row.campaign ?? "",
            message_id: row.email_thread_id ?? "",
            from_email: row.sender_account ?? "",
            lead_id: row.lead_id ?? undefined,
            campaign_id: row.campaign_id ?? undefined,
            // The responder's own field names, so the card's Name / Title /
            // Company line fills instead of reading "Unknown".
            to_name: row.lead_name ?? undefined,
            lead_title: row.lead_title ?? undefined,
            company_name: row.lead_company ?? undefined,
            sentiment: categoryToSentiment(result.category),
            confidence: result.confidence,
            draft_body: result.draft ?? "",
            reason: result.reasoning ?? "",
            upstream_classified_only: true,
          },
          cardClientId,
          { throwOnError: true, skipAutoSend: true },
        );

        const state = "awaiting_review";
        await finishReplyResult(rowId, state);

        logger.info("replies.result.posted", {
          rowId,
          category: result.category,
          hasDraft: !!result.draft,
        });
        return res.status(200).json({ row_id: rowId, state });
      } catch (err) {
        // An interrupted send must never be automatically replayed. The live
        // inbox reconciliation identifies whether the provider accepted it.
        if (ownsClaim)
          await finishReplyResult(
            rowId,
            deliveryAttempted ? "delivery_unknown" : "needs_draft",
          ).catch((persistError) =>
            logger.error(
              "replies.result.state_failed",
              persistError instanceof Error
                ? persistError
                : new Error(String(persistError)),
              { rowId },
            ),
          );
        logger.error(
          "replies.result.post_failed",
          err instanceof Error ? err : new Error(String(err)),
          { rowId },
        );
        return res.status(500).json({ error: "internal_error" });
      }
    },
  );

  return router;
}
