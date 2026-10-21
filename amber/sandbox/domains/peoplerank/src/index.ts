#!/usr/bin/env node

/**
 * togari-amber — MCP Server (slimmed down)
 *
 * Tools: amber_health_check, query_contacts, query_deals (optional)
 * Routes: /api/dnc (DNC + Gmail OAuth)
 *
 * Transport modes:
 *   - stdio mode for Claude Desktop (default)
 *   - HTTP/SSE mode when PORT is set (Railway deployment)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse';
import express from 'express';
import { z } from 'zod';
import dncRouter from './routes/dnc';
import { initDNCSchema } from './services/dnc-bigquery';
import { SqlGenerator, BigQueryClient } from '@togari/admin';
import { handleQueryContacts, TOOL_NAME as CONTACTS_TOOL_NAME, TOOL_DESCRIPTION as CONTACTS_TOOL_DESC } from './tools/query-contacts.js';

const AMBER_API_URL = process.env.AMBER_API_URL || 'http://localhost:3000';

// ---------------------------------------------------------------------------
// Tool Registration
// ---------------------------------------------------------------------------

function registerTools(server: McpServer): void {
  // =========================================================================
  // 1. HEALTH CHECK
  // =========================================================================

  (server as any).tool(
    'amber_health_check',
    'Check Amber backend health by hitting the Fastify health endpoint. ' +
      'Returns status, version, and uptime information.',
    {},
    async () => {
      try {
        const url = `${AMBER_API_URL}/health`;
        const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
        const data = await resp.json();
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              status: resp.ok ? 'healthy' : 'unhealthy',
              http_status: resp.status,
              url,
              response: data,
            }, null, 2),
          }],
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              status: 'unreachable',
              url: `${AMBER_API_URL}/health`,
              error: msg,
            }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );

  // =========================================================================
  // 2. QUERY CONTACTS (BigQuery natural language)
  // =========================================================================

  const contactsSqlGen = new SqlGenerator(
    process.env.ANTHROPIC_API_KEY || '',
    process.env.BIGQUERY_DATASET || 'togari_data_lake',
    process.env.BIGQUERY_TABLE || 'togari_structured_contacts_external',
    process.env.GCP_PROJECT_ID || 'midyear-glazing-485303-u3',
    `COLUMNS:
- linkedinUrl (STRING) — LinkedIn profile URL
- fullName (STRING) — Full name
- firstName (STRING) — First name
- lastName (STRING) — Last name
- workEmail (STRING) — Work email
- phone (STRING) — Phone number
- currentTitle (STRING) — Current job title
- currentCompany (STRING) — Current company
- companyDomain (STRING) — Company website domain
- createdAt (TIMESTAMP) — When record was created`
  );
  const contactsBqClient = new BigQueryClient(
    process.env.GCP_PROJECT_ID || 'midyear-glazing-485303-u3',
    undefined,
    process.env.GCP_CREDENTIALS_BASE64
  );

  (server as any).tool(
    'query_contacts',
    'Query the Togari contacts database using natural language. Searches across: name, email, phone, title, company, LinkedIn URL, domain. Examples: "Find all engineers at Google", "Show contacts added this week"',
    { natural_language_query: z.string().describe('A natural language question about your contacts.') },
    async ({ natural_language_query }: { natural_language_query: string }) => {
      const result = await handleQueryContacts({ natural_language_query }, contactsSqlGen, contactsBqClient);
      return { content: [{ type: 'text' as const, text: result }] };
    }
  );

  // =========================================================================
  // 3. QUERY DEALS (BigQuery natural language — optional)
  // =========================================================================

  const dealsTable = process.env.BIGQUERY_DEALS_TABLE;
  if (dealsTable) {
    const dealsSqlGen = new SqlGenerator(
      process.env.ANTHROPIC_API_KEY || '',
      process.env.BIGQUERY_DATASET || 'togari_data_lake',
      dealsTable,
      process.env.GCP_PROJECT_ID || 'midyear-glazing-485303-u3'
    );
    const dealsBqClient = new BigQueryClient(
      process.env.GCP_PROJECT_ID || 'midyear-glazing-485303-u3',
      undefined,
      process.env.GCP_CREDENTIALS_BASE64
    );

    (server as any).tool(
      'query_deals',
      'Query the Togari deals database using natural language. Examples: "Show all deals closed this month", "Find deals worth over 100k"',
      { natural_language_query: z.string().describe('A natural language question about your deals.') },
      async ({ natural_language_query }: { natural_language_query: string }) => {
        const result = await handleQueryContacts({ natural_language_query }, dealsSqlGen, dealsBqClient);
        return { content: [{ type: 'text' as const, text: result }] };
      }
    );
  }

  const toolCount = dealsTable ? 3 : 2;
  process.stderr.write(
    `Registered ${toolCount} tools: amber_health_check, query_contacts` +
    (dealsTable ? ', query_deals' : '') + '\n'
  );
}

// ---------------------------------------------------------------------------
// Server Creation
// ---------------------------------------------------------------------------

function createServer(): McpServer {
  const server = new McpServer({
    name: 'togari-amber',
    version: '1.0.0',
  });

  registerTools(server);

  return server;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const port = process.env.PORT;

  if (port) {
    // HTTP mode — Railway deployment
    const app = express();

    // CORS
    app.use((_req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, x-api-key, Content-Type, Mcp-Session-Id');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      next();
    });

    app.options('*', (_req, res) => {
      res.status(204).end();
    });

    // JSON body parsing
    app.use(express.json());

    // Health check
    app.get('/health', (_req, res) => {
      res.json({
        status: 'ok',
        service: 'togari-amber',
        version: '1.0.0',
        tools: process.env.BIGQUERY_DEALS_TABLE ? 3 : 2,
      });
    });

    // DNC enrichment routes (public, no auth)
    app.use('/api/dnc', dncRouter);

    // SSE transport
    const transports = new Map<string, SSEServerTransport>();

    app.get('/sse', async (_req, res) => {
      const transport = new SSEServerTransport('/messages', res);
      const sessionId = transport.sessionId;
      transports.set(sessionId, transport);

      res.on('close', () => {
        transports.delete(sessionId);
      });

      const server = createServer();
      await server.connect(transport);
    });

    app.post('/messages', async (req, res) => {
      const sessionId = req.query.sessionId as string;
      const transport = transports.get(sessionId);
      if (!transport) {
        res.status(400).json({ error: 'Unknown session' });
        return;
      }
      await transport.handlePostMessage(req, res);
    });

    // Initialize DNC BigQuery schema (non-blocking — never crashes server)
    try {
      await initDNCSchema();
    } catch (err) {
      process.stderr.write(`DNC schema init warning: ${err}\n`);
    }

    app.listen(Number(port), () => {
      process.stderr.write(
        `Togari Amber MCP Server listening on port ${port} (SSE mode)\n` +
        `Health: http://localhost:${port}/health\n`
      );
    });
  } else {
    // stdio mode — Claude Desktop
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}

main().catch((error) => {
  process.stderr.write(`Fatal error starting Togari Amber MCP Server: ${error}\n`);
  process.exit(1);
});
