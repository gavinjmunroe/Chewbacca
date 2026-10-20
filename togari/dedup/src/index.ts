#!/usr/bin/env node

/**
 * togari-gtm — Unified GTM OS MCP Server
 *
 * Security features:
 *   - API keys loaded from Google Secret Manager (env var fallback for local dev)
 *   - Per-tenant rate limiting: 100 requests/minute via token bucket
 *   - Every tool invocation logged to BigQuery audit_log (client_id, user_id,
 *     tool_name, duration_ms, success) via transparent server-level wrapper
 *   - JWT validation (Auth0 RS256) for HTTP mode; TENANT_ID for stdio mode
 *   - client_id injected into every BigQuery query as a named parameter
 *
 * Transport modes:
 *   - stdio mode for Claude Desktop (default)
 *   - HTTP/SSE mode when PORT is set (Cloud Run / Railway)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse";
import express from "express";
import { z } from "zod";

// GTM agents
import { registerAllAgents } from "./agents";

// Slack bot handler
import { slackEventsHandler } from "./agents/slack-sync";

// BigQuery NL query services
import { loadConfig, McpConfig } from "./services/config";
import { SqlGenerator, ColumnDef } from "./services/sql-generator";
import { BigQueryClient } from "./services/bigquery-client";
import { handleQueryContacts } from "./tools/query-contacts";

// Security & observability
import {
  validateOAuthToken,
  oauthProtectedResourceHandler,
  oauthDiscoveryHandler,
} from "./services/oauth";
import { createRateLimiter } from "./services/rate-limiter";
import { AuditLogger } from "./services/audit-logger";
import { runWithTenantContext, getStdioClientId } from "./middleware/auth";

// ToolProvider registry for external API health checks
import { getToolRegistry } from "./services/providers";

// Direct-mode REST routes (bypass Claude, hit BigQuery directly)
import { createDirectApiRouter } from "./routes/direct-api";

// Error tracking & event system
import { initSentry, flushSentry, captureException } from "./services/sentry";

// DNC Social Sync — LinkedIn, Instagram → togari_dnc.social_connections
import {
  registerDncSyncTools,
  startDncSync,
} from "./dnc/workers/orchestrator.js";
import { registerOAuthRoutes } from "./dnc/auth/oauth-routes.js";
import {
  registerPeopleRoutes,
  registerApiKeyRoutes,
  registerAppleRoutes,
} from "./dnc/api/index.js";
import { registerHealthRoutes } from "./dnc/api/health.routes.js";
import { validateEnv } from "./lib/env";
import {
  ALLOWED_SOCIAL_PLATFORMS,
  isAllowedSocialPlatform,
  isAllowedOrigin,
  requireProjectId,
  capLimit,
  buildSocialConnectionsQuery,
} from "./dashboard-helpers";

/**
 * Monkey-patches server.tool() so every handler — across all 58+ tools — is
 * automatically wrapped with:
 *   - Execution timing (duration_ms)
 *   - Success/failure tracking
 *   - Fire-and-forget write to audit_log
 *
 * No tool file needs to change. The handler is always the last argument
 * regardless of which overload is used (3-arg, 4-arg, or 5-arg form).
 */
async function registerBigQueryTools(server: McpServer): Promise<void> {
  let config: McpConfig;
  try {
    config = await loadConfig();
  } catch (err) {
    process.stderr.write(
      `BigQuery tools skipped (missing env vars): ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return;
  }

  // Audit logger — fire-and-forget logging to BigQuery
  const auditLogger = new AuditLogger(
    config.gcpProjectId,
    config.bigqueryDataset,
    config.googleApplicationCredentials,
    config.gcpCredentialsBase64,
  );

  const contactsSchema = `- linkedinUrl (STRING) — LinkedIn profile URL
- fullName (STRING) — Full name of the contact
- firstName (STRING) — First name
- lastName (STRING) — Last name
- workEmail (STRING) — Work email address
- phone (STRING) — Phone number
- currentTitle (STRING) — Current job title
- currentCompany (STRING) — Current company name
- companyDomain (STRING) — Company website domain
- createdAt (TIMESTAMP) — When the contact record was created`;

  const sqlGenerator = new SqlGenerator(
    config.anthropicApiKey,
    config.gcpProjectId,
    config.bigqueryDataset,
    config.bigqueryTable,
    contactsSchema,
  );

  const bigqueryClient = new BigQueryClient(
    config.gcpProjectId,
    config.googleApplicationCredentials,
    config.gcpCredentialsBase64,
  );

  server.tool(
    "query_contacts",
    "Query the Togari contacts database using natural language. " +
      "Searches across contact fields: name, email, phone, title, company, LinkedIn URL, and domain. " +
      'Examples: "Find all engineers at Google", "Show contacts added this week", ' +
      '"How many contacts have a work email?", "List contacts with titles containing VP".',
    {
      natural_language_query: z
        .string()
        .describe(
          "A natural language question about your contacts. " +
            "The system will convert this to a BigQuery SQL query and return results.",
        ),
    },
    async ({ natural_language_query }) => {
      const start = Date.now();
      try {
        const result = await handleQueryContacts(
          { natural_language_query },
          sqlGenerator,
          bigqueryClient,
        );
        auditLogger.log({
          client_id: process.env.TENANT_ID || "unknown",
          user_id: "stdio",
          tool_name: "query_contacts",
          tokens_used: 0,
          cost_usd: 0,
          duration_ms: Date.now() - start,
          success: true,
          error_message: "",
          timestamp: new Date(),
        });
        return { content: [{ type: "text" as const, text: result }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        auditLogger.log({
          client_id: process.env.TENANT_ID || "unknown",
          user_id: "stdio",
          tool_name: "query_contacts",
          tokens_used: 0,
          cost_usd: 0,
          duration_ms: Date.now() - start,
          success: false,
          error_message: message,
          timestamp: new Date(),
        });
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    },
  );

  // query_deals tool (only if BIGQUERY_DEALS_TABLE is configured)
  if (config.bigqueryDealsTable) {
    const dealsSchema = `- deal_id (STRING) — Unique deal identifier
- client_id (STRING) — BMA tenant/client identifier (currently NULL for most rows)
- deal_name (STRING) — Name of the deal / company (e.g. "Oshi", "Verse", "TideRock"). This is the primary identifier for deals — use this when searching by company name.
- company (STRING) — Company name (currently NULL for most rows — use deal_name instead)
- contact_ids (ARRAY<STRING>) — Linked contact UUIDs (currently empty arrays)
- value (FLOAT64) — Deal value in dollars (currently NULL — pricing info is in deal_amount_cycle as text)
- stage (STRING) — Deal stage. Known values in the data: "conversation_started", "negotiating"
- pipeline (STRING) — Pipeline type. Known values: "partnerships", "inbound", "outbound"
- owner (STRING) — Deal owner (e.g. "Maggie Chen", "Kevin Cong", "Sagar Tiwari")
- close_date (DATE) — Expected or actual close date
- notes (STRING) — Deal notes
- next_action (STRING) — Next action to take
- next_action_date (DATE) — When next action is due
- created_at (TIMESTAMP) — When the deal was created
- updated_at (TIMESTAMP) — Last update timestamp
- contact_full_name (STRING) — Primary contact full name (e.g. "Braddon White", "Greg Aamodt")
- contact_first_name (STRING) — Primary contact first name
- contact_last_name (STRING) — Primary contact last name
- contact_email (STRING) — Primary contact email
- contact_linkedin (STRING) — Primary contact LinkedIn URL
- deal_source (STRING) — How the deal originated (e.g. "Joe Hinderstein", "Inbound", "Warm Network")
- deal_duration (STRING) — Expected deal duration (e.g. "Ongoing", "4 Weeks", "6 Weeks")
- deal_amount_cycle (STRING) — Pricing and billing info as text (e.g. "$4000 - Monthly", "$12000 - 6 week engagement", "$6000 - 6 week engagement")

IMPORTANT: When querying deals, note that company/value are mostly NULL. Use deal_name for company lookup, deal_amount_cycle for pricing, and deal_source for pipeline/origin.`;

    const dealsSqlGenerator = new SqlGenerator(
      config.anthropicApiKey,
      config.gcpProjectId,
      config.bigqueryDataset,
      config.bigqueryDealsTable,
      dealsSchema,
    );

    const dealsBigqueryClient = new BigQueryClient(
      config.gcpProjectId,
      config.googleApplicationCredentials,
      config.gcpCredentialsBase64,
    );

    server.tool(
      "query_deals",
      "Query the Togari deals database using natural language. " +
        "Searches across deal fields in the deals table. " +
        'Examples: "Show all deals closed this month", "Find deals worth over 100k", ' +
        '"How many open deals do we have?".',
      {
        natural_language_query: z
          .string()
          .describe(
            "A natural language question about your deals. " +
              "The system will convert this to a BigQuery SQL query and return results.",
          ),
      },
      async ({ natural_language_query }) => {
        const start = Date.now();
        try {
          const result = await handleQueryContacts(
            { natural_language_query },
            dealsSqlGenerator,
            dealsBigqueryClient,
          );
          auditLogger.log({
            client_id: process.env.TENANT_ID || "unknown",
            user_id: "stdio",
            tool_name: "query_deals",
            tokens_used: 0,
            cost_usd: 0,
            duration_ms: Date.now() - start,
            success: true,
            error_message: "",
            timestamp: new Date(),
          });
          return { content: [{ type: "text" as const, text: result }] };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          auditLogger.log({
            client_id: process.env.TENANT_ID || "unknown",
            user_id: "stdio",
            tool_name: "query_deals",
            tokens_used: 0,
            cost_usd: 0,
            duration_ms: Date.now() - start,
            success: false,
            error_message: message,
            timestamp: new Date(),
          });
          return {
            content: [{ type: "text" as const, text: `Error: ${message}` }],
            isError: true,
          };
        }
      },
    );
  }

  process.stderr.write(
    "BigQuery tools registered: query_contacts, query_deals\n",
  );
}

function createServer(config: McpConfig, bqClient: BigQueryClient): McpServer {
  const server = new McpServer({ name: "togari-gtm", version: "1.0.0" });

  // Register all GTM agent tools (BOF, CS, Analytics, MOF, TOF, etc.)
  registerAllAgents(server);

  // Register BigQuery NL query tools (query_contacts, query_deals)
  // Note: async but we don't need to block server creation on it
  registerBigQueryTools(server).catch((err) => {
    process.stderr.write(
      `BigQuery tools registration failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  });

  // Register DNC social sync tools (dnc_sync_linkedin, dnc_sync_instagram, dnc_sync_all)
  registerDncSyncTools(server);

  return server;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Fail loud at boot if required env vars are missing; warn on optional gaps.
  // Skipped in stdio mode (Claude Desktop) where Auth0 + BQ aren't required.
  if (process.env.PORT) {
    validateEnv();
  }

  // Initialize Sentry error tracking (no-op if SENTRY_DSN not set)
  initSentry();

  // DNC sync started after app is ready (see below — needs express app ref)
  // Load config once at startup — API keys fetched from Secret Manager and cached
  const config = await loadConfig();
  const bqClient = new BigQueryClient(
    config.gcpProjectId,
    config.googleApplicationCredentials,
    config.gcpCredentialsBase64,
  );

  const port = process.env.PORT;

  if (port) {
    // ── HTTP/SSE mode (Cloud Run / Railway) ──────────────────────────────────
    const app = express();

    app.use((req, res, next) => {
      const origin = req.headers.origin;
      if (isAllowedOrigin(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin as string);
        res.setHeader("Vary", "Origin");
      }
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, x-api-key, Content-Type, Mcp-Session-Id",
      );
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PATCH, OPTIONS",
      );
      next();
    });

    app.options("*", (_req, res) => res.status(204).end());

    // JSON body parsing for direct-api POST/PATCH routes
    app.use(express.json());

    // Per-tenant rate limiting (100 requests/minute per tenant)
    const rateLimiter = createRateLimiter({
      maxTokens: 100,
      refillRatePerSecond: 100 / 60,
    });

    // OAuth discovery endpoints (public — no auth required)
    app.get(
      "/.well-known/oauth-protected-resource",
      oauthProtectedResourceHandler,
    );
    app.get("/.well-known/oauth-authorization-server", oauthDiscoveryHandler);

    // Health check (public) — includes provider health status
    app.get("/", (_req, res) => {
      res.redirect("/dashboard");
    });

    app.get("/health", async (_req, res) => {
      try {
        const registry = getToolRegistry();
        const providerHealth = await registry.healthCheck();

        res.json({
          status: providerHealth.healthy ? "ok" : "degraded",
          service: "togari-gtm",
          version: "1.0.0",
          timestamp: providerHealth.timestamp,
          providers: {
            healthy:
              registry.getAllProviders().size -
              providerHealth.failedProviders.length,
            total: registry.getAllProviders().size,
            failed: providerHealth.failedProviders,
            details: providerHealth.providers,
          },
          averageLatency_ms: providerHealth.averageLatency_ms,
        });
      } catch (error) {
        res.status(500).json({
          status: "error",
          service: "togari-gtm",
          version: "1.0.0",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    // ── Direct-mode REST API (bypass Claude, hit BigQuery directly) ──────────
    app.use("/api", createDirectApiRouter());

    // Rate limiting middleware — applied after OAuth validation
    const rateLimitMiddleware = (
      _req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ): void => {
      const tenantId = res.locals.clientId || "anonymous";
      if (!rateLimiter.tryConsume(tenantId)) {
        res.status(429).json({
          error: "Too Many Requests",
          message: "Rate limit exceeded. Try again later.",
        });
        return;
      }
      next();
    };

    // SSE transport — OAuth + rate limiting
    const transports = new Map<string, SSEServerTransport>();
    const sessions = new Map<string, { clientId: string; userId?: string }>();

    app.get(
      "/sse",
      validateOAuthToken,
      rateLimitMiddleware,
      async (req, res) => {
        const transport = new SSEServerTransport("/messages", res);
        const sessionId = transport.sessionId;
        const clientId = req.clientId;
        const userId = req.userId;

        transports.set(sessionId, transport);
        sessions.set(sessionId, { clientId, userId });

        res.on("close", () => {
          transports.delete(sessionId);
          sessions.delete(sessionId);
        });

        process.stderr.write(
          `[auth] SSE session ${sessionId} — tenant: ${clientId} user: ${userId ?? "n/a"}\n`,
        );

        const server = createServer(config, bqClient);
        await runWithTenantContext(clientId, userId, () =>
          server.connect(transport),
        );
      },
    );

    app.post(
      "/messages",
      validateOAuthToken,
      rateLimitMiddleware,
      async (req, res) => {
        const sessionId = req.query.sessionId as string;
        const transport = transports.get(sessionId);
        const session = sessions.get(sessionId);

        if (!transport || !session) {
          res.status(400).json({ error: "Unknown session" });
          return;
        }

        // Per-tenant rate limiting — check before dispatching to tool handlers
        if (!rateLimiter.tryConsume(session.clientId)) {
          res.status(429).json({
            error: "Rate limit exceeded",
            message: `Too many requests. Limit is 100/minute per tenant.`,
            retryAfterMs: 60_000,
          });
          return;
        }

        await runWithTenantContext(session.clientId, session.userId, () =>
          transport.handlePostMessage(req, res),
        );
      },
    );

    // Slack events webhook (uses Slack's own signature verification, not MCP API key auth)
    app.post(
      "/slack/events",
      express.text({ type: "*/*" }),
      slackEventsHandler,
    );

    // DNC self-serve OAuth connect routes (generalizable — any user can connect)
    registerOAuthRoutes(app);

    // Dedup v2 — Clay-callable API surface (WS-1, WS-2, WS-3 fill in the stubs)
    registerPeopleRoutes(app);
    registerApiKeyRoutes(app);
    registerAppleRoutes(app);
    registerHealthRoutes(app);

    // DNC social sync — registers webhook routes + starts poll loops
    await startDncSync(app);

    // ── Dashboard ─────────────────────────────────────────────────────────────
    // Static-serve every file in src/dashboard. Implicit .html resolution lets
    // users navigate to clean URLs like /dashboard/onboarding (no extension).
    app.use(
      "/dashboard",
      express.static(require("path").join(__dirname, "../src/dashboard"), {
        extensions: ["html"],
        index: "index.html",
      }),
    );

    // GET /api/dnc
    app.get("/api/dnc", validateOAuthToken, async (_req, res) => {
      try {
        const projectId = requireProjectId();
        const { BigQuery } = await import("@google-cloud/bigquery");
        const bq = new BigQuery({ projectId });
        const [rows] = await bq.query({
          query: `SELECT * FROM \`${projectId}.togari_dnc.contacts\` WHERE is_dnc = TRUE ORDER BY last_updated_at DESC LIMIT 200`,
          useLegacySql: false,
        });
        res.json({ contacts: rows, total: rows.length });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    // GET /api/social/connections
    app.get("/api/social/connections", validateOAuthToken, async (req, res) => {
      try {
        const projectId = requireProjectId();
        const platform = req.query.platform as string | undefined;
        if (platform && !isAllowedSocialPlatform(platform)) {
          res.status(400).json({
            error: `platform must be one of ${ALLOWED_SOCIAL_PLATFORMS.join(", ")}`,
          });
          return;
        }
        const limit = capLimit(req.query.limit);
        const { sql, params, types } = buildSocialConnectionsQuery(
          projectId,
          platform,
          limit,
        );
        const { BigQuery } = await import("@google-cloud/bigquery");
        const bq = new BigQuery({ projectId });
        const [rows] = await bq.query({
          query: sql,
          params,
          types,
          useLegacySql: false,
        });
        res.json({ connections: rows, total: rows.length });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    // GET /api/social/stats
    app.get("/api/social/stats", validateOAuthToken, async (_req, res) => {
      try {
        const projectId = requireProjectId();
        const { BigQuery } = await import("@google-cloud/bigquery");
        const bq = new BigQuery({ projectId });
        const [rows] = await bq.query({
          query: `SELECT platform, COUNT(*) as count FROM \`${projectId}.togari_dnc.social_connections\` GROUP BY platform`,
          useLegacySql: false,
        });
        const total = (rows as any[]).reduce(
          (s: number, r: any) => s + Number(r.count),
          0,
        );
        res.json({ total, by_platform: rows });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    // GET /api/dnc/stats
    app.get("/api/dnc/stats", validateOAuthToken, async (_req, res) => {
      try {
        const projectId = requireProjectId();
        const { BigQuery } = await import("@google-cloud/bigquery");
        const bq = new BigQuery({ projectId });
        const [rows] = await bq.query({
          query: `SELECT COUNT(*) as total FROM \`${projectId}.togari_dnc.contacts\` WHERE is_dnc = TRUE`,
          useLegacySql: false,
        });
        res.json({ total: (rows as any[])[0]?.total ?? 0 });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    // POST /dnc/sync/:platform
    app.post("/dnc/sync/:platform", validateOAuthToken, async (req, res) => {
      const platform = req.params.platform;
      if (platform !== "all" && !isAllowedSocialPlatform(platform)) {
        res.status(400).json({
          error: `platform must be "all" or one of ${ALLOWED_SOCIAL_PLATFORMS.join(", ")}`,
        });
        return;
      }
      try {
        const { runSyncForAllUsers } =
          await import("./dnc/workers/user-sync.js");
        const { DncBigQueryWriter } =
          await import("./dnc/workers/bq-writer.js");
        const bqw = new DncBigQueryWriter();
        if (platform === "all") {
          await Promise.allSettled(
            ["linkedin", "instagram", "twitter"].map((p) =>
              runSyncForAllUsers(p as any, bqw),
            ),
          );
          res.json({ success: true, message: "All platforms synced" });
        } else {
          await runSyncForAllUsers(platform as any, bqw);
          res.json({ success: true, platform });
        }
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    app.listen(Number(port), () => {
      process.stderr.write(
        `Togari GTM MCP Server listening on port ${port} (SSE mode)\n` +
          `Health:     http://localhost:${port}/health\n` +
          `Direct API: http://localhost:${port}/api/deals\n`,
      );
    });
  } else {
    // ── stdio mode (Claude Desktop) ──────────────────────────────────────────
    // DNC sync in stdio mode (no webhook routes, poll-only)
    startDncSync().catch((err) =>
      process.stderr.write(`[DNC] startup failed: ${err.message}\n`),
    );

    const clientId = getStdioClientId();
    process.stderr.write(`[auth] stdio mode — tenant: ${clientId}\n`);

    const server = createServer(config, bqClient);
    const transport = new StdioServerTransport();
    await runWithTenantContext(clientId, undefined, () =>
      server.connect(transport),
    );
  }
}

// Prevent silent crashes — log errors instead of killing the process
process.on("unhandledRejection", (reason) => {
  process.stderr.write(`Unhandled rejection: ${reason}\n`);
  captureException(
    reason instanceof Error ? reason : new Error(String(reason)),
  );
});
process.on("uncaughtException", (err) => {
  process.stderr.write(`Uncaught exception: ${err.message}\n`);
  captureException(err);
});

// Graceful shutdown — flush Sentry before exit
process.on("SIGTERM", async () => {
  process.stderr.write("[shutdown] SIGTERM received, flushing Sentry...\n");
  await flushSentry();
  process.exit(0);
});

main().catch((error) => {
  process.stderr.write(
    `Fatal error starting Togari GTM MCP Server: ${error}\n`,
  );
  process.exit(1);
});
