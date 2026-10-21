/**
 * MCP server for medha-id. Exposes a small set of identity/memory tools that
 * any MCP client (Claude Code, Cursor, third-party agents) can call.
 *
 * This module just builds McpServer instances. The HTTP transport lives in
 * ./index.js (mounted on the Fastify app). The stdio transport is available
 * via runStdio() for clients that prefer to spawn medha-id as a subprocess.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { ownerBoundHandler } from "./owner-boundary.js";

import * as getDashboardUrl from "./tools/get-dashboard-url.js";
import * as peopleRank from "./tools/people-rank.js";
import * as searchPlans from "./tools/search-plans.js";
import * as searchPeople from "./tools/search-people.js";
import * as upsertContact from "./tools/upsert-contact.js";
import * as bulkUpsertContacts from "./tools/bulk-upsert-contacts.js";
import * as getContact from "./tools/get-contact.js";
import * as addContactNote from "./tools/add-contact-note.js";

const TOOLS = [
  getDashboardUrl,
  // Amber MCP v1 (2026-06-04): people-rank + CRM core for Perplexity/Clay/iOS.
  peopleRank,
  searchPeople,
  searchPlans,
  upsertContact,
  // Amber MCP v1.2 (2026-09-25): the rest of the rolodex, so an agent in
  // iMessage, WhatsApp, Clay or a voice prompt can put people in at volume,
  // read a card back out, and write down what it just heard -- without any of
  // them being a second way to write a contact.
  bulkUpsertContacts,
  getContact,
  addContactNote,
];

const SERVER_INFO = {
  name: "amber",
  version: "1.2.0",
};

/**
 * Build a fresh McpServer with all tools registered. The streamable-http
 * transport runs in stateless mode and calls this once per request, so each
 * tool invocation gets a clean server instance.
 */
export function createMcpServer({ ownerDid = null } = {}) {
  const server = new McpServer(SERVER_INFO);
  for (const tool of TOOLS) {
    const handler = ownerBoundHandler(tool, ownerDid);
    if (!handler) continue;
    server.registerTool(tool.name, tool.config, handler);
  }
  return server;
}

/**
 * Attach a stdio transport and start the server. Use this from a small
 * entry script (e.g. `node -e "import('./src/mcp/server.js').then(m =>
 * m.runStdio())"`) when an MCP client wants to spawn medha-id directly.
 */
export async function runStdio() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
