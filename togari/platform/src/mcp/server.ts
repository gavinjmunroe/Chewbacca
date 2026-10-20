/**
 * `src/mcp` — Togari MCP authoring surface.
 *
 * This file is the public entry point that other tabs import from.
 * It re-exports the registry helper, the shared tool-module shape,
 * and the bundled "core" tools that every Togari MCP server should
 * register regardless of which transport (Streamable HTTP / SSE) is
 * wiring them up.
 *
 * The actual Express transport lives in `src/transports/mcp/server.ts`
 * (`setupMcpRoutes(app)`); this file does not own routing. It only
 * owns the per-server tool registration.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerToolModule, type ToolModule } from "./tools/registry";
import { togariHelloTool } from "./tools/hello";

export { registerToolModule } from "./tools/registry";
export type {
  ToolModule,
  ToolCallContext,
  ToolCallResult,
} from "./tools/registry";
export { togariHelloTool } from "./tools/hello";
export { mcpAuth } from "./auth";
export type { McpAuthInfo, McpAuthKind } from "./auth";

/**
 * Tools owned by this module that get registered on every Togari MCP
 * server instance. Tabs 3, 4, and 5 will append their own modules by
 * calling `registerToolModule(server, theirModule)` from their own
 * route-setup code; they do not need to modify this list.
 */
export const TOGARI_CORE_TOOLS: ToolModule[] = [togariHelloTool];

/**
 * Registers all `TOGARI_CORE_TOOLS` on the given `McpServer`. Called
 * once per session by the transport layer (`createMcpServer()` in
 * `src/transports/mcp/server.ts`).
 */
export function registerCoreTogariTools(server: McpServer): void {
  for (const mod of TOGARI_CORE_TOOLS) {
    registerToolModule(server, mod);
  }
}
