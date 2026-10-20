/**
 * Read-only MCP tools for inspecting admin_settings for the active tenant.
 *
 * Tools:
 *   - `togari_admin_get_pricing_config` — returns the live pricing_config
 *     JSON (cents per 1M tokens for AI calls, cents per external API call).
 *   - `togari_admin_get_max_steps`      — returns the agentic_max_steps
 *     scalar (caps the agent loop step count).
 *
 * Both are pure SELECTs against admin_settings, tenant-scoped.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerToolModule, type ToolModule } from "./registry";
import { traceCall } from "../../lib/tracing";
import {
  T,
  defaultBq,
  markdownTable,
  asIso,
  asNumber,
  type ToolDeps,
} from "./_shared";

// ── togari_admin_get_pricing_config ─────────────────────────────────

const pricingInputShape = {} as Record<string, never>;
const PricingInput = z.object({});

export function buildAdminGetPricingConfigTool(
  deps: ToolDeps = {},
): ToolModule {
  return {
    name: "togari_admin_get_pricing_config",
    description:
      "Read the live `pricing_config` row from admin_settings for the active tenant. Returns AI per-1M-token rates and external-service per-call rates, all in cents.",
    inputSchema: pricingInputShape,
    handler: (args, ctx) =>
      traceCall("togari_admin_get_pricing_config", async () => {
        const parsed = PricingInput.safeParse(args ?? {});
        if (!parsed.success) {
          return {
            content: [
              {
                type: "text",
                text: `Invalid arguments: ${parsed.error.message}`,
              },
            ],
            isError: true,
          };
        }
        const bq = deps.bq ?? defaultBq();

        const result = await bq.executeQuery(
          `SELECT value, updated_at
             FROM ${T.adminSettings}
            WHERE tenant_id = @tenantId AND key = 'pricing_config'
            LIMIT 1`,
          { tenantId: ctx.tenantId },
        );

        if (result.rows.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No pricing_config row found in admin_settings for tenant ${ctx.tenantId}.`,
              },
            ],
            isError: true,
          };
        }
        const row = result.rows[0];
        // BigQuery returns JSON columns as strings on some paths and as
        // objects on others. Normalise to an object before rendering.
        let pricing: unknown = row.value;
        if (typeof pricing === "string") {
          try {
            pricing = JSON.parse(pricing);
          } catch {
            // leave as-is; rendered below in the raw section.
          }
        }

        const aiLines: string[] = [];
        const externalLines: string[] = [];
        if (pricing && typeof pricing === "object") {
          const obj = pricing as Record<string, unknown>;
          const ai = (obj.ai ?? {}) as Record<
            string,
            {
              input_per_1m?: number;
              output_per_1m?: number;
              web_search_per_call?: number;
            }
          >;
          for (const [model, rates] of Object.entries(ai)) {
            const webBit =
              rates.web_search_per_call !== undefined
                ? `, web_search=${rates.web_search_per_call}¢/call`
                : "";
            aiLines.push(
              `- **${model}**: input=${rates.input_per_1m}¢/1M, output=${rates.output_per_1m}¢/1M${webBit}`,
            );
          }
          const external = (obj.external ?? {}) as Record<string, number>;
          for (const [service, cents] of Object.entries(external)) {
            externalLines.push(`- **${service}**: ${cents}¢/call`);
          }
        }

        const aiSection =
          aiLines.length > 0
            ? aiLines.join("\n")
            : "_(no AI rates configured)_";
        const externalSection =
          externalLines.length > 0
            ? externalLines.join("\n")
            : "_(no external rates configured)_";

        const text = [
          `**Pricing config** (tenant: ${ctx.tenantId})`,
          `Updated at: ${asIso(row.updated_at) ?? "—"}`,
          "",
          "**AI models** (cents per 1,000,000 tokens)",
          "",
          aiSection,
          "",
          "**External services** (cents per call)",
          "",
          externalSection,
          "",
          "```json",
          JSON.stringify(pricing, null, 2),
          "```",
        ].join("\n");

        return { content: [{ type: "text", text }] };
      }),
  };
}

// ── togari_admin_get_max_steps ──────────────────────────────────────

const maxStepsInputShape = {} as Record<string, never>;
const MaxStepsInput = z.object({});

export function buildAdminGetMaxStepsTool(deps: ToolDeps = {}): ToolModule {
  return {
    name: "togari_admin_get_max_steps",
    description:
      "Read the live `agentic_max_steps` setting from admin_settings for the active tenant. Caps the number of steps the enrichment agent loop will take per company.",
    inputSchema: maxStepsInputShape,
    handler: (args, ctx) =>
      traceCall("togari_admin_get_max_steps", async () => {
        const parsed = MaxStepsInput.safeParse(args ?? {});
        if (!parsed.success) {
          return {
            content: [
              {
                type: "text",
                text: `Invalid arguments: ${parsed.error.message}`,
              },
            ],
            isError: true,
          };
        }
        const bq = deps.bq ?? defaultBq();

        const result = await bq.executeQuery(
          `SELECT value, updated_at
             FROM ${T.adminSettings}
            WHERE tenant_id = @tenantId AND key = 'agentic_max_steps'
            LIMIT 1`,
          { tenantId: ctx.tenantId },
        );

        if (result.rows.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: `No agentic_max_steps row found in admin_settings for tenant ${ctx.tenantId}.`,
              },
            ],
            isError: true,
          };
        }
        const row = result.rows[0];
        let raw: unknown = row.value;
        if (typeof raw === "string") {
          try {
            raw = JSON.parse(raw);
          } catch {
            // leave as-is
          }
        }
        const value = asNumber(raw);

        const table = markdownTable(
          ["key", "value", "updated_at"],
          [
            [
              "agentic_max_steps",
              value === null ? JSON.stringify(raw) : value,
              asIso(row.updated_at) ?? "—",
            ],
          ],
        );

        const text = [
          `**Admin setting** (tenant: ${ctx.tenantId})`,
          "",
          table,
        ].join("\n");

        return { content: [{ type: "text", text }] };
      }),
  };
}

// ── Module registration ────────────────────────────────────────────

export function register(server: McpServer, deps: ToolDeps = {}): void {
  registerToolModule(server, buildAdminGetPricingConfigTool(deps));
  registerToolModule(server, buildAdminGetMaxStepsTool(deps));
}
