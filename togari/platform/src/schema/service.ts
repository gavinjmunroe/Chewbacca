/**
 * Schema service — factory + convenience wrappers over SchemaRegistry.
 *
 * Keeps the BigQueryClient wiring in one place (mirrors the env-var pattern
 * used by src/core/tools/deal-ops.ts and src/mcp/tools/_shared.ts) so the
 * MCP schema tools and any future callers construct the registry the same
 * way. Tests pass their own BigQueryClient into SchemaRegistry directly and
 * never touch this factory.
 */

import { BigQueryClient } from "../bigquery/client";
import { SchemaRegistry } from "./registry";

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";

/** Construct a real-credential BigQueryClient for the schema registry. */
export function defaultSchemaBq(): BigQueryClient {
  return new BigQueryClient(
    PROJECT_ID,
    null,
    process.env.GCP_CREDENTIALS_BASE64 ||
      process.env.GOOGLE_CREDENTIALS_BASE64 ||
      null,
  );
}

/** Build a SchemaRegistry, defaulting to a real-credential BigQueryClient. */
export function buildSchemaRegistry(
  deps: { bq?: BigQueryClient } = {},
): SchemaRegistry {
  return new SchemaRegistry({ bq: deps.bq ?? defaultSchemaBq() });
}
