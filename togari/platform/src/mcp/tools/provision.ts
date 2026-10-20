/**
 * Provisioning MCP tools for Togari.
 *
 * The "instantly set up a client's data architecture from a sentence" feature.
 * Describe a client in natural language and Togari plans (and optionally
 * builds) their warehouse structure: pipelines, ordered stages, and custom
 * data-point fields.
 *
 * Tools registered:
 *   - togari_provision_preview — plan only, returns the proposed structure as
 *     markdown WITHOUT writing anything.
 *   - togari_provision_client  — plan and persist, returns what was created.
 *
 * Both are scoped to the caller's tenant via `client_id` (canonical tenancy
 * key, default "bma"), overridable with the `client_id` argument. Writes go
 * through ProvisionService (pipeline_stages inserts + SchemaRegistry defs);
 * no DDL is ever emitted.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BigQueryClient } from "../../bigquery/client";
import { createLogger } from "../../observability/logger";
import {
  registerToolModule,
  type ToolModule,
  type ToolCallContext,
} from "./registry";
import { ProvisionService } from "../../provision/service";
import type { ProvisionPlan, ProvisionResult } from "../../provision/types";

const logger = createLogger("mcp/provision");

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";
const DEFAULT_CLIENT_ID = "bma";

export interface ProvisionToolDeps {
  bq?: BigQueryClient;
}

function defaultBq(): BigQueryClient {
  return new BigQueryClient(
    PROJECT_ID,
    null,
    process.env.GCP_CREDENTIALS_BASE64 ||
      process.env.GOOGLE_CREDENTIALS_BASE64 ||
      null,
  );
}

/** Slugify a client display name into a stable client_id: lowercase, alnum + underscores. */
function slugifyClientId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

/**
 * Resolve client_id so each client's warehouse is isolated:
 *   explicit client_id > slugified client_name > tenant context > "bma".
 * Passing a client_name is the easy path to a per-client warehouse instead of
 * everything landing in the token's tenant.
 */
function resolveClientId(
  argClientId: unknown,
  argClientName: unknown,
  ctx: ToolCallContext,
): string {
  if (typeof argClientId === "string" && argClientId.trim()) {
    return argClientId.trim();
  }
  if (typeof argClientName === "string" && argClientName.trim()) {
    const slug = slugifyClientId(argClientName);
    if (slug) return slug;
  }
  return ctx.tenantId || DEFAULT_CLIENT_ID;
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

/** Render a ProvisionPlan as human-readable markdown. */
function renderPlan(plan: ProvisionPlan): string {
  const lines: string[] = [];
  lines.push(`**Warehouse plan** (client: ${plan.clientId})`);
  if (plan.notes) lines.push(`_${plan.notes}_`);
  lines.push("");

  lines.push(`**Pipelines** (${plan.pipelines.length})`);
  if (plan.pipelines.length === 0) {
    lines.push("- (none)");
  } else {
    for (const p of plan.pipelines) {
      lines.push(`- ${p.name}`);
      const ordered = [...p.stages].sort((a, b) => a.order - b.order);
      for (const s of ordered) {
        const desc = s.description ? ` — ${s.description}` : "";
        lines.push(`    ${s.order}. ${s.name}${desc}`);
      }
    }
  }
  lines.push("");

  lines.push(`**Custom fields** (${plan.fields.length})`);
  if (plan.fields.length === 0) {
    lines.push("- (none)");
  } else {
    for (const f of plan.fields) {
      const desc = f.description ? ` — ${f.description}` : "";
      lines.push(`- ${f.entity}.${f.fieldName} (${f.fieldType})${desc}`);
    }
  }

  return lines.join("\n");
}

/** Render a ProvisionResult as human-readable markdown. */
function renderResult(result: ProvisionResult): string {
  const lines: string[] = [];
  lines.push(`**Provisioned client: ${result.clientId}**`);
  lines.push(
    `Created ${result.stagesCreated} new stage(s) and ${result.fieldsCreated} new custom field(s).`,
  );
  lines.push("");
  lines.push(renderPlan(result.plan));
  return lines.join("\n");
}

// ── togari_provision_preview ────────────────────────────────────────

const previewShape = {
  description: z
    .string()
    .min(1)
    .describe(
      "Natural-language description of the client and what they do, e.g. 'Joe runs a PR firm; pipelines: media outreach and retainer clients; track outlet, journalist, angle, embargo date'.",
    ),
  client_name: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Client display name (e.g. 'Serif Health'). Slugified into an isolated client_id. Use this to provision a distinct client rather than the active tenant.",
    ),
  client_id: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Explicit client_id (wins over client_name). Defaults to slugified client_name, else the active tenant (default 'bma').",
    ),
};
const PreviewInput = z.object(previewShape);

export function buildPreviewTool(deps: ProvisionToolDeps = {}): ToolModule {
  return {
    name: "togari_provision_preview",
    description:
      "Preview the warehouse structure Togari would build for a client from a plain-English description: proposed pipelines, ordered stages, and custom data-point fields. Read-only, writes nothing. Run this first, then togari_provision_client to actually build it.",
    inputSchema: previewShape,
    handler: async (args, ctx) => {
      const parsed = PreviewInput.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);
      const bq = deps.bq ?? defaultBq();
      const clientId = resolveClientId(
        parsed.data.client_id,
        parsed.data.client_name,
        ctx,
      );

      const svc = new ProvisionService({ bq });
      const plan = await svc.preview({
        clientId,
        description: parsed.data.description,
        clientExplicit: !!(parsed.data.client_id || parsed.data.client_name),
      });
      return textResult(renderPlan(plan));
    },
  };
}

// ── togari_provision_client ─────────────────────────────────────────

const provisionShape = {
  description: z
    .string()
    .min(1)
    .describe(
      "Natural-language description of the client and what they do. Togari plans the pipelines, stages, and custom fields, then builds them.",
    ),
  client_name: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Client display name (e.g. 'Serif Health'). Slugified into an isolated client_id so this client's warehouse is separate from the active tenant.",
    ),
  client_id: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Explicit client_id (wins over client_name). Defaults to slugified client_name, else the active tenant (default 'bma').",
    ),
};
const ProvisionInputSchema = z.object(provisionShape);

export function buildProvisionTool(deps: ProvisionToolDeps = {}): ToolModule {
  return {
    name: "togari_provision_client",
    description:
      "Instantly set up a client's data architecture from a sentence. Describe the client and Togari builds their warehouse: pipelines and ordered stages (in pipeline_stages) plus custom data-point fields (via the schema registry). Idempotent — re-running only adds what is missing. Returns what was created.",
    inputSchema: provisionShape,
    handler: async (args, ctx) => {
      const parsed = ProvisionInputSchema.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);
      const bq = deps.bq ?? defaultBq();
      const clientId = resolveClientId(
        parsed.data.client_id,
        parsed.data.client_name,
        ctx,
      );

      const svc = new ProvisionService({ bq });
      const result = await svc.provision({
        clientId,
        description: parsed.data.description,
        clientExplicit: !!(parsed.data.client_id || parsed.data.client_name),
      });

      logger.info("provision.tool.done", {
        clientId,
        stagesCreated: result.stagesCreated,
        fieldsCreated: result.fieldsCreated,
      });

      return textResult(renderResult(result));
    },
  };
}

// ── Registration ────────────────────────────────────────────────────

export function buildProvisionTools(
  deps: ProvisionToolDeps = {},
): ToolModule[] {
  return [buildPreviewTool(deps), buildProvisionTool(deps)];
}

/**
 * Register the provisioning MCP tools on an `McpServer`. Called by the MCP
 * transport setup alongside the other tool-module registrants.
 */
export function registerProvisionTools(
  server: McpServer,
  deps: ProvisionToolDeps = {},
): void {
  for (const mod of buildProvisionTools(deps)) {
    registerToolModule(server, mod);
  }
}

/** Alias matching the orchestrator's `import * as provisionTools` pattern. */
export const register = registerProvisionTools;
