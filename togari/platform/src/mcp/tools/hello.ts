/**
 * `togari_hello` — smoke-test tool for the Togari MCP server.
 *
 * Used by Tab 1 to prove the auth + transport + registry chain
 * is wired end-to-end. Returns the resolved tenant id, the auth
 * mode that the caller used (jwt | url-token | dev-anonymous),
 * and the server's wall-clock time so callers can confirm they
 * are hitting the live process and not a stale cache.
 */

import { z } from "zod";
import type { ToolModule } from "./registry";

const helloInput = {
  echo: z
    .string()
    .optional()
    .describe(
      "Optional string to echo back in the response — handy for asserting roundtrip behavior.",
    ),
};

export const togariHelloTool: ToolModule = {
  name: "togari_hello",
  description:
    "Smoke-test tool. Returns the live Togari MCP server version, the tenant id resolved from auth, and the current server time. Use this to verify a connector is correctly authenticated.",
  inputSchema: helloInput,
  handler: async (args, ctx) => {
    const parsed = z.object(helloInput).safeParse(args ?? {});
    const echo = parsed.success ? parsed.data.echo : undefined;
    const lines = [
      "Togari MCP is live.",
      `Tenant: ${ctx.tenantId}`,
      `User: ${ctx.userId}`,
      `Server time: ${new Date().toISOString()}`,
    ];
    if (echo) lines.push(`Echo: ${echo}`);
    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
};
