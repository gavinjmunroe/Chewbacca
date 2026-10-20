/**
 * @togari/admin — Cloud Run admin service
 *
 * Provides admin endpoints (health, audit queries, tenant management)
 * alongside the shared library exports.
 */

import crypto from "crypto";
import express from "express";
import {
  handleDashboard,
  startDashboardRefresh,
} from "./routes/client-dashboard";
import { handleStuck, startStuckRefresh } from "./routes/client-stuck";
import {
  handleAddPlan,
  handleCampaignCalendar,
  handleRemovePlan,
} from "./routes/campaign-calendar";
import { startCalendarRefresh } from "./campaigns/calendar";
import { createCampaignEventsRouter } from "./routes/campaign-events";
import { startInboxPoller } from "./replies/inbox-poller";
import { startOutcomeCheck } from "./replies/outcome-check";
import { startBounceGuard } from "./campaigns/bounce-guard";
import { startClaySessionAlert } from "./integrations/clay/session-alert";
import { startClayCalendarSync } from "./campaigns/clay-sync";
import cors from "cors";
import helmet from "helmet";
import { BigQueryClient } from "./bigquery/client";
import {
  ALL_BRANDS,
  BRAND_PIPELINES,
  isValidBrand,
  isValidBrandPipelineCombo,
} from "./core/config/brand-pipelines";
import { createLogger } from "./observability/logger";
import { initSentry, flushSentry } from "./observability/sentry";
import {
  oauthProtectedResourceHandler,
  oauthDiscoveryHandler,
} from "./auth/jwt";
import { connectorRegistry } from "./resilience/connector-registry";
import {
  processInboxes,
  getTeam,
  getDefaultSlackChannel,
  type TeamMember,
} from "./email-engine";
import { slackEventsHandler } from "./transports/slack";
import { slackTenantMiddleware } from "./transports/slack/tenant-middleware";
import { processSmartleadWebhook } from "./agents/smartlead-responder";
import { sweepFollowups } from "./replies/autopilot";
import { sendReplyEmail } from "./agents/smartlead-responder/slack-actions";
import { isReplybotCardAction } from "./agents/smartlead-responder/fit-review";
import {
  handleSmartleadSlackAction,
  handleSmartleadModalSubmit,
  handleDeckModalSubmit,
  DECK_MODAL_CALLBACK,
} from "./agents/smartlead-responder/slack-actions";
import { replybotWebhookHandler } from "./agents/replybot/webhook";
import {
  deckFileByToken,
  storedDeckByToken,
  warmStoredDecks,
} from "./replies/decks";
import {
  ASSISTANT_CANCEL,
  ASSISTANT_CONFIRM,
  handleAssistantAction,
} from "./agents/client-assistant";
import { slackBotTokenFor } from "./transports/slack/installations";
import { getReplybotClient } from "./agents/replybot/client-config";
import { getBotUserId } from "./transports/slack/bot-identity";
import { isHomeWorkspaceInteraction } from "./transports/slack/workspace-gate";
import { createSlackOAuthRouter } from "./routes/slack-oauth";
import {
  hasSlackUserToken,
  checkSlackUserToken,
} from "./transports/slack/user-client";
import {
  handleTogariConfirmAction,
  isTogariConfirmActionId,
} from "./transports/slack/confirm-actions";
import {
  handleCancelReminder,
  isTogariReminderActionId,
} from "./transports/slack/reminder-confirm";
import { setupMcpRoutes } from "./transports/mcp/server";
import { apiRouter } from "./transports/api/router";
import { firefliesWebhookHandler } from "./transports/webhooks/fireflies";
import { tenantStorage } from "./tenant/context";
import { resolveDataset } from "./services/dataset-resolver";
import { createClayIngestRouter } from "./routes/ingest/clay";
import { createClayPassthroughIngestRouter } from "./routes/ingest/clay-passthrough";
import { createClayLeadRouter } from "./routes/ingest/clay-lead";
import { createIcpCallbackRouter } from "./routes/ingest/icp-callback";
import { createRepliesRouter } from "./routes/replies";
import { createConnectionsRouter } from "./routes/connections";
import { runConnectionDigests } from "./connections/digest";
import {
  CONNECTION_EDIT_CALLBACK_ID,
  handleConnectionDraftSubmit,
  handleConnectionEditAction,
  handleConnectionPathAction,
  isConnectionPathAction,
} from "./connections/slack-actions";
import {
  sweepRepliesGuarded,
  sweepConnectionsGuarded,
  sweepConfig,
  replyLoopStatus,
  connectionLoopStatus,
  recordSweepRun,
  recordConnectionSweepRun,
} from "./perplexity/sweeper";
import { createWebsiteRouter } from "./routes/website";
import { sweepStalledJobs, sweepTimedOutJobs } from "./icp/service";
import { notifyInternal } from "./icp/email";
import { formatIcpOutcomeAlert } from "./icp/slack";
import { createClayConnectorRouter } from "./routes/clay-connector";
import { createUniversalIngestRouter } from "./routes/ingest/universal";
import { createAutoIngestRouter } from "./routes/ingest/auto";
import { createEnrichRouter } from "./routes/enrich";
import { createProvisionPortalRouter } from "./routes/portal/provision";
import { portalAuth } from "./middleware/portal-auth";
import { createLiveReadPortalRouter } from "./routes/portal/live-read";
import { createCalendarRouter } from "./routes/calendar";
import { createFetchRouter } from "./routes/fetch-sources";
import {
  startWorkerSubscribers,
  stopWorkerSubscribers,
} from "./worker/subscribers";

const logger = createLogger("togari-admin");

// Email engine state
const lastCheckTimes = new Map<string, Date>();
let pollInterval: ReturnType<typeof setInterval> | null = null;
let icpSweepInterval: ReturnType<typeof setInterval> | null = null;

async function main() {
  await initSentry();

  // SLACK_BOT_TOKEN gate. In production, missing token is FATAL — the
  // bot boots, accepts /slack/events, and silently fails every API
  // call, which is worse than failing fast at startup. In dev (any
  // NODE_ENV !== 'production'), we keep the soft-warn path so offline
  // work doesn't require a token.
  if (!process.env.SLACK_BOT_TOKEN) {
    if (process.env.NODE_ENV === "production") {
      // eslint-disable-next-line no-console -- pre-logger boot error
      console.error(
        "[FATAL] SLACK_BOT_TOKEN env var required in production. Set it in Railway and redeploy.",
      );
      process.exit(1);
    }
    logger.warn("[dev] SLACK_BOT_TOKEN not set — Slack integration disabled");
  }

  // SLACK_USER_TOKEN (xoxp-) is optional — nothing boots without it. When
  // it IS set we validate it here rather than at first use, because the
  // usual failure (the xoxb- bot token pasted into the wrong var) is
  // otherwise invisible until some API returns not_allowed_token_type.
  if (hasSlackUserToken()) {
    try {
      const identity = await checkSlackUserToken();
      logger.info(
        `Slack user token active as ${identity?.user} (${identity?.userId})`,
      );
    } catch (err) {
      logger.warn("SLACK_USER_TOKEN is set but unusable", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Boot-time Slack bot identity resolution. Cached for the process
  // lifetime — used by the tool-use loop's thread-context fetcher to
  // distinguish bot replies from human replies in conversations.replies.
  // In dev (no token), we skip; in prod the FATAL above already aborted.
  if (process.env.SLACK_BOT_TOKEN) {
    try {
      const botUserId = await getBotUserId();
      logger.info(`Togari bot user id resolved: ${botUserId}`);
    } catch (err) {
      logger.warn(
        "Failed to resolve Togari bot user id — thread context may be degraded",
        {
          error: err instanceof Error ? err.message : String(err),
        },
      );
    }
  }

  // Env var checks (warn, don't crash)
  if (!process.env.SMARTLEAD_API_KEY) {
    logger.warn(
      "SMARTLEAD_API_KEY not set — Smartlead message history fetch will be skipped",
    );
  }

  const app = express();

  // ── MCP Server routes ─────────────────────────────────────────
  // Registered FIRST — before helmet/cors/express.json() so MCP endpoints
  // control their own CORS headers and body parsing.
  setupMcpRoutes(app);

  app.use(helmet());
  app.use(cors());

  // Slack events route — needs raw text body for signature verification
  // Must be registered BEFORE express.json() middleware
  app.post(
    "/slack/events",
    express.text({ type: "*/*" }),
    slackTenantMiddleware,
    slackEventsHandler,
  );

  // Slack OAuth callback — installs Togari into a client's own workspace so
  // its reply cards can land there. A browser GET with query params, no body.
  // See docs/SLACK_EXTERNAL_WORKSPACE.md.
  app.use("/slack", createSlackOAuthRouter());

  // Smartlead webhook — needs raw body for HMAC signature verification
  // Must be registered BEFORE express.json() middleware
  app.post(
    "/smartlead/webhook",
    express.raw({ type: "application/json" }),
    (req: express.Request, res: express.Response) => {
      try {
        const rawBody = Buffer.isBuffer(req.body)
          ? req.body
          : Buffer.from(req.body);
        const rawString = rawBody.toString("utf8");

        // HMAC signature verification
        const secret = process.env.SMARTLEAD_WEBHOOK_SECRET;
        const signature = req.headers["x-smartlead-signature"] as
          | string
          | undefined;

        if (!secret) {
          logger.warn(
            "SMARTLEAD_WEBHOOK_SECRET not set — skipping signature verification (dev mode)",
          );
        } else if (!signature) {
          logger.warn(
            "Missing X-Smartlead-Signature header — rejecting request",
          );
          res.status(401).json({ error: "Missing signature" });
          return;
        } else {
          const hmac = crypto
            .createHmac("sha256", secret)
            .update(rawString)
            .digest("hex");
          try {
            const valid = crypto.timingSafeEqual(
              Buffer.from(hmac, "utf8"),
              Buffer.from(signature, "utf8"),
            );
            if (!valid) {
              logger.warn("Smartlead signature verification failed");
              res.status(401).json({ error: "Invalid signature" });
              return;
            }
          } catch {
            logger.warn(
              "Smartlead signature verification failed (length mismatch)",
            );
            res.status(401).json({ error: "Invalid signature" });
            return;
          }
        }

        // Return 200 immediately before processing
        res.status(200).json({ status: "ok" });

        // Parse and process asynchronously
        let body: unknown;
        try {
          body = JSON.parse(rawString);
        } catch {
          logger.error("Failed to parse Smartlead webhook body as JSON");
          return;
        }

        processSmartleadWebhook(body).catch((err) => {
          logger.error(
            "Async Smartlead webhook processing failed",
            err instanceof Error ? err : new Error(String(err)),
          );
        });
      } catch (err) {
        logger.error(
          "Smartlead webhook handler error",
          err instanceof Error ? err : new Error(String(err)),
        );
        if (!res.headersSent) {
          res.status(500).json({ error: "Internal error" });
        }
      }
    },
  );

  // Per-client replybot webhook — same raw-body HMAC pattern as
  // /smartlead/webhook (which remains BMA's path) but keyed by client:
  // the :clientId selects the secret, Slack channel, voice, and sender
  // from the replybot client registry (src/agents/replybot/client-config.ts).
  app.post(
    "/replybot/:clientId/webhook",
    express.raw({ type: "application/json" }),
    replybotWebhookHandler,
  );

  // Clay webhook ingestion — needs raw body for HMAC signature verification.
  // Must be registered BEFORE express.json() middleware. Router applies
  // express.raw({type: 'application/json'}) internally before the HMAC check.
  app.use("/api/ingest/clay", createClayIngestRouter());

  // Clay passthrough ingestion — bearer-auth, tag-routed direct BigQuery
  // insert. Router applies its own scoped express.json() internally.
  app.use("/webhooks/clay", createClayPassthroughIngestRouter());

  // Clay flagship fan-out — POST /webhooks/clay/lead. DNC screen (block on
  // match) + GCP insert + Rytual audience sync. Bearer-auth + own JSON parse
  // internally, so it mounts before the global express.json() below.
  app.use("/webhooks/clay", createClayLeadRouter());

  // Website ICP list funnel callback — POST /webhooks/clay/icp-callback.
  // Clay's HTTP API column posts the sourced list here; idempotent claim +
  // auto list email. Own Bearer auth + scoped JSON parse, so it mounts
  // before express.json().
  app.use("/webhooks/clay", createIcpCallbackRouter());

  // Perplexity reply loop intake — POST /replies. Clay's HTTP API column posts
  // one inbound cold-email reply per row; the row lands in reply_items at
  // state 'queued' and a repeat POST of the same row_id is a no-op 200. Own
  // Bearer auth + scoped JSON parse, so it mounts before express.json().
  app.use("/replies", createRepliesRouter());

  // Campaign calendar intake — POST /campaign-events. An HTTP API column on
  // each campaign's Clay Events table posts every send, reply and bounce; rows
  // are streamed into campaign_events. Own Bearer auth + scoped JSON parse, so
  // it mounts before express.json().
  app.use("/campaign-events", createCampaignEventsRouter());

  // Warm-intro connection research — POST /connections and its Perplexity
  // callback. Same pattern as /replies: one person per Clay row lands in
  // connection_items, queued. Own Bearer auth + scoped JSON parse, so it mounts
  // before express.json().
  app.use("/connections", createConnectionsRouter());

  // Universal Clay connector — POST /clay/v1/sync. One endpoint added as an
  // HTTP API enrichment column to ANY Clay table: auto-registers the table,
  // runs ingest/dnc/upsert/enrich, returns flat JSON Clay maps back into
  // columns. Own auth + JSON parse internally, mounts before express.json().
  app.use("/clay/v1", createClayConnectorRouter());

  // Patch L — Fireflies webhook. Tenant context comes from
  // FIREFLIES_DEFAULT_TENANT_ID (mirroring how Smartlead resolves tenant
  // before it had its own tenant header). The handler performs its own
  // signature verification (HMAC sha256 over the JSON body).
  app.post(
    "/webhooks/fireflies",
    express.json({ limit: "10mb" }),
    (req: express.Request, res: express.Response) =>
      tenantStorage.run(
        {
          tenantId: process.env.FIREFLIES_DEFAULT_TENANT_ID ?? "bma",
          tier: "enterprise",
        },
        () => firefliesWebhookHandler(req, res),
      ),
  );

  // Slack interactivity — x-www-form-urlencoded, raw body for HMAC verification
  // Must be registered BEFORE express.json() middleware
  app.post(
    "/slack/interactivity",
    express.raw({ type: "application/x-www-form-urlencoded" }),
    slackTenantMiddleware,
    async (req: express.Request, res: express.Response) => {
      try {
        const rawBody = Buffer.isBuffer(req.body)
          ? req.body
          : Buffer.from(req.body);
        const rawString = rawBody.toString("utf8");

        // Verify Slack signature (same pattern as /slack/events)
        const signingSecret = process.env.SLACK_SIGNING_SECRET;
        const timestamp =
          (req.headers["x-slack-request-timestamp"] as string) || "";
        const signature = (req.headers["x-slack-signature"] as string) || "";

        if (signingSecret) {
          // Replay protection: reject requests older than 5 minutes
          const requestTime = parseInt(timestamp, 10);
          const now = Math.floor(Date.now() / 1000);
          if (Math.abs(now - requestTime) > 300) {
            logger.warn("Slack interactivity request timestamp too old", {
              requestTime,
              now,
            });
            res.status(401).json({ error: "Request too old" });
            return;
          }

          const baseString = `v0:${timestamp}:${rawString}`;
          const hmac = crypto
            .createHmac("sha256", signingSecret)
            .update(baseString)
            .digest("hex");
          const expectedSignature = `v0=${hmac}`;

          try {
            const valid = crypto.timingSafeEqual(
              Buffer.from(expectedSignature, "utf8"),
              Buffer.from(signature, "utf8"),
            );
            if (!valid) {
              logger.warn("Slack interactivity signature verification failed");
              res.status(401).json({ error: "Invalid signature" });
              return;
            }
          } catch {
            logger.warn(
              "Slack interactivity signature verification failed (length mismatch)",
            );
            res.status(401).json({ error: "Invalid signature" });
            return;
          }
        } else {
          logger.warn(
            "SLACK_SIGNING_SECRET not set — skipping signature verification (dev mode)",
          );
        }

        // Parse URL-encoded body to extract the payload field
        const params = new URLSearchParams(rawString);
        const payloadStr = params.get("payload");
        if (!payloadStr) {
          logger.warn("Slack interactivity request missing payload field");
          res.status(400).json({ error: "Missing payload" });
          return;
        }

        let parsedPayload: any;
        try {
          parsedPayload = JSON.parse(payloadStr);
        } catch {
          logger.warn("Slack interactivity payload is not valid JSON");
          res.status(400).json({ error: "Invalid payload JSON" });
          return;
        }

        // ── Route by interaction type ──────────────────────────────────
        const payloadType = parsedPayload?.type || "";

        if (
          payloadType === "view_submission" &&
          parsedPayload?.view?.callback_id === DECK_MODAL_CALLBACK
        ) {
          try {
            res.status(200).json(await handleDeckModalSubmit(parsedPayload));
          } catch (err) {
            logger.error(
              "Deck modal submit threw",
              err instanceof Error ? err : new Error(String(err)),
            );
            res.status(200).json({
              response_action: "errors",
              errors: { body_block: "Internal server error, try again." },
            });
          }
        } else if (
          payloadType === "view_submission" &&
          parsedPayload?.view?.callback_id === CONNECTION_EDIT_CALLBACK_ID
        ) {
          // Warm-intro draft edit. Answered synchronously: the response
          // closes the modal, or puts an error under the text box.
          try {
            res
              .status(200)
              .json(await handleConnectionDraftSubmit(parsedPayload));
          } catch (err) {
            logger.error(
              "Connection draft edit failed",
              err instanceof Error ? err : new Error(String(err)),
            );
            res.status(200).json({
              response_action: "errors",
              errors: { draft_block: "Couldn't save. Try again." },
            });
          }
        } else if (
          payloadType === "view_submission" &&
          parsedPayload?.view?.callback_id === "smartlead_send_edited"
        ) {
          // Modal submit — must return response body synchronously (clear or errors)
          try {
            const result = await handleSmartleadModalSubmit(parsedPayload);
            res.status(200).json(result);
          } catch (err) {
            logger.error(
              "Modal submit handler threw",
              err instanceof Error ? err : new Error(String(err)),
            );
            res.status(200).json({
              response_action: "errors",
              errors: { body_block: "Internal server error — try again." },
            });
          }
        } else if (payloadType === "block_actions") {
          const actionId = parsedPayload?.actions?.[0]?.action_id || "";

          // Replybot card buttons work in any workspace their client installed
          // Togari in. Everything else here is BMA-internal (proposal email,
          // confirm cards, reminders) and only answers the home workspace.
          const homeOnly =
            actionId === "send_proposal_email" ||
            isTogariConfirmActionId(actionId) ||
            isTogariReminderActionId(actionId);

          if (homeOnly && !(await isHomeWorkspaceInteraction(parsedPayload))) {
            logger.warn(
              "Ignoring a BMA-only Slack action from another workspace",
              {
                actionId,
                teamId: parsedPayload?.team?.id,
                userTeamId: parsedPayload?.user?.team_id,
              },
            );
            res.status(200).send();
          } else if (
            actionId === ASSISTANT_CONFIRM ||
            actionId === ASSISTANT_CANCEL
          ) {
            // Do it / Cancel under a client assistant proposal. The handler
            // checks the tapper is the client's approver or the team.
            res.status(200).send();
            handleAssistantAction(parsedPayload).catch((err) =>
              logger.error(
                "Assistant action failed",
                err instanceof Error ? err : new Error(String(err)),
              ),
            );
          } else if (
            actionId === "smartlead_edit_modal" ||
            actionId === "send_proposal_email"
          ) {
            // Modal actions — views.open needs trigger_id, must run before we respond
            try {
              await handleSmartleadSlackAction(parsedPayload);
            } catch (err) {
              logger.error(
                "Modal handler failed",
                err instanceof Error ? err : new Error(String(err)),
              );
            }
            res.status(200).send();
          } else if (actionId === "connpath_edit") {
            // Warm-intro draft Edit opens a modal, so it has to use the
            // click's trigger_id before Slack is answered.
            try {
              await handleConnectionEditAction(parsedPayload);
            } catch (err) {
              logger.error(
                "Connection draft modal failed",
                err instanceof Error ? err : new Error(String(err)),
              );
            }
            res.status(200).send();
          } else if (isConnectionPathAction(actionId)) {
            // Warm-intro digest buttons. Drafting takes a few seconds, so
            // answer Slack first and work after.
            res.status(200).send();
            handleConnectionPathAction(parsedPayload).catch((err) => {
              logger.error(
                "Connection path action failed",
                err instanceof Error ? err : new Error(String(err)),
              );
            });
          } else if (isReplybotCardAction(actionId)) {
            // Other smartlead actions — return 200 immediately, process async
            res.status(200).send();
            handleSmartleadSlackAction(parsedPayload).catch((err) => {
              logger.error(
                "Async Slack interactivity processing failed",
                err instanceof Error ? err : new Error(String(err)),
              );
            });
          } else if (isTogariConfirmActionId(actionId)) {
            // Togari confirm/cancel buttons (send_email, transfer_deal,
            // new_deal-on-dedupe). Ack immediately and process async.
            res.status(200).send();
            handleTogariConfirmAction(parsedPayload).catch((err) => {
              logger.error(
                "Togari confirm action handler failed",
                err instanceof Error ? err : new Error(String(err)),
              );
            });
          } else if (isTogariReminderActionId(actionId)) {
            // Togari cancel-reminder button. Ack immediately and
            // process async — deleteScheduledMessage + BQ row update.
            res.status(200).send();
            handleCancelReminder(parsedPayload).catch((err) => {
              logger.error(
                "Togari cancel-reminder handler failed",
                err instanceof Error ? err : new Error(String(err)),
              );
            });
          } else {
            res.status(200).send();
          }
        } else {
          // Unknown interaction type — ack it
          res.status(200).send();
        }
      } catch (err) {
        logger.error(
          "Slack interactivity handler error",
          err instanceof Error ? err : new Error(String(err)),
        );
        if (!res.headersSent) {
          res.status(500).json({ error: "Internal error" });
        }
      }
    },
  );

  app.use(express.json());

  // ── REST API routes ────────────────────────────────────────────
  // Registered AFTER express.json() — API routes use normal JSON parsing.
  app.use(apiRouter);

  // ── Universal ingestion ────────────────────────────────────────
  // POST /api/v1/ingest — accept any data (text/csv/json/xlsx/file),
  // preserve raw, AI-extract entities, route into the CRM tables.
  app.use("/api/v1", createUniversalIngestRouter());

  // AI enrichment (record + prompt -> structured fields) + Gmail/Fireflies
  // auto-ingest routed through the universal ingestion pipeline.
  app.use("/api/v1", createEnrichRouter());
  app.use("/api/v1/ingest", createAutoIngestRouter());

  // Read-only source retrieval (Gmail/Fireflies/Calendar) - never writes.
  app.use("/api/v1", createFetchRouter());
  app.use("/api/v1", createCalendarRouter());

  // Client dashboard: outbound numbers and who is waiting on us, by token.
  app.get("/dash/:token", handleDashboard);
  // The follow-up queue the daily outcome check DMs, as JSON, same token.
  app.get("/dash/:token/stuck.json", handleStuck);
  // The same token's campaign calendar: a month of campaigns, weekly numbers.
  app.get("/dash/:token/calendar", handleCampaignCalendar);
  // Conferences added from the calendar page itself, same token.
  app.post(
    "/dash/:token/calendar/plans",
    express.json({ limit: "10kb" }),
    handleAddPlan,
  );
  app.post(
    "/dash/:token/calendar/plans/:id/remove",
    express.json({ limit: "1kb" }),
    handleRemovePlan,
  );

  // ── BMA website lead capture ───────────────────────────────────
  // ICP list wizard + contact form, proxied from the
  // bma-website Express server with WEBSITE_INGEST_API_KEY. Router applies
  // its own scoped JSON parse + auth + rate limit.
  app.use("/api/v1/website", createWebsiteRouter());

  // ── Client portal ───────────────────────────────────────────────
  // One-prompt client provisioning, the client-facing backend for the BMA
  // website login. (The DNC submission portal and opportunity emails were
  // removed on 2026-10-16; neither table ever held a row.)
  // Per-client portal auth: a tgc_ client key scopes to that client; the
  // internal TOGARI_API_KEY is an admin bypass. Runs before the portal routers.
  app.use("/api/v1/portal", portalAuth());
  app.use("/api/v1/portal", createProvisionPortalRouter());
  // Read-only feed for Chewbacca Live (the page a client asks questions on).
  app.use("/api/v1/portal", createLiveReadPortalRouter());

  // OAuth discovery (public)
  app.get(
    "/.well-known/oauth-protected-resource",
    oauthProtectedResourceHandler,
  );
  app.get("/.well-known/oauth-authorization-server", oauthDiscoveryHandler);

  // Deck links handed to investors: /d/<token> streams the deck Jonah uploaded
  // in the send-the-deck modal straight from Slack, so the link works for
  // someone with no Slack account. Unknown tokens are a plain 404.
  app.get("/d/:token", async (req, res) => {
    try {
      const stored = await storedDeckByToken(String(req.params.token || ""));
      if (stored) {
        const name = String(stored.fileName || "deck").replace(
          /[^\w.\- ]/g,
          "_",
        );
        res.setHeader(
          "Content-Type",
          stored.mime === "application/pdf"
            ? "application/pdf"
            : "application/octet-stream",
        );
        res.setHeader(
          "Content-Disposition",
          `${stored.mime === "application/pdf" ? "inline" : "attachment"}; filename="${name}"`,
        );
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
        res.setHeader("Cache-Control", "private, max-age=300");
        res.send(stored.content);
        return;
      }
      const deck = await deckFileByToken(String(req.params.token || ""));
      if (!deck) {
        res.status(404).send("Not found");
        return;
      }
      const token = await slackBotTokenFor(
        getReplybotClient(deck.clientId)?.slackTeamId,
      );
      const info = (await (
        await fetch(
          `https://slack.com/api/files.info?file=${encodeURIComponent(deck.slackFileId)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        )
      ).json()) as any;
      const src = info?.file?.url_private_download || info?.file?.url_private;
      if (!info?.ok || !src) {
        logger.error("Deck link: Slack file unavailable", undefined, {
          error: info?.error,
        });
        res.status(404).send("Not found");
        return;
      }
      const file = await fetch(src, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!file.ok || !file.body) {
        res.status(502).send("Deck temporarily unavailable");
        return;
      }
      const name = String(deck.fileName || "deck").replace(/[^\w.\- ]/g, "_");
      // Only deck formats render inline. Anything else (HTML, SVG) would run as
      // a page on Togari's own origin, so it downloads as raw bytes instead.
      const DECK_TYPES = new Set([
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.ms-powerpoint",
        "application/x-iwork-keynote-sffkey",
      ]);
      const mime = String(info.file.mimetype || "");
      const inline = DECK_TYPES.has(mime);
      res.setHeader("Content-Type", inline ? mime : "application/octet-stream");
      res.setHeader(
        "Content-Disposition",
        `${inline ? "inline" : "attachment"}; filename="${name}"`,
      );
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
      res.setHeader("Cache-Control", "private, max-age=300");
      res.send(Buffer.from(await file.arrayBuffer()));
    } catch (err) {
      logger.error(
        "Deck link failed",
        err instanceof Error ? err : new Error(String(err)),
      );
      res.status(500).send("Error");
    }
  });

  // Health check
  app.get("/health", (_req, res) => {
    const statuses = connectorRegistry.getAllStatuses();
    const allHealthy =
      statuses.length === 0 || statuses.every((s) => s.healthy);
    res.status(allHealthy ? 200 : 503).json({
      status: allHealthy ? "healthy" : "degraded",
      connectors: statuses,
      timestamp: new Date().toISOString(),
    });
  });

  // Admin endpoints (would be auth-protected in production)
  app.get("/admin/status", (_req, res) => {
    res.json({
      service: "@togari/admin",
      version: "1.0.0",
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      connectors: connectorRegistry.getAllStatuses(),
      replyLoop: replyLoopStatus(),
      connectionLoop: connectionLoopStatus(),
      connectionDigest: {
        enabled: process.env.CONNECTION_DIGEST_ENABLED === "true",
        hour: Number(process.env.CONNECTION_DIGEST_HOUR || "9"),
      },
    });
  });

  // Deal writer endpoint
  const dealsTableFqn = () =>
    `midyear-glazing-485303-u3.${resolveDataset()}.togari_structured_deals`;
  const VALID_STAGES = [
    "lead",
    "qualified",
    "proposal_sent",
    "negotiation",
    "in_progress",
    "closed_won",
    "closed_lost",
    "closed_engagement",
  ];
  const VALID_CYCLES = ["monthly", "quarterly", "annually", "one-time"];
  const ALLOWED_FIELDS = [
    "deal_id",
    "client_id",
    "deal_name",
    "company",
    "contact_ids",
    "value",
    "stage",
    "pipeline",
    // H — multi-brand axis. Writeable on both insert and update; the
    // brand+pipeline combo is validated below before SQL is built.
    "client_brand",
    "owner",
    "close_date",
    "notes",
    "next_action",
    "next_action_date",
    "created_at",
    "updated_at",
    "contact_full_name",
    "contact_first_name",
    "contact_last_name",
    "contact_email",
    "contact_linkedin",
    "deal_source",
    "deal_duration",
    "deal_amount_cycle",
  ];
  // Patch E.1: removed `owner` so HTTP callers can transfer ownership.
  // Owner column standardizes on Slack user IDs — see deal-ops.isSlackUserId.
  const IMMUTABLE_ON_UPDATE = ["deal_id", "client_id", "created_at"];
  const bqClient = new BigQueryClient(
    "midyear-glazing-485303-u3",
    null,
    process.env.GCP_CREDENTIALS_BASE64 ||
      process.env.GOOGLE_CREDENTIALS_BASE64 ||
      null,
  );
  app.post("/deals/write", async (req, res) => {
    try {
      // Auth: this endpoint writes directly to BigQuery, so it must not be
      // open. Require X-Togari-Key === TOGARI_API_KEY when that key is set.
      // (In dev, when TOGARI_API_KEY is unset, auth is skipped.)
      const expectedKey = process.env.TOGARI_API_KEY;
      if (expectedKey) {
        const providedKey = req.headers["x-togari-key"] as string | undefined;
        if (!providedKey || providedKey !== expectedKey) {
          return res.status(401).json({
            error: "Invalid or missing API key. Set X-Togari-Key header.",
          });
        }
      }
      const { operation, fields, where } = req.body;
      // Validate operation
      if (!operation || !["insert", "update"].includes(operation)) {
        return res
          .status(400)
          .json({ error: "operation must be 'insert' or 'update'" });
      }

      // Validate fields
      if (
        !fields ||
        typeof fields !== "object" ||
        Object.keys(fields).length === 0
      ) {
        return res
          .status(400)
          .json({ error: "fields object is required and cannot be empty" });
      }

      // Validate field names
      for (const key of Object.keys(fields)) {
        if (!ALLOWED_FIELDS.includes(key)) {
          return res.status(400).json({ error: `Invalid field: ${key}` });
        }
      }

      // Validate stage
      if (fields.stage && !VALID_STAGES.includes(fields.stage as string)) {
        return res.status(400).json({
          error: `Invalid stage: ${fields.stage}. Must be one of: ${VALID_STAGES.join(", ")}`,
        });
      }

      // Validate cycle
      if (
        fields.deal_amount_cycle &&
        !VALID_CYCLES.includes(fields.deal_amount_cycle as string)
      ) {
        return res.status(400).json({
          error: `Invalid deal_amount_cycle: ${fields.deal_amount_cycle}. Must be one of: ${VALID_CYCLES.join(", ")}`,
        });
      }

      // Require deal_id
      if (!fields.deal_id) {
        return res.status(400).json({ error: "deal_id is required" });
      }

      // Owner column standardizes on Slack user IDs. Reject free-text names
      // so we don't repopulate the inconsistent values the backfill script
      // is cleaning up. Callers must resolve through mention-resolver first.
      if (fields.owner && !/^U[A-Z0-9]+$/.test(fields.owner as string)) {
        return res.status(400).json({
          error: `Invalid owner "${fields.owner}" — owner must be a Slack user ID (U...). Resolve the name through mention-resolver first.`,
        });
      }

      // H — multi-brand axis. Reject unknown brand strings and any
      // brand+pipeline combo not in BRAND_PIPELINES. Today every brand
      // allows every pipeline, but the validator gives us a one-line
      // place to add per-brand restrictions later.
      if (fields.client_brand !== undefined && fields.client_brand !== null) {
        if (!isValidBrand(fields.client_brand as string)) {
          return res.status(400).json({
            error: `Invalid client_brand "${fields.client_brand}". Must be one of: ${ALL_BRANDS.join(", ")}.`,
          });
        }
        if (
          fields.pipeline &&
          !isValidBrandPipelineCombo(
            fields.client_brand as string,
            fields.pipeline as string,
          )
        ) {
          return res.status(400).json({
            error: `Brand "${fields.client_brand}" does not have pipeline "${fields.pipeline}". Valid pipelines for ${fields.client_brand}: ${BRAND_PIPELINES[fields.client_brand as keyof typeof BRAND_PIPELINES].join(", ")}.`,
          });
        }
      }

      if (operation === "insert") {
        const columns: string[] = [];
        const values: string[] = [];
        const params: Record<string, unknown> = {};

        for (const [key, val] of Object.entries(fields)) {
          if (val === null || val === undefined) continue;

          if (key === "contact_ids" && Array.isArray(val)) {
            columns.push(key);
            values.push(`@${key}`);
            params[key] = val;
          } else if (key === "value") {
            columns.push(key);
            values.push(`@${key}`);
            params[key] = parseFloat(val as string);
          } else if (key === "created_at" || key === "updated_at") {
            columns.push(key);
            values.push("CURRENT_TIMESTAMP()");
          } else {
            columns.push(key);
            values.push(`@${key}`);
            params[key] = val;
          }
        }

        if (!columns.includes("created_at")) {
          columns.push("created_at");
          values.push("CURRENT_TIMESTAMP()");
        }
        if (!columns.includes("updated_at")) {
          columns.push("updated_at");
          values.push("CURRENT_TIMESTAMP()");
        }

        const sql = `INSERT INTO \`${dealsTableFqn()}\` (${columns.join(", ")}) VALUES (${values.join(", ")})`;
        const result = await bqClient.executeWrite(sql, params);

        return res.status(200).json({
          success: true,
          operation: "insert",
          deal_id: fields.deal_id,
          message: `Successfully inserted deal ${fields.deal_id}`,
        });
      } else if (operation === "update") {
        if (
          !where ||
          typeof where !== "object" ||
          Object.keys(where).length === 0
        ) {
          return res
            .status(400)
            .json({ error: "where clause is required for updates" });
        }

        const setClauses: string[] = [];
        const params: Record<string, unknown> = {};

        for (const [key, val] of Object.entries(fields)) {
          if (IMMUTABLE_ON_UPDATE.includes(key)) continue;
          if (val === null || val === undefined) continue;

          if (key === "contact_ids" && Array.isArray(val)) {
            setClauses.push(`${key} = @${key}`);
            params[key] = val;
          } else if (key === "value") {
            setClauses.push(`${key} = @${key}`);
            params[key] = parseFloat(val as string);
          } else if (key === "updated_at") {
            setClauses.push("updated_at = CURRENT_TIMESTAMP()");
          } else {
            setClauses.push(`${key} = @${key}`);
            params[key] = val;
          }
        }

        if (!setClauses.some((c) => c.startsWith("updated_at"))) {
          setClauses.push("updated_at = CURRENT_TIMESTAMP()");
        }

        const whereClauses: string[] = [];
        for (const [key, val] of Object.entries(where)) {
          const paramName = `where_${key}`;
          whereClauses.push(`${key} = @${paramName}`);
          params[paramName] = val;
        }

        const sql = `UPDATE \`${dealsTableFqn()}\` SET ${setClauses.join(", ")} WHERE ${whereClauses.join(" AND ")}`;
        const result = await bqClient.executeWrite(sql, params);

        return res.status(200).json({
          success: true,
          operation: "update",
          deal_id: fields.deal_id,
          message: `Successfully updated deal ${fields.deal_id}`,
          rows_affected: result.numDmlAffectedRows,
        });
      }
    } catch (error: any) {
      logger.error("Deal write failed", error);
      return res.status(500).json({
        error: "BigQuery operation failed",
        details: error.message,
      });
    }
  });

  // ── Email engine routes ──────────────────────────────────────────

  app.post("/email/process", async (req, res) => {
    try {
      const hoursBack = req.body?.hoursBack ?? 1;
      const team = getTeam();
      const channel = getDefaultSlackChannel();
      logger.info("Manual trigger: processing all inboxes", { hoursBack });
      const stats = await processInboxes(
        team,
        channel,
        hoursBack,
        lastCheckTimes,
      );
      res.json({ status: "ok", stats });
    } catch (err) {
      logger.error("Email processing failed", err);
      res.status(500).json({
        status: "error",
        message: err instanceof Error ? err.message : "unknown",
      });
    }
  });

  app.post("/email/process/:email", async (req, res) => {
    try {
      const hoursBack = req.body?.hoursBack ?? 1;
      const targetEmail = req.params.email;
      const team = getTeam();
      const member = team.find((m) => m.email === targetEmail);
      if (!member) {
        res.status(404).json({
          status: "error",
          message: `Unknown team member: ${targetEmail}`,
        });
        return;
      }
      const channel = getDefaultSlackChannel();
      logger.info("Manual trigger: processing single inbox", {
        email: targetEmail,
        hoursBack,
      });
      const stats = await processInboxes(
        [member],
        channel,
        hoursBack,
        lastCheckTimes,
      );
      res.json({ status: "ok", stats });
    } catch (err) {
      logger.error("Email processing failed", err);
      res.status(500).json({
        status: "error",
        message: err instanceof Error ? err.message : "unknown",
      });
    }
  });

  // ── Auto-polling ────────────────────────────────────────────────

  const pollMinutes = parseInt(process.env.POLL_INTERVAL_MINUTES || "15", 10);
  const autoPoll = process.env.AUTO_POLL === "true";

  if (autoPoll) {
    logger.info(`Auto-poll enabled: every ${pollMinutes} minutes`);
    pollInterval = setInterval(
      async () => {
        try {
          const team = getTeam();
          const channel = getDefaultSlackChannel();
          await processInboxes(
            team,
            channel,
            pollMinutes / 60 + 0.1,
            lastCheckTimes,
          );
        } catch (err) {
          logger.error("Auto-poll processing failed", err);
        }
      },
      pollMinutes * 60 * 1000,
    );
  } else {
    logger.info("Auto-poll disabled (set AUTO_POLL=true to enable)");
  }

  // ── ICP list stall/timeout sweeper ──────────────────────────────
  // Clay usually calls back within 5-15 minutes. Past ICP_STALL_ALERT_MINUTES
  // (default 20) a job is marked stalled and Slack gets a heads-up, but it
  // stays open so a late callback still sends the list. Past
  // ICP_JOB_GIVEUP_MINUTES (default 120) it's timed_out and Slack is told to
  // reach out personally. Nothing automated goes to the requester.
  if (process.env.ICP_PIPELINE_ENABLED === "true") {
    const sweepMinutes = parseInt(
      process.env.ICP_SWEEP_INTERVAL_MINUTES || "2",
      10,
    );
    const alertMinutes = parseInt(process.env.ICP_STALL_ALERT_MINUTES || "20", 10);
    // Never give up before the stall alert has had its chance.
    const timeoutMinutes = Math.max(
      parseInt(process.env.ICP_JOB_GIVEUP_MINUTES || "120", 10),
      alertMinutes + 10,
    );
    logger.info(
      `ICP sweeper enabled: every ${sweepMinutes}m, stall alert ${alertMinutes}m, give up ${timeoutMinutes}m`,
    );
    icpSweepInterval = setInterval(
      async () => {
        try {
          const stalled = await sweepStalledJobs(alertMinutes);
          for (const job of stalled) {
            notifyInternal(
              formatIcpOutcomeAlert(job, {
                kind: "stalled",
                minutes: alertMinutes,
                giveUpMinutes: timeoutMinutes,
              }),
            );
          }
          const timedOut = await sweepTimedOutJobs(timeoutMinutes);
          for (const job of timedOut) {
            notifyInternal(
              formatIcpOutcomeAlert(job, {
                kind: "needs_hand_build",
                reason: `Clay did not finish within ${timeoutMinutes} minutes`,
              }),
            );
          }
        } catch (err) {
          logger.error("ICP sweep failed", err);
        }
      },
      sweepMinutes * 60 * 1000,
    );
  } else {
    logger.info(
      "ICP pipeline disabled (set ICP_PIPELINE_ENABLED=true to enable)",
    );
  }

  // ── Perplexity reply loop (plan steps 06 + 08) ──────────────────
  // Sends queued replies to Perplexity, chases ones that never came back,
  // gives up on work too old to be worth anything, and alerts on rows stuck
  // mid-dispatch — which it never retries, because that could pay for the same
  // task twice. Without the dispatch half nothing leaves the queue on its own.
  // Off by default so a second replica cannot double-chase the same rows.
  if (process.env.REPLY_SWEEP_ENABLED === "true") {
    const everyMinutes = parseInt(
      process.env.REPLY_SWEEP_INTERVAL_MINUTES || "5",
      10,
    );
    const cfg = sweepConfig();
    logger.info(
      `Reply loop enabled: every ${everyMinutes}m — dispatches queued replies ` +
        `and chases after ${cfg.staleMinutes}m, ${cfg.maxAttempts} attempts, ` +
        `giving up at ${cfg.giveUpAfterMinutes}m`,
    );
    const runSweep = () => {
      // Out-of-office follow-ups the autopilot scheduled. Independent of the
      // Perplexity sweep, so one failing never holds up the other.
      sweepFollowups(sendReplyEmail)
        .then((n) => {
          if (n) logger.info(`Autopilot sent ${n} follow-up(s)`);
        })
        .catch((err) =>
          logger.error(
            "Follow-up sweep failed",
            err instanceof Error ? err : new Error(String(err)),
          ),
        );
      return (
        sweepRepliesGuarded()
          // null means this tick was skipped because the last pass is still
          // running — not a run, so it must not be recorded as one.
          .then((summary) => {
            if (summary) recordSweepRun(summary);
          })
          .catch((err) => {
            recordSweepRun(null, err);
            logger.error(
              "Reply sweep failed",
              err instanceof Error ? err : new Error(String(err)),
            );
          })
      );
    };

    // setInterval fires only AFTER the first interval, so a deploy left a
    // dead window as long as the interval — and a redeploy restarted it. Run
    // once shortly after boot so a queued reply is never waiting on a timer
    // that has not come round yet.
    setTimeout(runSweep, 30_000);
    setInterval(runSweep, everyMinutes * 60 * 1000);
  } else {
    logger.info(
      "Reply sweeper disabled (set REPLY_SWEEP_ENABLED=true to enable)",
    );
  }

  // ── Connection research loop ────────────────────────────────────
  // The same dispatch-and-chase pass over connection_items, on its own timer
  // and its own overlap guard: a research task can run its full 15 minutes,
  // and sharing the reply loop's guard would hold every reply behind it. Off
  // by default, for the same reason as the reply loop — one replica only.
  if (process.env.CONNECTION_SWEEP_ENABLED === "true") {
    const everyMinutes = parseInt(
      process.env.CONNECTION_SWEEP_INTERVAL_MINUTES || "10",
      10,
    );
    logger.info(`Connection research loop enabled: every ${everyMinutes}m`);
    const runConnectionSweep = () =>
      sweepConnectionsGuarded()
        .then((summary) => {
          if (summary) recordConnectionSweepRun(summary);
        })
        .catch((err) => {
          recordConnectionSweepRun(null, err);
          logger.error(
            "Connection sweep failed",
            err instanceof Error ? err : new Error(String(err)),
          );
        });
    setTimeout(runConnectionSweep, 60_000);
    setInterval(runConnectionSweep, everyMinutes * 60 * 1000);
  } else {
    logger.info(
      "Connection research loop disabled (set CONNECTION_SWEEP_ENABLED=true to enable)",
    );
  }

  // ── Warm-intro digest ───────────────────────────────────────────
  // Posts each client's new paths to Slack once a weekday morning in the
  // client's timezone. Checks every 10 minutes; BigQuery remembers whether
  // today's digest has gone out, so a restart cannot post it twice. Off by
  // default, one replica only, like the loops above.
  if (process.env.CONNECTION_DIGEST_ENABLED === "true") {
    logger.info("Warm-intro digest enabled: weekdays, checked every 10m");
    const runDigest = () =>
      runConnectionDigests()
        .then((n) => {
          if (n) logger.info(`Warm-intro digest posted ${n} path(s)`);
        })
        .catch((err) =>
          logger.error(
            "Warm-intro digest failed",
            err instanceof Error ? err : new Error(String(err)),
          ),
        );
    setTimeout(runDigest, 90_000);
    setInterval(runDigest, 10 * 60 * 1000);
  } else {
    logger.info(
      "Warm-intro digest disabled (set CONNECTION_DIGEST_ENABLED=true to enable)",
    );
  }

  // ── Worker subscribers (Tab 3) ──────────────────────────────────
  // Off by default; turn on per replica with TOGARI_WORKER_ENABLED=true.
  if (process.env.TOGARI_WORKER_ENABLED === "true") {
    try {
      await startWorkerSubscribers();
    } catch (err) {
      logger.error("failed to start worker subscribers", err);
    }
  } else {
    logger.info(
      "Worker subscribers disabled (set TOGARI_WORKER_ENABLED=true to enable)",
    );
  }

  const port = parseInt(process.env.PORT || "4000", 10);
  app.listen(port, () => {
    logger.info(`togari-admin service listening on port ${port}`);
  });

  // A cold /d/ deck took 25 to 33s to open after the 2026-10-13 deploy
  // (BigQuery read), then 0.5s from memory. Load them at boot so no investor
  // waits on the cold one.
  startDashboardRefresh();
  // The campaign calendar's current month, HeyReach included, kept built.
  startCalendarRefresh();
  // Every reply straight from the client's Clay inbox; the feeder alone
  // delivered 36 of 91 repliers in the week of 2026-10-06.
  startInboxPoller();
  // A daily DM of every investor still waiting on us after a day; "done" in
  // Togari hid four of them for a week (2026-10-13).
  startOutcomeCheck();
  // The same queue kept computed for /dash/<token>/stuck.json; inline it ran
  // 228s and the edge returned 502 (2026-10-17).
  startStuckRefresh();
  startBounceGuard();
  // #test-channel hears before the Clay cookie all of the above share lapses.
  startClaySessionAlert();
  // Sends, bounces and replies from the client's Clay Sequencer into the
  // campaign calendar, for clients whose Clay has no Events table to post them.
  startClayCalendarSync();

  warmStoredDecks()
    .then((n) => logger.info("decks.warmed", { count: n }))
    .catch((err) => logger.warn("decks.warm_failed", { error: String(err) }));

  // One-time, 2026-10-07: see one-off-cleanup.ts. Remove after it has run.
  import("./agents/smartlead-responder/one-off-cleanup")
    .then((m) => m.deleteOldLayoutZeutaraCards())
    .catch((err) =>
      logger.error(
        "One-off Zeutara card cleanup failed",
        err instanceof Error ? err : new Error(String(err)),
      ),
    );

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("Shutting down...");
    if (pollInterval) clearInterval(pollInterval);
    if (icpSweepInterval) clearInterval(icpSweepInterval);
    await stopWorkerSubscribers();
    await flushSentry();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
