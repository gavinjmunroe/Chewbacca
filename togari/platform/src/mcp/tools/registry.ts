/**
 * Tool registry for the Togari MCP server.
 *
 * Downstream tabs (worker harness, integrations) build a
 * `ToolModule` and hand it to `registerToolModule(server, module)`.
 * The registry binds the module's handler into the McpServer so the
 * tool shows up in `tools/list` and is callable via `tools/call`.
 *
 * Why this exists when McpServer already has `server.tool(...)`:
 *   - Forces a single content-shape contract on every Togari tool.
 *   - Threads tenant context (from `tenantStorage` AsyncLocalStorage)
 *     into every handler call so handlers don't re-read auth state.
 *   - Lets us cross-cut logging, cost-tracking, and error formatting
 *     in one place when later tabs need it.
 *
 * Usage from another tab:
 *
 *   import { registerToolModule, type ToolModule } from '../mcp/tools/registry';
 *   import { z } from 'zod';
 *
 *   export const myTool: ToolModule = {
 *     name: 'togari_exa_search',
 *     description: 'Search the web via Exa for the current tenant.',
 *     inputSchema: { entityName: z.string().optional() },
 *     handler: async (args, ctx) => ({
 *       content: [{ type: 'text', text: `Listing for tenant ${ctx.tenantId}` }],
 *     }),
 *   };
 *
 * Then in the route setup file: `registerToolModule(server, myTool)`.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getCurrentTenant } from "../../tenant/context";
import { createLogger } from "../../observability/logger";

const logger = createLogger("mcp/registry");

export interface ToolCallContext {
  tenantId: string;
  userId: string;
}

export interface ToolCallResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface ToolModule {
  /**
   * Tool name surfaced to MCP clients. Convention: `togari_<area>_<verb>`.
   * Must match `^[a-zA-Z0-9_-]{1,64}$` — Claude.ai rejects the whole tool
   * list if any name contains dots, spaces, colons, slashes, etc.
   */
  name: string;
  /** Human-readable description shown to model clients in `tools/list`. */
  description: string;
  /**
   * Zod-shaped input schema. The MCP SDK expects a Zod v4 raw shape;
   * because this repo is on Zod v3 the SDK accepts the shape cast to
   * `any` at registration time (matches existing TOGARI_TOOLS pattern).
   */
  inputSchema: Record<string, unknown>;
  /**
   * Tool body. `args` is the parsed input. `ctx` is the auth context
   * resolved by `mcpAuth` middleware — never null when invoked through
   * the registered MCP route.
   */
  handler: (args: unknown, ctx: ToolCallContext) => Promise<ToolCallResult>;
}

/**
 * Registers a `ToolModule` on an `McpServer` instance.
 *
 * The handler is wrapped so that:
 *   - Tenant context is pulled from AsyncLocalStorage at call time.
 *   - Thrown errors are converted to MCP `isError: true` results
 *     instead of bubbling out and killing the transport.
 *   - Each invocation gets a structured log line for tracing.
 */
export function registerToolModule(server: McpServer, mod: ToolModule): void {
  // SDK overloads expect Zod v4 shapes + a callback whose return matches
  // its internal CallToolResult shape (with an index signature). The
  // project is on Zod v3 and we use a strict ToolCallResult interface,
  // so both inputs are cast to any — same pattern the legacy
  // TOGARI_TOOLS registration uses in src/transports/mcp/server.ts.
  server.tool(
    mod.name,
    mod.description,
    mod.inputSchema as any,
    (async (args: Record<string, unknown>): Promise<ToolCallResult> => {
      let ctx: ToolCallContext;
      try {
        const tenant = getCurrentTenant();
        ctx = { tenantId: tenant.tenantId, userId: tenant.userId ?? "unknown" };
      } catch {
        return {
          content: [
            {
              type: "text",
              text: `Error: tool '${mod.name}' invoked without tenant context. Did the request pass through mcpAuth middleware?`,
            },
          ],
          isError: true,
        };
      }

      logger.info("tool.call", {
        name: mod.name,
        tenantId: ctx.tenantId,
        userId: ctx.userId,
      });
      try {
        return await mod.handler(args, ctx);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(
          "tool.error",
          err instanceof Error ? err : new Error(message),
        );
        return {
          content: [{ type: "text", text: `Error in ${mod.name}: ${message}` }],
          isError: true,
        };
      }
    }) as any,
  );
}
