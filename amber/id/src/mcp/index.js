/**
 * Fastify mount point for the medha-id MCP server. Exposes POST/GET/DELETE
 * /mcp behind the existing API-key auth, accepted in either
 * `Authorization: Bearer <key>` or `x-api-key: <key>` -- most MCP clients can
 * only send the former. Runs in stateless mode: each
 * request gets a fresh server + transport, so there's no in-memory session
 * map to manage across requests.
 *
 * The mount is opt-out: set MCP_HTTP_ENABLED=false to disable the route
 * without removing the registration line. When disabled, the route is not
 * registered at all (no /mcp endpoint).
 */

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { requireMcpKey } from "../lib/auth.js";
import { createMcpServer } from "./server.js";

function httpEnabled() {
  const v = process.env.MCP_HTTP_ENABLED;
  if (v === undefined || v === null || v === "") return true;
  return !/^(false|0|no|off)$/i.test(String(v).trim());
}

export function registerMcp(app) {
  if (!httpEnabled()) {
    app.log?.info(
      "[mcp] MCP_HTTP_ENABLED=false; skipping /mcp route registration",
    );
    return;
  }

  const handler = async (request, reply) => {
    // requireMcpKey (preHandler) stamped request.ownerDid from the API key.
    // Pass it so identity/CRM tools can default the `did` arg to the
    // key-holder, letting non-technical clients call without knowing a DID.
    const server = createMcpServer({ ownerDid: request.ownerDid || null });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    reply.hijack();
    request.raw.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch (err) {
      request.log.error({ err }, "[mcp] handleRequest failed");
      if (!reply.raw.headersSent) {
        reply.raw.statusCode = 500;
        reply.raw.setHeader("content-type", "application/json");
        reply.raw.end(JSON.stringify({ error: "mcp_internal_error" }));
      } else {
        reply.raw.end();
      }
    }
  };

  app.post("/mcp", { preHandler: [requireMcpKey] }, handler);
  app.get("/mcp", { preHandler: [requireMcpKey] }, handler);
  app.delete("/mcp", { preHandler: [requireMcpKey] }, handler);
}
