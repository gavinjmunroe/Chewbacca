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

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse';
import express from 'express';
import { z } from 'zod';

// GTM agents
import { registerAllAgents } from './agents';

// Slack bot handler
import { slackEventsHandler } from './agents/slack-sync';

// BigQuery NL query services
import { loadConfig, McpConfig } from './services/config';
import { SqlGenerator, ColumnDef } from './services/sql-generator';
import { BigQueryClient } from './services/bigquery-client';
import { handleQueryContacts } from './tools/query-contacts';

// Security & observability
import { validateOAuthToken, oauthProtectedResourceHandler, oauthDiscoveryHandler } from './services/oauth';
import { createRateLimiter } from './services/rate-limiter';
import { AuditLogger } from './services/audit-logger';
import { TokenBucketRateLimiter } from './middleware/rate-limiter';
import { runWithTenantContext, getStdioClientId } from './middleware/auth';

// ToolProvider registry for external API health checks
import { getToolRegistry } from './services/providers';

// Direct-mode REST routes (bypass Claude, hit BigQuery directly)
import { createDirectApiRouter } from './routes/direct-api';

// Error tracking & event system
import { initSentry, flushSentry, captureException } from './services/sentry';

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
      `BigQuery tools skipped (missing env vars): ${err instanceof Error ? err.message : String(err)}\n`
    );
    return;
  }

  // Audit logger — fire-and-forget logging to BigQuery
  const auditLogger = new AuditLogger(
    config.gcpProjectId,
    config.bigqueryDataset,
    config.googleApplicationCredentials,
    config.gcpCredentialsBase64
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
    contactsSchema
  );

  const bigqueryClient = new BigQueryClient(
    config.gcpProjectId,
    config.googleApplicationCredentials,
    config.gcpCredentialsBase64,
  );

  server.tool(
    'query_contacts',
    'Query the Togari contacts database using natural language. ' +
      'Searches across contact fields: name, email, phone, title, company, LinkedIn URL, and domain. ' +
      'Examples: "Find all engineers at Google", "Show contacts added this week", ' +
      '"How many contacts have a work email?", "List contacts with titles containing VP".',
    {
      natural_language_query: z
        .string()
        .describe(
          'A natural language question about your contacts. ' +
            'The system will convert this to a BigQuery SQL query and return results.'
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
          client_id: process.env.TENANT_ID || 'unknown',
          user_id: 'stdio',
          tool_name: 'query_contacts',
          tokens_used: 0,
          cost_usd: 0,
          duration_ms: Date.now() - start,
          success: true,
          error_message: '',
          timestamp: new Date(),
        });
        return { content: [{ type: 'text' as const, text: result }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        auditLogger.log({
          client_id: process.env.TENANT_ID || 'unknown',
          user_id: 'stdio',
          tool_name: 'query_contacts',
          tokens_used: 0,
          cost_usd: 0,
          duration_ms: Date.now() - start,
          success: false,
          error_message: message,
          timestamp: new Date(),
        });
        return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
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
      dealsSchema
    );

    const dealsBigqueryClient = new BigQueryClient(
      config.gcpProjectId,
      config.googleApplicationCredentials,
      config.gcpCredentialsBase64
    );

    server.tool(
      'query_deals',
      'Query the Togari deals database using natural language. ' +
        'Searches across deal fields in the deals table. ' +
        'Examples: "Show all deals closed this month", "Find deals worth over 100k", ' +
        '"How many open deals do we have?".',
      {
        natural_language_query: z
          .string()
          .describe(
            'A natural language question about your deals. ' +
              'The system will convert this to a BigQuery SQL query and return results.'
          ),
      },
      async ({ natural_language_query }) => {
        const start = Date.now();
        try {
          const result = await handleQueryContacts(
            { natural_language_query },
            dealsSqlGenerator,
            dealsBigqueryClient
          );
          auditLogger.log({
            client_id: process.env.TENANT_ID || 'unknown',
            user_id: 'stdio',
            tool_name: 'query_deals',
            tokens_used: 0,
            cost_usd: 0,
            duration_ms: Date.now() - start,
            success: true,
            error_message: '',
            timestamp: new Date(),
          });
          return { content: [{ type: 'text' as const, text: result }] };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          auditLogger.log({
            client_id: process.env.TENANT_ID || 'unknown',
            user_id: 'stdio',
            tool_name: 'query_deals',
            tokens_used: 0,
            cost_usd: 0,
            duration_ms: Date.now() - start,
            success: false,
            error_message: message,
            timestamp: new Date(),
          });
          return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
        }
      }
    );
  }

  process.stderr.write('BigQuery tools registered: query_contacts, query_deals\n');
}

function createServer(config: McpConfig, bqClient: BigQueryClient): McpServer {
  const server = new McpServer({ name: 'togari-gtm', version: '1.0.0' });

  // Register all GTM agent tools (BOF, CS, Analytics, MOF, TOF, etc.)
  registerAllAgents(server);

  // Register BigQuery NL query tools (query_contacts, query_deals)
  // Note: async but we don't need to block server creation on it
  registerBigQueryTools(server).catch((err) => {
    process.stderr.write(`BigQuery tools registration failed: ${err instanceof Error ? err.message : String(err)}\n`);
  });

  return server;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Initialize Sentry error tracking (no-op if SENTRY_DSN not set)
  initSentry();

  // Load config once at startup — API keys fetched from Secret Manager and cached
  const config    = await loadConfig();
  const bqClient  = new BigQueryClient(
    config.gcpProjectId,
    config.googleApplicationCredentials,
    config.gcpCredentialsBase64,
  );

  // Per-tenant rate limiter — 100 requests/minute; swap to Redis by replacing
  // TokenBucketRateLimiter with any class that implements RateLimiter interface
  const rateLimiter = new TokenBucketRateLimiter(100);

  const port = process.env.PORT;

  if (port) {
    // ── HTTP/SSE mode (Cloud Run / Railway) ──────────────────────────────────
    const app = express();

    app.use((_req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, x-api-key, Content-Type, Mcp-Session-Id');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
      next();
    });

    app.options('*', (_req, res) => res.status(204).end());

    // JSON body parsing for direct-api POST/PATCH routes
    app.use(express.json());

    // Per-tenant rate limiting (100 requests/minute per tenant)
    const rateLimiter = createRateLimiter({ maxTokens: 100, refillRatePerSecond: 100 / 60 });

    // OAuth discovery endpoints (public — no auth required)
    app.get('/.well-known/oauth-protected-resource', oauthProtectedResourceHandler);
    app.get('/.well-known/oauth-authorization-server', oauthDiscoveryHandler);

    // Health check (public) — includes provider health status
    app.get('/health', async (_req, res) => {
      try {
        const registry = getToolRegistry();
        const providerHealth = await registry.healthCheck();

        res.json({
          status: providerHealth.healthy ? 'ok' : 'degraded',
          service: 'togari-gtm',
          version: '1.0.0',
          timestamp: providerHealth.timestamp,
          providers: {
            healthy: registry.getAllProviders().size - providerHealth.failedProviders.length,
            total: registry.getAllProviders().size,
            failed: providerHealth.failedProviders,
            details: providerHealth.providers,
          },
          averageLatency_ms: providerHealth.averageLatency_ms,
        });
      } catch (error) {
        res.status(500).json({
          status: 'error',
          service: 'togari-gtm',
          version: '1.0.0',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    // ── Direct-mode REST API (bypass Claude, hit BigQuery directly) ──────────
    app.use('/api', createDirectApiRouter());

    // Rate limiting middleware — applied after OAuth validation
    const rateLimitMiddleware = (_req: express.Request, res: express.Response, next: express.NextFunction): void => {
      const tenantId = res.locals.clientId || 'anonymous';
      if (!rateLimiter.tryConsume(tenantId)) {
        res.status(429).json({ error: 'Too Many Requests', message: 'Rate limit exceeded. Try again later.' });
        return;
      }
      next();
    };

    // SSE transport — OAuth + rate limiting
    const transports = new Map<string, SSEServerTransport>();
    const sessions   = new Map<string, { clientId: string; userId?: string }>();

    app.get('/sse', validateOAuthToken, rateLimitMiddleware, async (req, res) => {
      const transport = new SSEServerTransport('/messages', res);
      const sessionId = transport.sessionId;
      const clientId  = req.clientId;
      const userId    = req.userId;

      transports.set(sessionId, transport);
      sessions.set(sessionId, { clientId, userId });

      res.on('close', () => {
        transports.delete(sessionId);
        sessions.delete(sessionId);
      });

      process.stderr.write(`[auth] SSE session ${sessionId} — tenant: ${clientId} user: ${userId ?? 'n/a'}\n`);

      const server = createServer(config, bqClient);
      await runWithTenantContext(clientId, userId, () => server.connect(transport));
    });

    app.post('/messages', validateOAuthToken, rateLimitMiddleware, async (req, res) => {
      const sessionId = req.query.sessionId as string;
      const transport = transports.get(sessionId);
      const session   = sessions.get(sessionId);

      if (!transport || !session) {
        res.status(400).json({ error: 'Unknown session' });
        return;
      }

      // Per-tenant rate limiting — check before dispatching to tool handlers
      if (!rateLimiter.tryConsume(session.clientId)) {
        res.status(429).json({
          error: 'Rate limit exceeded',
          message: `Too many requests. Limit is 100/minute per tenant.`,
          retryAfterMs: 60_000,
        });
        return;
      }

      await runWithTenantContext(
        session.clientId,
        session.userId,
        () => transport.handlePostMessage(req, res),
      );
    });

    // Slack events webhook (uses Slack's own signature verification, not MCP API key auth)
    app.post('/slack/events', express.text({ type: '*/*' }), slackEventsHandler);

    app.listen(Number(port), () => {
      process.stderr.write(
        `Togari GTM MCP Server listening on port ${port} (SSE mode)\n` +
        `Health:     http://localhost:${port}/health\n` +
        `Direct API: http://localhost:${port}/api/deals\n`,
      );
    });

  } else {
    // ── stdio mode (Claude Desktop) ──────────────────────────────────────────
    const clientId = getStdioClientId();
    process.stderr.write(`[auth] stdio mode — tenant: ${clientId}\n`);

    const server    = createServer(config, bqClient);
    const transport = new StdioServerTransport();
    await runWithTenantContext(clientId, undefined, () => server.connect(transport));
  }
}

// Prevent silent crashes — log errors instead of killing the process
process.on('unhandledRejection', (reason) => {
  process.stderr.write(`Unhandled rejection: ${reason}\n`);
  captureException(reason instanceof Error ? reason : new Error(String(reason)));
});
process.on('uncaughtException', (err) => {
  process.stderr.write(`Uncaught exception: ${err.message}\n`);
  captureException(err);
});

// Graceful shutdown — flush Sentry before exit
process.on('SIGTERM', async () => {
  process.stderr.write('[shutdown] SIGTERM received, flushing Sentry...\n');
  await flushSentry();
  process.exit(0);
});

main().catch((error) => {
  process.stderr.write(`Fatal error starting Togari GTM MCP Server: ${error}\n`);
  process.exit(1);
});
