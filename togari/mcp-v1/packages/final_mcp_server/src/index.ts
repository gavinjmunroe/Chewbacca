#!/usr/bin/env node

/**
 * Togari MCP Server
 *
 * A Model Context Protocol server that exposes BigQuery contact queries
 * to Claude Desktop via stdio transport or to HTTP clients via SSE transport.
 *
 * Modes:
 *   - If the PORT environment variable is set, starts an Express HTTP server
 *     with SSE transport (GET /sse, POST /messages, GET /health).
 *   - Otherwise, falls back to stdio transport for Claude Desktop.
 *
 * Access levels:
 *   - "internal" keys (TOGARI_INTERNAL_KEYS) get both query_contacts and query_deals tools.
 *   - "external" keys (TOGARI_EXTERNAL_KEYS) get only query_contacts.
 *   - Stdio mode always uses "internal" access level.
 *   - If no keys are configured, auth is skipped and access is treated as "internal".
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express from 'express';
import { z } from 'zod';
import { loadConfig, McpConfig } from './config.js';
import { SqlGenerator } from './services/sql-generator.js';
import { BigQueryClient } from './services/bigquery-client.js';
import { handleQueryContacts, TOOL_NAME, TOOL_DESCRIPTION } from './tools/query-contacts.js';
import { oauthDiscoveryHandler, oauthProtectedResourceHandler, validateOAuthToken } from './oauth.js';
import { initDNCSchema } from './services/dnc-bigquery';
import dncRoutes from './routes/dnc';

type AccessLevel = 'internal' | 'external' | 'admin';

function createServer(config: McpConfig, accessLevel: AccessLevel): McpServer {

  // Initialize services for contacts
  const sqlGenerator = new SqlGenerator(
    config.anthropicApiKey,
    config.gcpProjectId,
    config.bigqueryDataset,
    config.bigqueryTable
  );

  const bigqueryClient = new BigQueryClient(
    config.gcpProjectId,
    config.googleApplicationCredentials,
    config.gcpCredentialsBase64
  );

  // Create MCP server
  const server = new McpServer({
    name: 'togari-contacts',
    version: '1.0.0',
  });

  // Register the query_contacts tool (available at all access levels)
  // @ts-ignore
  server.tool(
    TOOL_NAME,
    TOOL_DESCRIPTION,
    {
      natural_language_query: z
        .string()
        .describe(
          'A natural language question about your contacts. ' +
            'Examples: "Find all engineers at Google", "Show contacts added this week", ' +
            '"How many contacts have a work email?"'
        ),
    },
    async ({ natural_language_query }) => {
      try {
        const result = await handleQueryContacts(
          { natural_language_query },
          sqlGenerator,
          bigqueryClient
        );

        return {
          content: [{ type: 'text' as const, text: result }],
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  // Register query_deals tool only for internal/admin access
  if ((accessLevel === 'internal' || accessLevel === 'admin') && config.bigqueryDealsTable) {
    const dealsSqlGenerator = new SqlGenerator(
      config.anthropicApiKey,
      config.gcpProjectId,
      config.bigqueryDataset,
      config.bigqueryDealsTable
    );

    const dealsBigqueryClient = new BigQueryClient(
      config.gcpProjectId,
      config.googleApplicationCredentials,
      config.gcpCredentialsBase64
    );

    // @ts-ignore
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
        try {
          const result = await handleQueryContacts(
            { natural_language_query },
            dealsSqlGenerator,
            dealsBigqueryClient
          );

          return {
            content: [{ type: 'text' as const, text: result }],
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: 'text' as const, text: `Error: ${message}` }],
            isError: true,
          };
        }
      }
    );
  }

  return server;
}

async function main(): Promise<void> {
  const port = process.env.PORT;

  // Initialize DNC BigQuery schema (non-fatal)
  try {
    await initDNCSchema();
    process.stderr.write('DNC BigQuery schema initialized\n');
  } catch (err) {
    process.stderr.write(`DNC schema init failed (non-fatal): ${err}\n`);
  }

  if (port) {
    // HTTP mode with SSE transport
    const config = loadConfig();
    const app = express();

    // Parse JSON bodies (needed for DNC /check endpoint)
    app.use(express.json());

    // CORS headers for all responses
    app.use((_req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, x-api-key, Content-Type, Mcp-Session-Id');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      next();
    });

    // Handle OPTIONS preflight requests
    app.options('*', (_req, res) => {
      res.status(204).end();
    });

    // Health check endpoint (no auth required)
    app.get('/health', (_req, res) => {
      res.json({ status: 'ok' });
    });

    // OAuth 2.1 authorization server metadata (no auth required)
    app.get('/.well-known/oauth-authorization-server', oauthDiscoveryHandler);

    // OAuth protected resource metadata (no auth required)
    app.get('/.well-known/oauth-protected-resource', oauthProtectedResourceHandler);

    // DNC routes (no MCP auth required — has its own access pattern)
    app.use('/api/dnc', dncRoutes);

    // Build key lookup sets
    const internalKeys = new Set(config.internalApiKeys ?? []);
    const externalKeys = new Set(config.externalApiKeys ?? []);
    const authEnabled = internalKeys.size > 0 || externalKeys.size > 0;

    // Auth middleware
    app.use(async (req, res, next) => {
      if (req.method === 'OPTIONS') return next();
      if (req.method === 'GET' && (req.path === '/health' || req.path.startsWith('/.well-known/'))) return next();
      if (req.path.startsWith('/api/dnc')) return next();

      const authHeader = req.headers['authorization'];
      const apiKeyHeader = req.headers['x-api-key'] as string | undefined;

      // Try API key first (x-api-key header)
      if (apiKeyHeader && authEnabled) {
        if (internalKeys.has(apiKeyHeader)) {
          res.locals.accessLevel = 'internal';
          return next();
        } else if (externalKeys.has(apiKeyHeader)) {
          res.locals.accessLevel = 'external';
          return next();
        }
      }

      // Try OAuth Bearer token
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7);

        // Check if the bearer token is actually an API key
        if (authEnabled && internalKeys.has(token)) {
          res.locals.accessLevel = 'internal';
          return next();
        }
        if (authEnabled && externalKeys.has(token)) {
          res.locals.accessLevel = 'external';
          return next();
        }

        // Otherwise treat as OAuth token
        return validateOAuthToken(req, res, () => {
          const permissions: string[] = res.locals.permissions || [];
          const writePerms = ['write:contacts', 'write:deals', 'delete:contacts', 'delete:deals'];
          if (writePerms.some((p) => permissions.includes(p))) {
            res.locals.accessLevel = 'admin';
          } else if (permissions.includes('read:deals')) {
            res.locals.accessLevel = 'internal';
          } else {
            res.locals.accessLevel = 'external';
          }
          next();
        });
      }

      // No valid auth provided
      if (!authEnabled) {
        res.locals.accessLevel = 'internal';
        return next();
      }

      res.setHeader('WWW-Authenticate', 'Bearer resource_metadata="https://mcp.bluemodern.ai/.well-known/oauth-protected-resource"');
      res.status(401).json({ error: 'Unauthorized' });
    });

    // Store active transports by session
    const transports = new Map<string, SSEServerTransport>();

    // SSE endpoint — each connection gets its own MCP server + transport
    app.get('/sse', async (_req, res) => {
      const transport = new SSEServerTransport('/messages', res);
      const sessionId = transport.sessionId;
      transports.set(sessionId, transport);

      res.on('close', () => {
        transports.delete(sessionId);
      });

      const accessLevel: AccessLevel = res.locals.accessLevel as AccessLevel;
      const server = createServer(config, accessLevel);
      await server.connect(transport);
    });

    // Message endpoint for SSE clients
    app.post('/messages', async (req, res) => {
      const sessionId = req.query.sessionId as string;
      const transport = transports.get(sessionId);
      if (!transport) {
        res.status(400).json({ error: 'Unknown session' });
        return;
      }
      await transport.handlePostMessage(req, res);
    });

    app.post('/sse', async (req, res) => {
      const sessionId = req.query.sessionId as string;
      const transport = transports.get(sessionId);
      if (!transport) {
        res.status(400).json({ error: 'Unknown session' });
        return;
      }
      await transport.handlePostMessage(req, res);
    });

    app.listen(Number(port), () => {
      process.stderr.write(`Togari MCP Server listening on port ${port} (SSE mode)\n`);
    });
  } else {
    // Stdio mode for Claude Desktop — always internal access
    const config = loadConfig();
    const server = createServer(config, 'internal');
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

main().catch((error) => {
  process.stderr.write(`Fatal error starting Togari MCP Server: ${error}\n`);
  process.exit(1);
});
