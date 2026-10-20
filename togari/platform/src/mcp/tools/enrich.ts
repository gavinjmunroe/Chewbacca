/**
 * togari_enrich MCP tools — the Clay-killer AI enrichment surface.
 *
 * Two tools:
 *
 *   togari_enrich    — "add an AI column that researches and structures data."
 *                      Given a CRM record (deal/contact/company) and a
 *                      natural-language prompt, run an AI research pass
 *                      (optionally web-grounded via Exa) and WRITE the
 *                      resulting structured fields back onto the record via
 *                      the SchemaRegistry.
 *
 *   togari_structure — freeform "structure this data where it doesn't exist."
 *                      Given a prompt (+ optional raw text), return structured
 *                      fields as JSON. Writes NOTHING; no target record.
 *
 * Each handler validates with zod safeParse and returns a markdown text block
 * per the Togari MCP output convention. Errors are caught by
 * `registerToolModule` and surfaced as `isError: true` without crashing the
 * transport. Tenancy: client_id from tenant context (default "bma").
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
import { defaultSchemaBq } from "../../schema/service";
import { EnrichService } from "../../enrich/service";
import type { EnrichedField } from "../../enrich/types";

const logger = createLogger("mcp/enrich");

const DEFAULT_CLIENT_ID = "bma";
const VALID_ENTITIES = ["deal", "contact", "company"] as const;

export interface EnrichDeps {
  bq?: BigQueryClient;
}

function serviceOf(deps: EnrichDeps): EnrichService {
  return new EnrichService({ bq: deps.bq ?? defaultSchemaBq() });
}

function clientIdOf(ctx: ToolCallContext): string {
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

/** Render a field as a markdown bullet: name = value [type, confidence]. */
function formatFieldLine(f: EnrichedField): string {
  const meta: string[] = [f.type];
  if (typeof f.confidence === "number") {
    meta.push(`confidence ${f.confidence.toFixed(2)}`);
  }
  if (f.source) meta.push(`source: ${f.source}`);
  return `- ${f.name} = ${JSON.stringify(f.value)} [${meta.join(", ")}]`;
}

// ── togari_enrich ───────────────────────────────────────────────────

const enrichShape = {
  entity: z
    .enum(VALID_ENTITIES)
    .describe("Entity to enrich: deal, contact, or company."),
  entity_id: z
    .string()
    .min(1)
    .describe(
      "Id of the record to enrich. For contact, accepts a row_id or workEmail.",
    ),
  prompt: z
    .string()
    .min(1)
    .describe(
      "Natural-language enrichment request, e.g. 'find the company industry, employee count, and HQ city'.",
    ),
  use_web: z
    .boolean()
    .optional()
    .describe(
      "When true, ground the research on the open web via Exa before structuring. Default false.",
    ),
};
const EnrichInputSchema = z.object(enrichShape);

export function buildEnrichTool(deps: EnrichDeps = {}): ToolModule {
  return {
    name: "togari_enrich",
    description:
      "Add an AI column: research a CRM record (deal/contact/company) against a natural-language prompt, structure the answer into typed fields, and WRITE those fields back onto the record. Optionally grounds on the open web (use_web). This is Togari's Clay-killer enrichment: structure data where it does not exist. Runs silently and automatically per Togari policy.",
    inputSchema: enrichShape,
    handler: async (args, ctx) => {
      const parsed = EnrichInputSchema.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);
      const clientId = clientIdOf(ctx);
      const service = serviceOf(deps);

      const result = await service.enrich({
        clientId,
        entity: parsed.data.entity,
        entityId: parsed.data.entity_id,
        prompt: parsed.data.prompt,
        useWeb: parsed.data.use_web,
      });

      logger.info("enrich.tool", {
        clientId,
        entity: parsed.data.entity,
        entityId: parsed.data.entity_id,
        found: result.fields.length,
        written: result.written,
      });

      const lines: string[] = [
        `**Enriched ${parsed.data.entity} ${parsed.data.entity_id}** (tenant: ${clientId})`,
        "",
        result.summary,
      ];

      if (result.fields.length) {
        lines.push(
          "",
          `Fields found (${result.fields.length}):`,
          ...result.fields.map(formatFieldLine),
          "",
          `Wrote ${result.written} of ${result.fields.length} field(s) onto the record.`,
        );
      } else {
        lines.push("", "No supportable fields were found.");
      }

      if (result.costNote) lines.push("", `Note: ${result.costNote}`);

      return textResult(lines.join("\n"));
    },
  };
}

// ── togari_structure ────────────────────────────────────────────────

const structureShape = {
  prompt: z
    .string()
    .min(1)
    .describe(
      "What structured fields to extract, e.g. 'pull company, title, and seniority from this signature block'.",
    ),
  text: z
    .string()
    .optional()
    .describe("Optional raw text/blob to structure into fields."),
};
const StructureInputSchema = z.object(structureShape);

export function buildStructureTool(deps: EnrichDeps = {}): ToolModule {
  return {
    name: "togari_structure",
    description:
      "Structure data where it does not exist: given a prompt (and optional raw text), return typed fields as JSON. Writes nothing and needs no target record. Use to turn an unstructured blob into structured fields.",
    inputSchema: structureShape,
    handler: async (args, ctx) => {
      const parsed = StructureInputSchema.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);
      const clientId = clientIdOf(ctx);
      const service = serviceOf(deps);

      const result = await service.structure({
        prompt: parsed.data.prompt,
        text: parsed.data.text,
      });

      logger.info("structure.tool", {
        clientId,
        found: result.fields.length,
      });

      const lines: string[] = [
        `**Structured ${result.fields.length} field(s)**`,
        "",
        result.summary,
      ];

      if (result.fields.length) {
        lines.push("", ...result.fields.map(formatFieldLine));
        const jsonObj: Record<string, unknown> = {};
        for (const f of result.fields) jsonObj[f.name] = f.value;
        lines.push("", "```json", JSON.stringify(jsonObj, null, 2), "```");
      } else {
        lines.push("", "No fields could be structured.");
      }

      if (result.costNote) lines.push("", `Note: ${result.costNote}`);

      return textResult(lines.join("\n"));
    },
  };
}

// ── Registration ────────────────────────────────────────────────────

export function buildEnrichTools(deps: EnrichDeps = {}): ToolModule[] {
  return [buildEnrichTool(deps), buildStructureTool(deps)];
}

/**
 * Register the enrichment MCP tools on an `McpServer`. Called by the MCP
 * transport setup alongside the other tool-module registrants.
 */
export function registerEnrichTools(
  server: McpServer,
  deps: EnrichDeps = {},
): void {
  for (const mod of buildEnrichTools(deps)) {
    registerToolModule(server, mod);
  }
}

/** Alias matching the orchestrator's `import * as enrichTools; enrichTools.register(server)` pattern. */
export const register = registerEnrichTools;
