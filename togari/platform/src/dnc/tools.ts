/**
 * DNC MCP tools.
 *
 * Surfaces the do-not-contact list to MCP clients (Claude.ai connector,
 * ChatGPT, internal agents) for the active tenant:
 *
 *   - togari_dnc_check    — is an email/domain/contact suppressed?
 *   - togari_dnc_suppress — add an email/domain to the do-not-contact list
 *   - togari_dnc_list     — recent suppressions, newest first
 *
 * Each handler validates args with zod safeParse and returns a markdown text
 * block per the Togari MCP output convention. Errors bubble to
 * registerToolModule which surfaces them as isError results.
 *
 * Per policy, togari_dnc_suppress is UNCONFIRMED — it acts immediately with no
 * "reply yes" gate.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerToolModule, type ToolModule } from "../mcp/tools/registry";
import { BigQueryClient } from "../bigquery/client";
import { DncService } from "./service";
import type { DncMatch } from "./types";

interface DncToolDeps {
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

function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], isError };
}

function invalidArgs(message: string) {
  return textResult(`Invalid arguments: ${message}`, true);
}

function formatMatch(idx: number, m: DncMatch): string {
  const lines: string[] = [`${idx}. ${m.matchedOn}: ${m.value}`];
  if (m.reason) lines.push(`   Reason: ${m.reason}`);
  if (m.addedAt) lines.push(`   Added: ${m.addedAt}`);
  if (m.contactId) lines.push(`   Contact id: ${m.contactId}`);
  return lines.join("\n");
}

// ── togari_dnc_check ────────────────────────────────────────────────

const checkInput = {
  email: z.string().min(1).optional().describe("Contact email to check."),
  domain: z
    .string()
    .min(1)
    .optional()
    .describe("Company domain to check (e.g. 'acme.com')."),
  contact_id: z
    .string()
    .min(1)
    .optional()
    .describe("togari_dnc.contacts.id to check by exact row id."),
};
const CheckInput = z.object(checkInput);

export function buildDncCheckTool(deps: DncToolDeps = {}): ToolModule {
  return {
    name: "togari_dnc_check",
    description:
      "Check whether an email, domain, or contact id is on the do-not-contact list for the active tenant. Checking an email also checks its domain, so a domain-level suppression blocks its emails. Returns a markdown decision.",
    inputSchema: checkInput,
    handler: async (args, ctx) => {
      const parsed = CheckInput.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);
      const input = parsed.data;

      const svc = new DncService({ bq: deps.bq ?? defaultBq() });
      const decision = await svc.check(
        {
          email: input.email,
          domain: input.domain,
          contactId: input.contact_id,
        },
        { tenantId: ctx.tenantId },
      );

      const header = decision.suppressed
        ? `**DNC: SUPPRESSED** (tenant: ${ctx.tenantId})`
        : `**DNC: not suppressed** (tenant: ${ctx.tenantId})`;

      if (!decision.suppressed) {
        return textResult(
          `${header}\n\nNo do-not-contact match for the provided input. Sending is allowed.`,
        );
      }

      const body = decision.matches
        .map((m, i) => formatMatch(i + 1, m))
        .join("\n\n");
      return textResult(
        `${header}\n\n${decision.matches.length} match(es):\n\n${body}`,
      );
    },
  };
}

// ── togari_dnc_suppress ─────────────────────────────────────────────

const suppressInput = {
  email: z.string().min(1).optional().describe("Email to suppress."),
  domain: z
    .string()
    .min(1)
    .optional()
    .describe("Domain to suppress (blocks all its emails going forward)."),
  reason: z
    .string()
    .min(1)
    .describe("Why this is being suppressed (required, stored for audit)."),
  expires_at: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional ISO timestamp; encoded into the reason since there is no expiry column.",
    ),
};
const SuppressInput = z
  .object(suppressInput)
  .refine((v) => Boolean(v.email) || Boolean(v.domain), {
    message: "Provide at least one of: email, domain.",
  });

export function buildDncSuppressTool(deps: DncToolDeps = {}): ToolModule {
  return {
    name: "togari_dnc_suppress",
    description:
      "Add an email or domain to the do-not-contact list for the active tenant. Acts immediately (no confirmation). A reason is required. Provide email for a person-level block or domain for a company-wide block.",
    inputSchema: suppressInput,
    handler: async (args, ctx) => {
      const parsed = SuppressInput.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);
      const input = parsed.data;

      const svc = new DncService({ bq: deps.bq ?? defaultBq() });
      const result = await svc.suppress(
        {
          email: input.email,
          domain: input.domain,
          reason: input.reason,
          expiresAt: input.expires_at,
        },
        { tenantId: ctx.tenantId },
      );

      const target = input.email ?? input.domain ?? "(none)";
      if (!result.suppressed) {
        return textResult(
          `**DNC: nothing suppressed** (tenant: ${ctx.tenantId})\n\nNo email or domain was provided to suppress.`,
          true,
        );
      }

      return textResult(
        [
          `**DNC: suppressed** (tenant: ${ctx.tenantId})`,
          "",
          `- **target:** ${target}`,
          `- **reason:** ${input.reason}`,
          input.expires_at ? `- **expires:** ${input.expires_at}` : "",
          `- **id:** ${result.id}`,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    },
  };
}

// ── togari_dnc_remove ───────────────────────────────────────────────

const removeInput = {
  email: z.string().optional().describe("Email to un-suppress."),
  domain: z.string().optional().describe("Domain to un-suppress."),
};
const RemoveInput = z.object(removeInput);

export function buildDncRemoveTool(deps: DncToolDeps = {}): ToolModule {
  return {
    name: "togari_dnc_remove",
    description:
      "Remove an email or domain from the do-not-contact list (reversible counterpart to togari_dnc_suppress). Clears the suppression so outreach is allowed again.",
    inputSchema: removeInput,
    handler: async (args, ctx) => {
      const parsed = RemoveInput.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);
      const input = parsed.data;
      if (!input.email && !input.domain) {
        return invalidArgs("Provide an email or a domain to remove.");
      }

      const svc = new DncService({ bq: deps.bq ?? defaultBq() });
      const result = await svc.unsuppress(
        { email: input.email, domain: input.domain },
        { tenantId: ctx.tenantId },
      );

      const target = input.email ?? input.domain ?? "(none)";
      return textResult(
        result.removed > 0
          ? `**DNC: removed** (tenant: ${ctx.tenantId})\n\n- **target:** ${target}\n- **rows cleared:** ${result.removed}\n\nOutreach to ${target} is allowed again.`
          : `**DNC: nothing to remove** (tenant: ${ctx.tenantId})\n\n${target} was not on the do-not-contact list.`,
      );
    },
  };
}

// ── togari_dnc_list ─────────────────────────────────────────────────

const listInput = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe("Max suppressions to return (1-500, default 50)."),
};
const ListInput = z.object(listInput);

export function buildDncListTool(deps: DncToolDeps = {}): ToolModule {
  return {
    name: "togari_dnc_list",
    description:
      "List recent do-not-contact suppressions for the active tenant, newest first. Returns a markdown list.",
    inputSchema: listInput,
    handler: async (args, ctx) => {
      const parsed = ListInput.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);
      const limit = parsed.data.limit ?? 50;

      const svc = new DncService({ bq: deps.bq ?? defaultBq() });
      const rows = await svc.list({ tenantId: ctx.tenantId, limit });

      const header = `**DNC suppressions** (tenant: ${ctx.tenantId})`;
      if (rows.length === 0) {
        return textResult(`${header}\n\n_No suppressions found._`);
      }
      const body = rows.map((m, i) => formatMatch(i + 1, m)).join("\n\n");
      return textResult(
        `${header}\n\nReturned ${rows.length} (up to ${limit}):\n\n${body}`,
      );
    },
  };
}

// ── Registration ────────────────────────────────────────────────────

export function registerDncTools(server: McpServer): void {
  registerToolModule(server, buildDncCheckTool());
  registerToolModule(server, buildDncSuppressTool());
  registerToolModule(server, buildDncRemoveTool());
  registerToolModule(server, buildDncListTool());
}

/** Alias matching the orchestrator's `import * as dncTools; dncTools.register(server)` pattern. */
export const register = registerDncTools;
