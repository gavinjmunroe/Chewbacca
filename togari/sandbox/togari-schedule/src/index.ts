#!/usr/bin/env node

/**
 * togari-clay — Clay-focused GTM Agents MCP Server
 *
 * Shared infrastructure (auth, audit, rate-limiting, Sentry, events)
 * is provided by @togari/admin.
 *
 * Transport modes:
 *   - stdio mode for Claude Desktop (default)
 *   - HTTP/SSE mode when PORT is set (Cloud Run / Railway)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp';
import express from 'express';
import { z } from 'zod';
import path from 'path';

// Shared infra from @togari/admin
import {
  BigQueryClient,
  SqlGenerator,
  createAuthMiddleware,
  oauthProtectedResourceHandler,
  oauthDiscoveryHandler,
  logAudit,
  createAuditEntry,
  checkTenantLimit,
  getCurrentTenant,
  tenantStorage,
  setStdioFallback,
  createStdioTenantContext,
  initSentry,
  flushSentry,
  captureException,
  publishEvent,
} from '@togari/admin';

// GTM agents
import { registerAllAgents } from './agents';

// Server-specific config (loadConfig / McpConfig)
import { loadConfig, McpConfig } from './config/server-config';
import { handleQueryContacts } from './tools/query-contacts';

// ToolProvider registry for external API health checks
import { getToolRegistry } from './services/providers';

// Direct-mode REST routes (bypass Claude, hit BigQuery directly)
import { createDirectApiRouter } from './routes/direct-api';

// Webhook routes (Framer subscription + Stripe)
import { createWebhookRouter } from './routes/webhooks';

// Slack Events API (mounted before express.json() for raw body signature verification)
import { createSlackEventsRouter } from './routes/slack-events';

// Slack setup endpoint (create channel + Slack Connect invite)
import { createSlackRouter } from './routes/slack';

/**
 * Register BigQuery NL query tools (query_contacts, query_deals).
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
        logAudit(createAuditEntry(
          'query_contacts',
          process.env.TENANT_ID || 'unknown',
          'stdio',
          Date.now() - start,
          'success',
        ));
        return { content: [{ type: 'text' as const, text: result }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logAudit(createAuditEntry(
          'query_contacts',
          process.env.TENANT_ID || 'unknown',
          'stdio',
          Date.now() - start,
          'error',
          message,
        ));
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
          logAudit(createAuditEntry(
            'query_deals',
            process.env.TENANT_ID || 'unknown',
            'stdio',
            Date.now() - start,
            'success',
          ));
          return { content: [{ type: 'text' as const, text: result }] };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logAudit(createAuditEntry(
            'query_deals',
            process.env.TENANT_ID || 'unknown',
            'stdio',
            Date.now() - start,
            'error',
            message,
          ));
          return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
        }
      }
    );
  }

  process.stderr.write('BigQuery tools registered: query_contacts, query_deals\n');
}

function createServer(config: McpConfig, bqClient: BigQueryClient): McpServer {
  const server = new McpServer({ name: 'togari-clay', version: '1.0.0' });

  // Register opportunity notification agents
  registerAllAgents(server);

  // Register BigQuery NL query tools (query_contacts, query_deals)
  registerBigQueryTools(server).catch((err) => {
    process.stderr.write(`BigQuery tools registration failed: ${err instanceof Error ? err.message : String(err)}\n`);
  });

  return server;
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Initialize Sentry error tracking (no-op if SENTRY_DSN not set)
  initSentry();

  // Load config once at startup
  const config    = await loadConfig();
  const bqClient  = new BigQueryClient(
    config.gcpProjectId,
    config.googleApplicationCredentials,
    config.gcpCredentialsBase64,
  );

  const port = process.env.PORT;

  if (port) {
    // ── HTTP/SSE mode (Cloud Run / Railway) ──────────────────────────────────
    const app = express();

    app.use((_req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, x-api-key, Content-Type, Mcp-Session-Id, x-framer-secret');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
      next();
    });

    app.options('*', (_req, res) => res.status(204).end());

    // Slack Events API — raw body needed for HMAC signature verification, must come before express.json()
    // Scope express.raw() to only the slack-events path so other /webhooks routes get proper JSON parsing
    app.use('/webhooks/slack-events', express.raw({ type: 'application/json' }));
    app.use('/webhooks', createSlackEventsRouter());

    // Static assets (logo, etc.) — served from /public/assets
    app.use('/assets', express.static(path.join(process.cwd(), 'public/assets')));

    // JSON body parsing for direct-api POST/PATCH routes
    app.use(express.json());

    // Auth middleware from @togari/admin
    const authDomain   = process.env.AUTH0_DOMAIN || '';
    const authAudience = process.env.AUTH0_AUDIENCE || '';
    const authMiddleware = createAuthMiddleware(authDomain, authAudience);

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
          service: 'togari-clay',
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
          service: 'togari-clay',
          version: '1.0.0',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    // ── Direct-mode REST API (bypass Claude, hit BigQuery directly) ──────────
    app.use('/api', createDirectApiRouter());

    // ── Webhook endpoints (Framer subscription + Stripe payments) ───────────
    app.use('/webhooks', createWebhookRouter());

    // ── Slack setup (channel creation + Slack Connect invite) ───────────────
    app.use('/slack', createSlackRouter());

    // Rate limiting middleware
    const rateLimitMiddleware = (_req: express.Request, res: express.Response, next: express.NextFunction): void => {
      try {
        const tenant = getCurrentTenant();
        checkTenantLimit(tenant.tenantId, 'tool_call');
        next();
      } catch (err) {
        if (err instanceof Error && err.message.includes('rate')) {
          res.status(429).json({ error: 'Too Many Requests', message: 'Rate limit exceeded. Try again later.' });
          return;
        }
        next();
      }
    };

    // ── Streamable HTTP transport (stateless) — for direct JSON-RPC calls ───
    app.post('/mcp', ...authMiddleware, async (req, res) => {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      const server = createServer(config, bqClient);
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });

    // SSE transport — auth + rate limiting
    const transports = new Map<string, SSEServerTransport>();

    app.get('/sse', ...authMiddleware, rateLimitMiddleware, async (_req, res) => {
      const transport = new SSEServerTransport('/messages', res);
      const sessionId = transport.sessionId;

      transports.set(sessionId, transport);

      res.on('close', () => {
        transports.delete(sessionId);
      });

      const tenant = getCurrentTenant();
      process.stderr.write(`[auth] SSE session ${sessionId} — tenant: ${tenant.tenantId} user: ${tenant.userId ?? 'n/a'}\n`);

      const server = createServer(config, bqClient);
      await server.connect(transport);
    });

    app.post('/messages', ...authMiddleware, rateLimitMiddleware, async (req, res) => {
      const sessionId = req.query.sessionId as string;
      const transport = transports.get(sessionId);

      if (!transport) {
        res.status(400).json({ error: 'Unknown session' });
        return;
      }

      await transport.handlePostMessage(req, res);
    });

    app.listen(Number(port), () => {
      process.stderr.write(
        `Togari Clay MCP Server listening on port ${port} (SSE mode)\n` +
        `Health:     http://localhost:${port}/health\n` +
        `Direct API: http://localhost:${port}/api/data-pulls\n`,
      );
    });

  } else {
    // ── stdio mode (Claude Desktop) ──────────────────────────────────────────
    const ctx = createStdioTenantContext();
    setStdioFallback(ctx);
    process.stderr.write(`[auth] stdio mode — tenant: ${ctx.tenantId}\n`);

    const server    = createServer(config, bqClient);
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

// Prevent silent crashes
process.on('unhandledRejection', (reason) => {
  process.stderr.write(`Unhandled rejection: ${reason}\n`);
  captureException(reason instanceof Error ? reason : new Error(String(reason)));
});
process.on('uncaughtException', (err) => {
  process.stderr.write(`Uncaught exception: ${err.message}\n`);
  captureException(err);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  process.stderr.write('[shutdown] SIGTERM received, flushing Sentry...\n');
  await flushSentry();
  process.exit(0);
});

main().catch((error) => {
  process.stderr.write(`Fatal error starting Togari Clay MCP Server: ${error}\n`);
  process.exit(1);
});
