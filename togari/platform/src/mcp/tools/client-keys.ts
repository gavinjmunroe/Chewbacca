/**
 * Admin MCP tools for per-client portal API keys.
 *
 * Let an admin mint or revoke a client's portal key straight from Claude (or
 * any MCP client). Keys are scoped to a client_id and stored only as SHA-256
 * hashes; the raw key is surfaced ONCE at issue time and is unrecoverable
 * afterwards, so the issue tool warns loudly to copy it now.
 *
 * These are admin operations: they target an arbitrary client_id and are not
 * gated by the caller's tenant. Mount them behind the internal/admin MCP surface.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BigQueryClient } from "../../bigquery/client";
import { createLogger } from "../../observability/logger";
import { registerToolModule, type ToolModule } from "./registry";
import { issueClientKey, revokeClientKey } from "../../auth/client-keys";

const logger = createLogger("mcp/client-keys");

export interface ClientKeyDeps {
  bq?: BigQueryClient;
}

function defaultBq(): BigQueryClient {
  return new BigQueryClient(
    process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3",
    null,
    process.env.GCP_CREDENTIALS_BASE64 ||
      process.env.GOOGLE_CREDENTIALS_BASE64 ||
      null,
  );
}

function bqOf(deps: ClientKeyDeps): BigQueryClient {
  return deps.bq ?? defaultBq();
}

function textResult(text: string, isError = false) {
  return {
    content: [{ type: "text" as const, text }],
    ...(isError ? { isError: true } : {}),
  };
}

function invalidArgs(message: string) {
  return textResult(`Invalid arguments: ${message}`, true);
}

// ── togari_client_key_issue ─────────────────────────────────────────

const issueShape = {
  client_id: z
    .string()
    .min(1)
    .describe("Client/tenant id the new portal key will be scoped to."),
  label: z
    .string()
    .optional()
    .describe("Optional human label, e.g. 'Serif portal - Arham'."),
};
const IssueInput = z.object(issueShape);

export function buildIssueClientKeyTool(deps: ClientKeyDeps = {}): ToolModule {
  return {
    name: "togari_client_key_issue",
    description:
      "Issue a new per-client portal API key scoped to a client_id. Returns the raw key ONCE (it is stored only as a hash and cannot be recovered later). Admin-only.",
    inputSchema: issueShape,
    handler: async (args) => {
      const parsed = IssueInput.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);

      const { keyId, rawKey } = await issueClientKey(bqOf(deps), {
        clientId: parsed.data.client_id,
        label: parsed.data.label,
      });

      logger.info("client_key.issue", {
        keyId,
        clientId: parsed.data.client_id,
      });

      const text = [
        `Issued a portal key for client "${parsed.data.client_id}".`,
        "",
        `key_id: ${keyId}`,
        `key: ${rawKey}`,
        "",
        "WARNING: this raw key is shown only once and cannot be recovered. Copy it now and hand it to the client. Only the SHA-256 hash is stored.",
      ].join("\n");
      return textResult(text);
    },
  };
}

// ── togari_client_key_revoke ────────────────────────────────────────

const revokeShape = {
  key_id: z
    .string()
    .min(1)
    .describe("The key_id returned when the key was issued."),
};
const RevokeInput = z.object(revokeShape);

export function buildRevokeClientKeyTool(deps: ClientKeyDeps = {}): ToolModule {
  return {
    name: "togari_client_key_revoke",
    description:
      "Revoke a per-client portal API key by key_id. Flips it inactive; the row is preserved for audit. Admin-only.",
    inputSchema: revokeShape,
    handler: async (args) => {
      const parsed = RevokeInput.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);

      await revokeClientKey(bqOf(deps), parsed.data.key_id);
      logger.info("client_key.revoke", { keyId: parsed.data.key_id });

      return textResult(`Revoked portal key ${parsed.data.key_id}.`);
    },
  };
}

// ── Registration ────────────────────────────────────────────────────

export function buildClientKeyTools(deps: ClientKeyDeps = {}): ToolModule[] {
  return [buildIssueClientKeyTool(deps), buildRevokeClientKeyTool(deps)];
}

/** Register the admin client-key MCP tools on an `McpServer`. */
export function registerClientKeyTools(
  server: McpServer,
  deps: ClientKeyDeps = {},
): void {
  for (const mod of buildClientKeyTools(deps)) {
    registerToolModule(server, mod);
  }
}

/** Alias matching the orchestrator's `import * as; .register(server)` pattern. */
export const register = registerClientKeyTools;
