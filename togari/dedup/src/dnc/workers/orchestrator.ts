/**
 * DNC Social Sync Orchestrator — Real-time workaround architecture
 *
 * Platform   | Method                          | Latency
 * -----------+---------------------------------+----------
 * LinkedIn   | 60s cursor-diff poll            | < 60s
 * Instagram  | 60s trip-wire + immediate fetch | < 60s
 * Twitter/X  | AAA webhook (real) + 5min poll  | < 5s via webhook
 * Meta/IG    | Webhook triggers immediate poll  | < 10s via webhook signal
 *
 * On any new connection insert:
 *   → BigQuery streaming insert (~1s latency)
 *   → Pub/Sub `social_connection_added` event fires immediately
 *   → Downstream: Clay enrichment, CRM update, Slack alert, etc.
 *
 * Startup sequence:
 *   1. Full sync all platforms → warm in-memory cache
 *   2. Register Twitter AAA webhook (if configured)
 *   3. Start fast poll loops (LinkedIn 60s, Instagram 60s, Twitter 5min)
 *   4. Webhook routes active (Twitter AAA, Meta/IG, LinkedIn org)
 */

import type { Application } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DncBigQueryWriter } from "./bq-writer.js";
import { runSyncForAllUsers } from "./user-sync.js";
import {
  handleMetaWebhookVerification,
  handleMetaWebhookEvent,
  pollInstagram,
  fullSyncInstagram,
} from "./instagram-sync.js";
import {
  handleTwitterCRC,
  handleTwitterWebhookEvent,
  pollTwitter,
  fullSyncTwitter,
  setupTwitterWebhook,
} from "./twitter-sync.js";
import type { SyncResult, CacheMap } from "../types/index.js";

// Poll intervals
const LINKEDIN_POLL_MS = 60_000; // 60 seconds
const INSTAGRAM_POLL_MS = 60_000; // 60 seconds
const TWITTER_POLL_MS = 5 * 60_000; // 5 min fallback (webhook is primary)

// Shared state
const bq: DncBigQueryWriter = new DncBigQueryWriter();
const cache: CacheMap = new Map();
let initialized = false;

/**
 * Tenant id used by the env-var startup path. Per-user syncs (user-sync.ts)
 * pass tokens.userId. The legacy single-tenant startup here represents the
 * "no Auth0 user yet" path — Karthik's own LinkedIn + IG + Twitter creds out
 * of the env. Tag those rows so they can be migrated later or filtered out.
 */
const ENV_OWNER_ID = "env-default";

// ─── Startup: full sync + cache warm ─────────────────────────────────────────

async function initialize(): Promise<void> {
  if (initialized) return;
  initialized = true;

  console.log("[DNC Orchestrator] 🚀 Starting up — full sync on all platforms");

  const startups: Promise<void>[] = [];

  if (process.env.LINKEDIN_LI_AT && process.env.LINKEDIN_JSESSIONID) {
    startups.push(
      fullSyncLinkedIn(ENV_OWNER_ID, bq)
        .then(({ cache: c }) => {
          cache.set("linkedin", c);
          console.log("[DNC] LinkedIn ready");
        })
        .catch((err) =>
          console.error("[DNC] LinkedIn startup failed:", err.message),
        ),
    );
  }

  if (process.env.INSTAGRAM_ACCESS_TOKEN && process.env.INSTAGRAM_ACCOUNT_ID) {
    startups.push(
      fullSyncInstagram(ENV_OWNER_ID, bq)
        .then(({ cache: c }) => {
          cache.set("instagram", c);
          console.log("[DNC] Instagram ready");
        })
        .catch((err) =>
          console.error("[DNC] Instagram startup failed:", err.message),
        ),
    );
  }

  if (process.env.TWITTER_BEARER_TOKEN) {
    startups.push(
      fullSyncTwitter(ENV_OWNER_ID, bq)
        .then(({ cache: c }) => {
          cache.set("twitter", c);
          console.log("[DNC] Twitter ready");
        })
        .catch((err) =>
          console.error("[DNC] Twitter startup failed:", err.message),
        ),
    );
  }

  await Promise.allSettled(startups);
  console.log(
    "[DNC Orchestrator] ✅ Startup complete — fast poll loops starting",
  );
}

// ─── Poll loops ───────────────────────────────────────────────────────────────

function startPollLoops(): void {
  // LinkedIn — 60s
  if (process.env.LINKEDIN_LI_AT) {
    setInterval(async () => {
      const c = cache.get("linkedin");
      if (!c) return;
      await runSyncForAllUsers("linkedin", bq).catch((err) =>
        console.error("[LinkedIn] Poll error:", err.message),
      );
    }, LINKEDIN_POLL_MS);
    console.log("[DNC] LinkedIn poll loop started — every 60s");
  }

  // Instagram — 60s trip-wire
  if (process.env.INSTAGRAM_ACCESS_TOKEN) {
    setInterval(async () => {
      const c = cache.get("instagram");
      if (!c) return;
      await runSyncForAllUsers("instagram", bq).catch((err) =>
        console.error("[Instagram] Poll error:", err.message),
      );
    }, INSTAGRAM_POLL_MS);
    console.log("[DNC] Instagram trip-wire poll started — every 60s");
  }

  // Twitter — 5min fallback (AAA webhook is the primary path)
  if (process.env.TWITTER_BEARER_TOKEN) {
    setInterval(async () => {
      const c = cache.get("twitter");
      if (!c) return;
      await runSyncForAllUsers("twitter", bq).catch((err) =>
        console.error("[Twitter] Poll error:", err.message),
      );
    }, TWITTER_POLL_MS);
    console.log(
      "[DNC] Twitter fallback poll started — every 5min (webhook is primary)",
    );
  }
}

// ─── Webhook routes ───────────────────────────────────────────────────────────

/**
 * Register all webhook routes on the Express app.
 * Called from src/index.ts before server.listen().
 *
 * Routes:
 *   GET  /webhooks/twitter       — Twitter CRC challenge
 *   POST /webhooks/twitter       — Twitter AAA follow events (real-time)
 *   GET  /webhooks/instagram     — Meta webhook verification
 *   POST /webhooks/instagram     — Meta DM/mention events → triggers immediate poll
 */
export function registerWebhookRoutes(app: Application): void {
  // Twitter
  app.get("/webhooks/twitter", (req, res) => {
    handleTwitterCRC(req, res);
  });

  app.post("/webhooks/twitter", async (req, res) => {
    const c = cache.get("twitter");
    if (!c) {
      res.sendStatus(200);
      return;
    }
    await handleTwitterWebhookEvent(req, res, bq, c);
  });

  // Instagram / Meta
  app.get("/webhooks/instagram", (req, res) => {
    handleMetaWebhookVerification(req, res);
  });

  app.post("/webhooks/instagram", async (req, res) => {
    const c = cache.get("instagram");
    if (!c) {
      res.sendStatus(200);
      return;
    }
    await handleMetaWebhookEvent(req, res, bq, c);
  });

  console.log(
    "[DNC] Webhook routes registered: /webhooks/twitter, /webhooks/instagram",
  );
}

// ─── Main entrypoint ──────────────────────────────────────────────────────────

export async function startDncSync(app?: Application): Promise<void> {
  await initialize();
  startPollLoops();

  if (app) {
    registerWebhookRoutes(app);
  }

  // Register Twitter webhook (one-time — only if env is fresh)
  if (
    process.env.TWITTER_API_KEY &&
    process.env.PUBLIC_URL &&
    process.env.TWITTER_WEBHOOK_REGISTER === "true"
  ) {
    setupTwitterWebhook(process.env.PUBLIC_URL).catch((err) => {
      console.warn(
        "[Twitter] Webhook registration skipped (may already exist):",
        err.message,
      );
    });
  }
}

// ─── MCP tools ────────────────────────────────────────────────────────────────

export function registerDncSyncTools(server: McpServer): void {
  server.registerTool(
    "dnc_sync_linkedin",
    {
      description:
        "Trigger immediate LinkedIn connections sync. Normally runs every 60s automatically.",
      inputSchema: {},
    },
    async () => {
      const c = cache.get("linkedin");
      if (!c)
        return {
          content: [
            {
              type: "text" as const,
              text: "LinkedIn not initialized — missing LINKEDIN_LI_AT env var",
            },
          ],
          isError: true,
        };
      const result = await pollLinkedIn(c, bq);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    },
  );

  server.registerTool(
    "dnc_sync_instagram",
    {
      description:
        "Trigger immediate Instagram followers sync. Normally trip-wire polls every 60s automatically.",
      inputSchema: {},
    },
    async () => {
      const c = cache.get("instagram");
      if (!c)
        return {
          content: [
            {
              type: "text" as const,
              text: "Instagram not initialized — missing INSTAGRAM_ACCESS_TOKEN env var",
            },
          ],
          isError: true,
        };
      // Force a full fetch by resetting the trip-wire count
      const saved = c.followerCount;
      c.followerCount = null;
      const result = await pollInstagram(c, bq);
      if (result.fetched === 0) c.followerCount = saved; // restore if no data came back
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    },
  );

  server.registerTool(
    "dnc_sync_twitter",
    {
      description:
        "Trigger immediate Twitter followers sync. Real-time via webhook (AAA) + 5min fallback poll.",
      inputSchema: {},
    },
    async () => {
      const c = cache.get("twitter");
      if (!c)
        return {
          content: [
            {
              type: "text" as const,
              text: "Twitter not initialized — missing TWITTER_BEARER_TOKEN env var",
            },
          ],
          isError: true,
        };
      const result = await pollTwitter(c, bq);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    },
  );

  server.registerTool(
    "dnc_sync_all",
    {
      description:
        "Trigger immediate sync across all configured platforms in parallel.",
      inputSchema: {},
    },
    async () => {
      const results: SyncResult[] = [];
      const errors: string[] = [];

      await Promise.allSettled([
        cache.get("linkedin")
          ? pollLinkedIn(cache.get("linkedin")!, bq)
              .then((r) => results.push(r))
              .catch((e) => errors.push(`LinkedIn: ${e.message}`))
          : Promise.resolve(),
        cache.get("instagram")
          ? pollInstagram(cache.get("instagram")!, bq)
              .then((r) => results.push(r))
              .catch((e) => errors.push(`Instagram: ${e.message}`))
          : Promise.resolve(),
        cache.get("twitter")
          ? pollTwitter(cache.get("twitter")!, bq)
              .then((r) => results.push(r))
              .catch((e) => errors.push(`Twitter: ${e.message}`))
          : Promise.resolve(),
      ]);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                platforms: results.map((r) => r.platform),
                total_inserted: results.reduce((s, r) => s + r.inserted, 0),
                results,
                errors,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    "dnc_connections_status",
    {
      description:
        "Show current DNC sync status — cache sizes, last poll times, platform health.",
      inputSchema: {},
    },
    async () => {
      const status = Object.fromEntries(
        Array.from(cache.entries()).map(([platform, c]) => [
          platform,
          {
            owner: c.ownerUsername,
            known_ids: c.knownIds.size,
            last_poll: c.lastPollAt,
            last_connected: c.lastConnectedAt
              ? new Date(c.lastConnectedAt).toISOString()
              : null,
            follower_count: c.followerCount,
          },
        ]),
      );
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                status,
                bq_table: `midyear-glazing-485303-u3.togari_dnc.social_connections`,
                view: `midyear-glazing-485303-u3.togari_dnc.v_all_connections`,
                pubsub:
                  process.env.PUBSUB_TOPIC_SOCIAL ??
                  "togari-social-connections",
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  console.log(
    "[DNC] MCP tools registered: dnc_sync_linkedin, dnc_sync_instagram, dnc_sync_twitter, dnc_sync_all, dnc_connections_status",
  );
}
