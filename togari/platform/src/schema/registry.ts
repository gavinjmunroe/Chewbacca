/**
 * SchemaRegistry — agentic custom-field storage for Togari.
 *
 * BMA can add arbitrary fields to any entity (deal, contact, company)
 * without touching the physical BigQuery schema. Custom fields are stored
 * as ROWS in two metadata tables, NEVER as real columns:
 *
 *   - `custom_field_defs`   — one row per (client_id, entity, field_name)
 *                             describing a field's type and intent.
 *   - `custom_field_values` — one row per (client_id, entity, entity_id,
 *                             field_id) holding the value in a typed column.
 *
 * This means "add a field" and "reorganize my data" are pure metadata /
 * additive-row operations. No DDL (ALTER/CREATE/DROP TABLE) is ever emitted;
 * `BigQueryClient.executeWrite` blocks those anyway. Values are upserted via
 * MERGE (BigQuery's idempotent path) and defs are never deleted, so history
 * is non-lossy: setting a new value overwrites the typed cell for that
 * (entity_id, field) pair but never drops the field or any other entity's
 * data.
 *
 * Tenancy: the canonical key is `client_id` (default "bma"), matching the
 * rest of the togari_data_lake tables.
 */

import crypto from "crypto";
import { BigQueryClient } from "../bigquery/client";
import { resolveDataset } from "../services/dataset-resolver";
import { createLogger } from "../observability/logger";

const logger = createLogger("schema/registry");

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";

/**
 * Entities that can carry custom fields. `client` is the V1 root record; the
 * `(string & {})` member keeps the known names as autocomplete hints while
 * allowing ANY entity type Sagar defines by talking — the registry stores the
 * entity as a plain string, so brand-new record types persist with no code
 * change or migration.
 */
export type SchemaEntity =
  "deal" | "contact" | "company" | "client" | (string & {});

/** Supported custom-field value types. */
export type FieldType = "string" | "number" | "date" | "bool" | "json";

const VALID_FIELD_TYPES: readonly FieldType[] = [
  "string",
  "number",
  "date",
  "bool",
  "json",
];

export interface FieldDef {
  field_id: string;
  client_id: string;
  entity: string;
  field_name: string;
  field_type: string;
  description: string | null;
  created_at: unknown;
  is_active: boolean;
}

export interface FieldValue {
  value_id: string;
  client_id: string;
  entity: string;
  entity_id: string;
  field_id: string;
  field_name: string;
  value_string: string | null;
  value_number: number | null;
  value_bool: boolean | null;
  value_json: unknown;
  updated_at: unknown;
}

function defsTable(): string {
  return `\`${PROJECT_ID}.${resolveDataset()}.custom_field_defs\``;
}

function valuesTable(): string {
  return `\`${PROJECT_ID}.${resolveDataset()}.custom_field_values\``;
}

/** Slugify a free-text field name into a stable snake_case field key. */
export function normalizeFieldName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Slugify an entity/record-type name so "Portfolio Company" and
 * "portfolio_company" resolve to the same bucket. Lets Sagar name new record
 * types freely while keeping storage consistent. Same rules as field names.
 */
export function normalizeEntity(entity: string): string {
  return normalizeFieldName(entity) || "record";
}

/** Infer a FieldType from a runtime JS value. */
export function inferFieldType(value: unknown): FieldType {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "bool";
  if (typeof value === "string") return "string";
  return "json";
}

function isValidFieldType(t: string): t is FieldType {
  return (VALID_FIELD_TYPES as readonly string[]).includes(t);
}

export interface DefineFieldArgs {
  clientId: string;
  entity: string;
  fieldName: string;
  fieldType: FieldType;
  description?: string;
}

export interface ListFieldsArgs {
  clientId: string;
  entity?: string;
}

export interface SetValueArgs {
  clientId: string;
  entity: string;
  entityId: string;
  fieldName: string;
  value: string | number | boolean;
}

export interface GetValuesArgs {
  clientId: string;
  entity: string;
  entityId: string;
}

/**
 * Metadata-backed custom-field registry. Construct with an explicit
 * BigQueryClient so tests can inject the smoke-mocked client.
 */
export class SchemaRegistry {
  private bq: BigQueryClient;

  constructor(deps: { bq: BigQueryClient }) {
    this.bq = deps.bq;
  }

  /**
   * Idempotently define a custom field. If a def already exists for
   * (client_id, entity, field_name) its field_id is returned unchanged;
   * otherwise a new def row is inserted. Never emits DDL.
   */
  async defineField(
    args: DefineFieldArgs,
  ): Promise<{ fieldId: string; created: boolean }> {
    const fieldName = normalizeFieldName(args.fieldName);
    if (!fieldName) {
      throw new Error(
        "field_name must contain at least one alphanumeric character",
      );
    }
    if (!isValidFieldType(args.fieldType)) {
      throw new Error(
        `Invalid field_type "${args.fieldType}". Valid: ${VALID_FIELD_TYPES.join(", ")}`,
      );
    }

    const existing = await this.resolveField(
      args.clientId,
      args.entity,
      fieldName,
    );
    if (existing) {
      return { fieldId: existing.fieldId, created: false };
    }

    const fieldId = crypto.randomUUID();
    const sql = `
      INSERT INTO ${defsTable()}
        (field_id, client_id, entity, field_name, field_type, description, created_at, is_active)
      VALUES
        (@fieldId, @clientId, @entity, @fieldName, @fieldType, @description, CURRENT_TIMESTAMP(), TRUE)
    `.trim();

    await this.bq.executeWrite(sql, {
      fieldId,
      clientId: args.clientId,
      entity: args.entity,
      fieldName,
      fieldType: args.fieldType,
      description: args.description ?? null,
    });

    logger.info("schema.field.defined", {
      clientId: args.clientId,
      entity: args.entity,
      fieldName,
      fieldType: args.fieldType,
    });

    return { fieldId, created: true };
  }

  /** List active custom-field defs for a client, optionally scoped to one entity. */
  async listFields(args: ListFieldsArgs): Promise<FieldDef[]> {
    const params: Record<string, unknown> = { clientId: args.clientId };
    const where: string[] = ["client_id = @clientId", "is_active = TRUE"];
    if (args.entity) {
      where.push("entity = @entity");
      params.entity = args.entity;
    }
    const sql = `
      SELECT field_id, client_id, entity, field_name, field_type,
             description, created_at, is_active
        FROM ${defsTable()}
       WHERE ${where.join(" AND ")}
       ORDER BY entity, field_name
    `.trim();

    const result = await this.bq.executeQuery(sql, params);
    return result.rows as unknown as FieldDef[];
  }

  /**
   * Set a custom value for an entity. Auto-defines the field (inferring the
   * type from the value) when it does not yet exist, then MERGEs the value
   * row so the write is idempotent per (entity_id, field). Additive and
   * non-destructive: only the one typed cell for this pair is overwritten.
   */
  async setValue(
    args: SetValueArgs,
  ): Promise<{ fieldId: string; fieldType: FieldType }> {
    const fieldName = normalizeFieldName(args.fieldName);
    if (!fieldName) {
      throw new Error(
        "field_name must contain at least one alphanumeric character",
      );
    }

    // Honor the field's REGISTERED type when it already exists, so a value set
    // on a `date` field is treated as a date (not re-inferred as "string" from
    // the JS value). Only infer the type when defining a brand-new field.
    const known = await this.resolveField(
      args.clientId,
      args.entity,
      fieldName,
    );
    const fieldType = known ? known.fieldType : inferFieldType(args.value);
    const { fieldId } = known
      ? { fieldId: known.fieldId }
      : await this.defineField({
          clientId: args.clientId,
          entity: args.entity,
          fieldName,
          fieldType,
        });

    // Route the value into exactly one typed column. Dates are stored as ISO
    // strings in value_string. The INACTIVE columns use typed NULL literals
    // (CAST(NULL AS <type>)) rather than null params: a bare null param has no
    // type and BigQuery rejects it against a FLOAT64/BOOL/JSON column.
    const isString = fieldType === "string" || fieldType === "date";
    const isNumber = fieldType === "number";
    const isBool = fieldType === "bool";
    const isJson = fieldType === "json";

    const valueStringSql = isString ? "@valueString" : "CAST(NULL AS STRING)";
    const valueNumberSql = isNumber ? "@valueNumber" : "CAST(NULL AS FLOAT64)";
    const valueBoolSql = isBool ? "@valueBool" : "CAST(NULL AS BOOL)";
    const valueJsonSql = isJson
      ? "PARSE_JSON(@valueJson)"
      : "CAST(NULL AS JSON)";

    const sql = `
      MERGE ${valuesTable()} AS target
      USING (
        SELECT
          @clientId AS client_id,
          @entity AS entity,
          @entityId AS entity_id,
          @fieldId AS field_id
      ) AS source
      ON target.client_id = source.client_id
         AND target.entity = source.entity
         AND target.entity_id = source.entity_id
         AND target.field_id = source.field_id
      WHEN MATCHED THEN
        UPDATE SET
          field_name = @fieldName,
          value_string = ${valueStringSql},
          value_number = ${valueNumberSql},
          value_bool = ${valueBoolSql},
          value_json = ${valueJsonSql},
          updated_at = CURRENT_TIMESTAMP()
      WHEN NOT MATCHED THEN
        INSERT (value_id, client_id, entity, entity_id, field_id, field_name,
                value_string, value_number, value_bool, value_json, updated_at)
        VALUES (@valueId, @clientId, @entity, @entityId, @fieldId, @fieldName,
                ${valueStringSql}, ${valueNumberSql}, ${valueBoolSql},
                ${valueJsonSql},
                CURRENT_TIMESTAMP())
    `.trim();

    const params: Record<string, unknown> = {
      valueId: crypto.randomUUID(),
      clientId: args.clientId,
      entity: args.entity,
      entityId: args.entityId,
      fieldId,
      fieldName,
    };
    if (isString) params.valueString = String(args.value);
    if (isNumber) params.valueNumber = Number(args.value);
    if (isBool) params.valueBool = Boolean(args.value);
    if (isJson) params.valueJson = JSON.stringify(args.value);

    await this.bq.executeWrite(sql, params);

    logger.info("schema.value.set", {
      clientId: args.clientId,
      entity: args.entity,
      entityId: args.entityId,
      fieldName,
      fieldType,
    });

    return { fieldId, fieldType };
  }

  /** Fetch all custom values for a single entity instance. */
  async getValues(args: GetValuesArgs): Promise<FieldValue[]> {
    const sql = `
      SELECT value_id, client_id, entity, entity_id, field_id, field_name,
             value_string, value_number, value_bool, value_json, updated_at
        FROM ${valuesTable()}
       WHERE client_id = @clientId
         AND entity = @entity
         AND entity_id = @entityId
       ORDER BY field_name
    `.trim();

    const result = await this.bq.executeQuery(sql, {
      clientId: args.clientId,
      entity: args.entity,
      entityId: args.entityId,
    });
    return result.rows as unknown as FieldValue[];
  }

  /** Resolve a field_id by (client_id, entity, field_name). Null when absent. */
  private async resolveField(
    clientId: string,
    entity: string,
    fieldName: string,
  ): Promise<{ fieldId: string; fieldType: FieldType } | null> {
    const sql = `
      SELECT field_id, field_type
        FROM ${defsTable()}
       WHERE client_id = @clientId
         AND entity = @entity
         AND field_name = @fieldName
         AND is_active = TRUE
       LIMIT 1
    `.trim();

    const result = await this.bq.executeQuery(sql, {
      clientId,
      entity,
      fieldName,
    });
    if (result.rows.length === 0) return null;
    const row = result.rows[0] as { field_id?: string; field_type?: string };
    if (!row.field_id) return null;
    const ft = isValidFieldType(row.field_type ?? "")
      ? (row.field_type as FieldType)
      : "string";
    return { fieldId: row.field_id, fieldType: ft };
  }
}
