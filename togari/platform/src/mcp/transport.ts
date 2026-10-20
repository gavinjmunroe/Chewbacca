/**
 * Transport facade for the Togari MCP server.
 *
 * The repo's Express + Streamable HTTP + SSE transport lives in
 * `src/transports/mcp/server.ts` (existing Karthik scaffold). This
 * file re-exports the public mount function under the path the rest
 * of the codebase reaches for, so callers can write:
 *
 *   import { setupMcpRoutes } from './mcp/transport';
 *
 * instead of crossing the `transports/` boundary directly. Useful for
 * the cross-tab plan because Tabs 4 and 5 need an unambiguous import
 * path for the mount function.
 */

export { setupMcpRoutes } from "../transports/mcp/server";
