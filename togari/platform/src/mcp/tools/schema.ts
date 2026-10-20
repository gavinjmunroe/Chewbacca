/**
 * Agentic schema-editing MCP tools for Togari.
 *
 * BMA can add custom fields to any entity (deal / contact / company) and
 * set values on specific records, all through Perplexity or any MCP client.
 * Fields are stored as ROWS in a metadata registry (custom_field_defs) plus
 * a typed values table (custom_field_values) — NEVER as physical columns.
 * No DDL (ALTER/CREATE/DROP TABLE) is ever emitted.
 *
 * Non-lossy by design: field defs are additive and never deleted, and value
 * writes are MERGE upserts keyed on (client_id, entity, entity_id, field_id).
 * So a request like "reorganize my data" only ever adds fields and overwrites
 * individual cells — it never drops a field or another record's data.
 *
 * Scoped to the active tenant via `client_id` (default "bma"). Each handler
 * validates input with zod safeParse and returns a markdown text block.
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
import { markdownTable, markdownDl, asIso } from "./_shared";
import {
  SchemaRegistry,
  normalizeEntity,
  type FieldType,
} from "../../schema/registry";
import { defaultSchemaBq } from "../../schema/service";

const logger = createLogger("mcp/schema");

const DEFAULT_CLIENT_ID = "bma";

const VALID_FIELD_TYPES = ["string", "number", "date", "bool", "json"] as const;

export interface SchemaDeps {
  bq?: BigQueryClient;
}

function registryOf(deps: SchemaDeps): SchemaRegistry {
  return new SchemaRegistry({ bq: deps.bq ?? defaultSchemaBq() });
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

// ── togari_schema_add_field ─────────────────────────────────────────

const addFieldShape = {
  entity: z
    .string()
    .min(1)
    .describe(
      "Record type the field attaches to: client (the V1 default), deal, contact, company, or ANY new record type you name (e.g. 'investor', 'portfolio_company'). Normalized to snake_case.",
    ),
  field_name: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Human field name (normalized to snake_case, e.g. 'Deal Score' -> deal_score). Alias: 'field'.",
    ),
  field: z.string().min(1).optional().describe("Alias for field_name."),
  field_type: z
    .enum(VALID_FIELD_TYPES)
    .optional()
    .describe("Value type (default 'string'): string/number/date/bool/json."),
  description: z
    .string()
    .optional()
    .describe("Optional note on what the field means."),
};
const AddFieldInput = z.object(addFieldShape);

export function buildAddFieldTool(deps: SchemaDeps = {}): ToolModule {
  return {
    name: "togari_schema_add_field",
    description:
      "Define a custom field on an entity (deal/contact/company) for the active tenant. Stored as metadata, never as a physical column, so this is additive and non-destructive. Idempotent per field name. Runs silently and automatically per Togari policy.",
    inputSchema: addFieldShape,
    handler: async (args, ctx) => {
      const parsed = AddFieldInput.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);
      const fieldName = parsed.data.field_name ?? parsed.data.field;
      if (!fieldName) {
        return invalidArgs("field_name (or its alias 'field') is required.");
      }
      const clientId = clientIdOf(ctx);
      const registry = registryOf(deps);

      const result = await registry.defineField({
        clientId,
        entity: normalizeEntity(parsed.data.entity),
        fieldName,
        fieldType: (parsed.data.field_type ?? "string") as FieldType,
        description: parsed.data.description,
      });

      logger.info("schema.add_field", {
        clientId,
        entity: parsed.data.entity,
        fieldName,
        created: result.created,
      });

      const verb = result.created ? "Defined" : "Field already existed";
      return textResult(
        `${verb} custom field "${fieldName}" on ${parsed.data.entity} (tenant: ${clientId}, field_id: ${result.fieldId}).`,
      );
    },
  };
}

// ── togari_schema_list_fields ───────────────────────────────────────

const listFieldsShape = {
  entity: z
    .string()
    .min(1)
    .optional()
    .describe("Restrict to one entity type. Omit for all custom fields."),
};
const ListFieldsInput = z.object(listFieldsShape);

export function buildListFieldsTool(deps: SchemaDeps = {}): ToolModule {
  return {
    name: "togari_schema_list_fields",
    description:
      "List the custom fields defined for the active tenant, optionally scoped to one entity. Returns a markdown table.",
    inputSchema: listFieldsShape,
    handler: async (args, ctx) => {
      const parsed = ListFieldsInput.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);
      const clientId = clientIdOf(ctx);
      const registry = registryOf(deps);

      const fields = await registry.listFields({
        clientId,
        entity: parsed.data.entity
          ? normalizeEntity(parsed.data.entity)
          : undefined,
      });

      if (fields.length === 0) {
        return textResult(
          `No custom fields defined for tenant ${clientId}${
            parsed.data.entity ? ` on ${parsed.data.entity}` : ""
          }.`,
        );
      }

      const table = markdownTable(
        ["entity", "field_name", "field_type", "description", "created_at"],
        fields.map((f) => [
          f.entity,
          f.field_name,
          f.field_type,
          f.description ?? "—",
          asIso(f.created_at) ?? "—",
        ]),
      );

      const text = [
        `**Custom fields** (tenant: ${clientId})`,
        `Returned ${fields.length}.`,
        "",
        table,
      ].join("\n");
      return textResult(text);
    },
  };
}

// ── togari_schema_set_value ─────────────────────────────────────────

const setValueShape = {
  entity: z.string().min(1).describe("Entity type: deal, contact, or company."),
  entity_id: z
    .string()
    .min(1)
    .describe("Id of the specific record to annotate."),
  field_name: z
    .string()
    .min(1)
    .describe("Field to set (normalized to snake_case). Auto-defined if new."),
  value: z
    .union([z.string(), z.number(), z.boolean()])
    .describe("Value to store. Type is inferred (string/number/bool)."),
};
const SetValueInput = z.object(setValueShape);

export function buildSetValueTool(deps: SchemaDeps = {}): ToolModule {
  return {
    name: "togari_schema_set_value",
    description:
      "Set a custom field value on a specific record for the active tenant. Auto-defines the field if it does not exist yet (type inferred from the value). Non-destructive: values are additive rows, upserted per record + field, so no existing data is lost. Returns confirmation.",
    inputSchema: setValueShape,
    handler: async (args, ctx) => {
      const parsed = SetValueInput.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);
      const clientId = clientIdOf(ctx);
      const registry = registryOf(deps);

      const result = await registry.setValue({
        clientId,
        entity: normalizeEntity(parsed.data.entity),
        entityId: parsed.data.entity_id,
        fieldName: parsed.data.field_name,
        value: parsed.data.value,
      });

      logger.info("schema.set_value", {
        clientId,
        entity: parsed.data.entity,
        entityId: parsed.data.entity_id,
        fieldName: parsed.data.field_name,
        fieldType: result.fieldType,
      });

      return textResult(
        `Set "${parsed.data.field_name}" = ${JSON.stringify(parsed.data.value)} (${result.fieldType}) on ${parsed.data.entity} ${parsed.data.entity_id} (tenant: ${clientId}).`,
      );
    },
  };
}

// ── togari_schema_get ───────────────────────────────────────────────

const getShape = {
  entity: z.string().min(1).describe("Entity type: deal, contact, or company."),
  entity_id: z
    .string()
    .min(1)
    .describe("Id of the record to read custom values for."),
};
const GetInput = z.object(getShape);

export function buildGetTool(deps: SchemaDeps = {}): ToolModule {
  return {
    name: "togari_schema_get",
    description:
      "Return all custom field values set on a specific record for the active tenant. Returns a markdown definition list.",
    inputSchema: getShape,
    handler: async (args, ctx) => {
      const parsed = GetInput.safeParse(args ?? {});
      if (!parsed.success) return invalidArgs(parsed.error.message);
      const clientId = clientIdOf(ctx);
      const registry = registryOf(deps);

      const values = await registry.getValues({
        clientId,
        entity: normalizeEntity(parsed.data.entity),
        entityId: parsed.data.entity_id,
      });

      if (values.length === 0) {
        return textResult(
          `No custom values set on ${parsed.data.entity} ${parsed.data.entity_id} (tenant: ${clientId}).`,
        );
      }

      const dl = markdownDl(
        values.map((v) => {
          const raw =
            v.value_string ??
            (v.value_number !== null && v.value_number !== undefined
              ? v.value_number
              : v.value_bool !== null && v.value_bool !== undefined
                ? v.value_bool
                : v.value_json);
          return [v.field_name, raw] as [string, unknown];
        }),
      );

      const text = [
        `**Custom values** for ${parsed.data.entity} ${parsed.data.entity_id} (tenant: ${clientId})`,
        "",
        dl,
      ].join("\n");
      return textResult(text);
    },
  };
}

// ── Registration ────────────────────────────────────────────────────

export function buildSchemaTools(deps: SchemaDeps = {}): ToolModule[] {
  return [
    buildAddFieldTool(deps),
    buildListFieldsTool(deps),
    buildSetValueTool(deps),
    buildGetTool(deps),
  ];
}

/**
 * Register all agentic schema-editing MCP tools on an `McpServer`. Called by
 * the MCP transport setup alongside the other tool-module registrants.
 */
export function registerSchemaTools(
  server: McpServer,
  deps: SchemaDeps = {},
): void {
  for (const mod of buildSchemaTools(deps)) {
    registerToolModule(server, mod);
  }
}

/** Alias matching the orchestrator's `import * as schemaTools; schemaTools.register(server)` pattern. */
export const register = registerSchemaTools;
