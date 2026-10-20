/**
 * @togari/mcp — MCP Server with Streamable HTTP + SSE Transport
 *
 * Exposes the Togari core intelligence layer via MCP.
 * - POST/GET/DELETE /mcp  — Streamable HTTP (modern, what Claude.ai uses)
 * - GET /mcp/sse           — Legacy SSE transport (fallback)
 * - POST /mcp/messages     — Legacy SSE message relay
 * - GET /mcp/info          — Server metadata
 *
 * Each connection gets its own McpServer instance (McpServer binds 1:1 to a transport).
 * Tool handlers call shared core functions — no business logic duplication.
 */

import crypto from "crypto";
import express from "express";
import type { Application, Request, Response, NextFunction } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { TOGARI_TOOLS } from "./tools";
import { handleToolCall } from "./handlers";
import { mcpAuth } from "../../mcp/auth";
import { authEnabled } from "../../auth/token";
import { registerCoreTogariTools } from "../../mcp/server";
import { registerExaTools } from "../../mcp/tools/exa";
import { registerZoominfoTools } from "../../mcp/tools/zoominfo";
import { registerClayOutboundTools } from "../../mcp/tools/clay-outbound";
import { registerDncTools } from "../../dnc/tools";
import { registerPipelineTools } from "../../mcp/tools/pipeline";
import { registerSchemaTools } from "../../mcp/tools/schema";
import { registerIngestTools } from "../../mcp/tools/ingest";
import { registerProvisionTools } from "../../mcp/tools/provision";
import { registerEnrichTools } from "../../mcp/tools/enrich";
import { registerAutoIngestTools } from "../../mcp/tools/auto-ingest";
import { registerClientKeyTools } from "../../mcp/tools/client-keys";
import { registerCalendarTools } from "../../mcp/tools/calendar";
import { registerFetchTools } from "../../mcp/tools/fetch-sources";
import { registerV1Tools } from "../../mcp/tools/v1";
// DISABLED 2026-05-12: tools query togari_core which does not exist.
// import { registerMandateTools } from "../../mcp/tools/mandates";
// DISABLED 2026-05-12: tools query togari_core which does not exist.
// import { registerTieringTools } from "../../mcp/tools/tiering";
// DISABLED 2026-05-12: tools query togari_core which does not exist.
// import { registerEnrichmentTools } from "../../mcp/tools/enrichment";
// DISABLED 2026-05-12: tools query togari_core which does not exist.
// import { register as registerCompaniesTools } from "../../mcp/tools/companies";
// DISABLED 2026-05-12: tools query togari_core which does not exist.
// import { register as registerContactsTools } from "../../mcp/tools/contacts";
// DISABLED 2026-05-12: tools query togari_core which does not exist.
// import { register as registerDatapointsTools } from "../../mcp/tools/datapoints";
// DISABLED 2026-05-12: tools query togari_core which does not exist.
// import { register as registerClayTools } from "../../mcp/tools/clay";
// DISABLED 2026-05-12: tools query togari_core which does not exist.
// import { register as registerCostsTools } from "../../mcp/tools/costs";
// DISABLED 2026-05-12: tools query togari_core which does not exist.
// import { register as registerAdminTools } from "../../mcp/tools/admin";

// ── Tool registration ────────────────────────────────────────────

/**
 * Registers all Togari tools on the given McpServer instance.
 *
 * Two registration paths run side by side:
 *   1. Legacy TOGARI_TOOLS + handleToolCall switch — existing
 *      deal-ops, calendar, meeting-intel, email tools.
 *   2. ToolModule registry (src/mcp/tools/registry.ts) — Tabs 3, 4, 5
 *      register their tools via registerToolModule; togari_hello
 *      (smoke test) also lives here.
 *
 * Cast inputSchema to any because the MCP SDK expects Zod v4-compatible
 * schemas but the project is on Zod v3.
 */
function registerTools(server: McpServer): void {
  // ORDER MATTERS. Some MCP clients (e.g. Perplexity) only surface the first
  // ~20-25 tools from a connector, so the highest-value NEW product tools are
  // registered FIRST, the core CRM tools next, and the least demo-critical
  // integrations (Exa/ZoomInfo enrichment) LAST so they are the ones cut if
  // the client caps the list.

  // 0) Togari V1 source-of-truth surface — the client-centric core Sagar talks
  //    to (CSV ingest, ask-anything, clients, tasks, context, pull). Registered
  //    FIRST so it always survives a client's tool-list cap.
  registerV1Tools(server);

  // 1) Kept alongside V1 because the phases build on them:
  //    - schema tools  -> Phase 3 (define fields/records by talking)
  //    - Clay outbound  -> Phase 5 (Togari <-> Clay both ways)
  //    - enrich         -> enrich a client record on demand
  registerSchemaTools(server);
  registerClayOutboundTools(server);
  registerEnrichTools(server);

  // 2) Legacy deal-centric surface (pipeline/DNC/provision/
  //    auto-ingest/fetch/calendar/client-keys + the old TOGARI_TOOLS deal ops).
  //    These write to the pre-V1 tables (now empty) and would only confuse
  //    Sagar, so they are OFF by default. Flip TOGARI_LEGACY_TOOLS_ENABLED=true
  //    to bring them back without a code change.
  if (process.env.TOGARI_LEGACY_TOOLS_ENABLED === "true") {
    registerDncTools(server);
    registerIngestTools(server);
    registerAutoIngestTools(server);
    registerFetchTools(server);
    registerCalendarTools(server);
    registerProvisionTools(server);
    registerPipelineTools(server);
    registerClientKeyTools(server);
    for (const tool of TOGARI_TOOLS) {
      server.tool(
        tool.name,
        tool.description,
        tool.inputSchema as any,
        async (args: Record<string, unknown>) => {
          return await handleToolCall(tool.name, args as Record<string, any>);
        },
      );
    }
    registerCoreTogariTools(server);
  }

  // 3) Enrichment integrations LAST (most expendable under a client tool cap).
  registerExaTools(server);
  registerZoominfoTools(server);
  // Phase 2 Tab 8: run management
  // DISABLED 2026-05-12: see import comment.
  // registerMandateTools(server);
  // DISABLED 2026-05-12: see import comment.
  // registerTieringTools(server);
  // DISABLED 2026-05-12: see import comment.
  // registerEnrichmentTools(server);
  // Phase 2 Tab 9: read-only data + observability + cost + admin
  // DISABLED 2026-05-12: see import comment.
  // registerCompaniesTools(server);

  const allTools = (server as any)._tools ?? {};
  const names = Object.keys(allTools);
  console.log(`[MCP] Registered ${names.length} tools`);
  names.forEach((name, i) => {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
      console.error(`[MCP] ❌ BAD TOOL [${i}]: "${name}"`);
    }
  });
  // DISABLED 2026-05-12: see import comment.
  // registerContactsTools(server);
  // DISABLED 2026-05-12: see import comment.
  // registerDatapointsTools(server);
  // DISABLED 2026-05-12: see import comment.
  // registerClayTools(server);
  // DISABLED 2026-05-12: see import comment.
  // registerCostsTools(server);
  // DISABLED 2026-05-12: see import comment.
  // registerAdminTools(server);

  // Claude.ai rejects the whole tools/list response if any tool name fails
  // ^[a-zA-Z0-9_-]{1,64}$ — fail fast at boot instead of at first connect.
  const TOOL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
  const registered = (server as any)._registeredTools ?? {};
  for (const name of Object.keys(registered)) {
    if (!TOOL_NAME_RE.test(name)) {
      throw new Error(
        `[MCP] Invalid tool name: "${name}" — must match ^[a-zA-Z0-9_-]{1,64}$`,
      );
    }
  }
}

// ── Per-connection server factory ────────────────────────────────

function createMcpServer(): McpServer {
  const server = new McpServer({ name: "togari", version: "1.0.0" });
  registerTools(server);
  return server;
}

// ── CORS middleware for /mcp* routes ─────────────────────────────

function mcpCors(req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, mcp-session-id, MCP-Session-Id",
  );
  res.setHeader(
    "Access-Control-Expose-Headers",
    "mcp-session-id, MCP-Session-Id",
  );
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
}

// ── Express route setup ──────────────────────────────────────────

export function setupMcpRoutes(app: Application): void {
  // ── CORS for all /mcp* routes ──────────────────────────────────
  app.use("/mcp", mcpCors);

  // ── Dual auth for all /mcp* routes (except /mcp/info, kept public)
  // Bearer JWT (Auth0) OR ?token=<value> URL param for Claude.ai /
  // ChatGPT connector compatibility. See src/mcp/auth.ts.
  app.use("/mcp", (req, res, next) => {
    if (req.path === "/info") return next();
    return mcpAuth(req, res, next);
  });

  // ================================================================
  // A) STREAMABLE HTTP TRANSPORT (modern — POST/GET/DELETE /mcp)
  // ================================================================

  // Track Streamable HTTP sessions: sessionId -> { transport, server }
  const streamableSessions = new Map<
    string,
    { transport: StreamableHTTPServerTransport; server: McpServer }
  >();

  // Session activity tracking + idle eviction.
  //
  // Sessions live in process memory, so they vanish on every redeploy /
  // restart. The POST /mcp handler below auto-recovers from unknown
  // session IDs by rebuilding a transport bound to the client's ID.
  // That auto-recovery means an adversary (or a buggy client) could
  // spam unique IDs and grow the map unbounded — hence the TTL.
  const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
  const sessionLastActivity = new Map<string, number>();

  const sessionCleanupTimer = setInterval(
    () => {
      const now = Date.now();
      for (const [sid, lastActive] of sessionLastActivity) {
        if (now - lastActive > SESSION_TTL_MS) {
          const entry = streamableSessions.get(sid);
          if (entry?.transport) {
            try {
              entry.transport.close?.();
            } catch {
              /* ignore — best-effort cleanup */
            }
          }
          streamableSessions.delete(sid);
          sessionLastActivity.delete(sid);
          console.log(`[mcp/streamable] Evicted idle session ${sid}`);
        }
      }
    },
    10 * 60 * 1000,
  );
  sessionCleanupTimer.unref?.();

  // Boot-time SDK-internals assertion.
  //
  // Auto-recovery in POST /mcp reaches into the SDK's private
  // `_webStandardTransport._initialized` flag (no public API to mark
  // a transport as already-initialised). If a future SDK release
  // renames that field, silent breakage would only surface as a 400
  // on the first post-restart request from a real client. Probe the
  // shape once at boot so an incompatible SDK fails loudly at deploy.
  {
    const probe = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => "boot-probe",
    });
    const internals = (
      probe as unknown as {
        _webStandardTransport?: { _initialized?: unknown; sessionId?: unknown };
      }
    )._webStandardTransport;
    if (!internals || typeof internals._initialized !== "boolean") {
      throw new Error(
        "[MCP] @modelcontextprotocol/sdk has changed: `_webStandardTransport._initialized` is missing or not a boolean. Session auto-recovery relies on this internal — review POST /mcp before upgrading.",
      );
    }
    void probe.close?.();
  }

  // POST /mcp — main message endpoint (initialization + ongoing messages)
  app.post("/mcp", express.json(), async (req: Request, res: Response) => {
    const sessionId = (req.headers["mcp-session-id"] as string) || "";
    console.log(
      `[mcp/streamable] POST /mcp — session: ${sessionId || "(new)"}, jsonrpc method: ${req.body?.method || req.body?.[0]?.method || "batch"}`,
    );

    // 1. Known session — route to its transport.
    const existing = streamableSessions.get(sessionId);
    if (existing) {
      sessionLastActivity.set(sessionId, Date.now());
      console.log(`[mcp/streamable] Routing to existing session ${sessionId}`);
      await existing.transport.handleRequest(req, res, req.body);
      return;
    }

    // 2. Unknown session ID provided — auto-recover. The server has
    //    almost certainly restarted; the client still holds a valid
    //    ID from the prior process. Rebuild a transport bound to
    //    that exact ID and mark it as already-initialised so the
    //    incoming tools/call (or whatever) doesn't get rejected by
    //    the SDK's "Server not initialized" gate.
    if (sessionId) {
      console.log(
        `[mcp/streamable] Auto-recovering unknown session ${sessionId}`,
      );
      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => sessionId,
        // No onsessioninitialized — the SDK won't fire it (we're skipping
        // its init handshake); we register the session in the map below.
      });

      // Poke the SDK internals validated by the boot-time probe above.
      const internals = (
        transport as unknown as {
          _webStandardTransport: { _initialized: boolean; sessionId?: string };
        }
      )._webStandardTransport;
      internals._initialized = true;
      internals.sessionId = sessionId;

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) {
          console.log(
            `[mcp/streamable] Transport closed, cleaning up session: ${sid}`,
          );
          streamableSessions.delete(sid);
          sessionLastActivity.delete(sid);
        }
      };

      await server.connect(transport);
      streamableSessions.set(sessionId, { transport, server });
      sessionLastActivity.set(sessionId, Date.now());
      await transport.handleRequest(req, res, req.body);
      return;
    }

    // 3. No session ID at all — treat as a fresh initialize request.
    console.log("[mcp/streamable] Creating new session");
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (newSessionId: string) => {
        console.log(`[mcp/streamable] Session initialized: ${newSessionId}`);
        streamableSessions.set(newSessionId, { transport, server });
        sessionLastActivity.set(newSessionId, Date.now());
      },
    });

    // Clean up when transport closes
    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid) {
        console.log(
          `[mcp/streamable] Transport closed, cleaning up session: ${sid}`,
        );
        streamableSessions.delete(sid);
        sessionLastActivity.delete(sid);
      }
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // GET /mcp — SSE notification stream for Streamable HTTP
  app.get("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string;
    console.log(
      `[mcp/streamable] GET /mcp (SSE stream) — session: ${sessionId || "(none)"}`,
    );

    const existing = streamableSessions.get(sessionId);
    if (!existing) {
      console.log(
        `[mcp/streamable] GET /mcp — session not found: ${sessionId}`,
      );
      res.status(404).json({ error: "Session not found" });
      return;
    }

    sessionLastActivity.set(sessionId, Date.now());
    await existing.transport.handleRequest(req, res);
  });

  // DELETE /mcp — session cleanup
  app.delete("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string;
    console.log(
      `[mcp/streamable] DELETE /mcp — session: ${sessionId || "(none)"}`,
    );

    const existing = streamableSessions.get(sessionId);
    if (!existing) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    await existing.transport.handleRequest(req, res);
    await existing.server.close();
    streamableSessions.delete(sessionId);
    sessionLastActivity.delete(sessionId);
    console.log(`[mcp/streamable] Session deleted: ${sessionId}`);
  });

  // ================================================================
  // B) LEGACY SSE TRANSPORT (GET /mcp/sse + POST /mcp/messages)
  // ================================================================

  // Track SSE sessions: sessionId -> { transport, server }
  const sseSessions = new Map<
    string,
    { transport: SSEServerTransport; server: McpServer }
  >();

  // GET /mcp/sse — SSE connection endpoint
  app.get("/mcp/sse", (req: Request, res: Response) => {
    console.log("[mcp/sse] Client connecting via SSE");

    const server = createMcpServer();
    const transport = new SSEServerTransport("/mcp/messages", res);
    const sessionId = transport.sessionId;
    sseSessions.set(sessionId, { transport, server });

    console.log(
      `[mcp/sse] Client connected (session: ${sessionId}) — told client to POST to /mcp/messages?sessionId=${sessionId}`,
    );

    res.on("close", () => {
      console.log(`[mcp/sse] Client disconnected (session: ${sessionId})`);
      sseSessions.delete(sessionId);
      server.close().catch(() => {});
    });

    server.connect(transport).catch((err) => {
      console.error(
        `[mcp/sse] Failed to connect transport for session ${sessionId}:`,
        err,
      );
      sseSessions.delete(sessionId);
    });
  });

  // POST /mcp/messages — legacy SSE message relay
  app.post("/mcp/messages", express.json(), (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;
    console.log(
      `[mcp/sse] POST /mcp/messages received — sessionId: ${sessionId}, bodyKeys: ${Object.keys(req.body || {}).join(",")}`,
    );

    const session = sseSessions.get(sessionId);
    if (!session) {
      console.log(
        `[mcp/sse] POST /mcp/messages — session not found: ${sessionId}`,
      );
      res.status(404).json({ error: "Session not found" });
      return;
    }

    session.transport.handlePostMessage(req, res, req.body).catch((err) => {
      console.error(
        `[mcp/sse] Error handling message for session ${sessionId}:`,
        err,
      );
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal error" });
      }
    });
  });

  // ================================================================
  // C) INFO ENDPOINT
  // ================================================================

  app.get("/mcp/info", (_req: Request, res: Response) => {
    res.json({
      name: "togari",
      version: "1.0.0",
      tools: TOGARI_TOOLS.length,
      transports: {
        streamable_http: {
          endpoint: "/mcp",
          methods: ["POST", "GET", "DELETE"],
        },
        sse_legacy: {
          sse_endpoint: "/mcp/sse",
          message_endpoint: "/mcp/messages",
        },
      },
      active_sessions: {
        streamable: streamableSessions.size,
        sse: sseSessions.size,
      },
    });
  });

  console.log("[mcp] Routes registered:");
  console.log("[mcp]   Streamable HTTP: POST|GET|DELETE /mcp");
  console.log("[mcp]   Legacy SSE:      GET /mcp/sse, POST /mcp/messages");
  console.log("[mcp]   Info:            GET /mcp/info");

  // One-time auth-mode banner. The per-request dev-anonymous WARN used
  // to fire on every call from mcpAuth; that's been removed in favor
  // of this single boot line.
  if (authEnabled()) {
    console.log("[mcp/auth] Token auth enabled (MCP_JWT_SECRET set)");
  } else if (process.env.MCP_BEARER_TOKEN || process.env.AUTH0_DOMAIN) {
    console.log(
      "[mcp/auth] Legacy auth enabled (MCP_BEARER_TOKEN / AUTH0_DOMAIN set)",
    );
  } else {
    console.warn(
      "[mcp/auth] AUTH DISABLED (MCP_JWT_SECRET unset) — all requests run as dev-anonymous BMA admin",
    );
  }
}
