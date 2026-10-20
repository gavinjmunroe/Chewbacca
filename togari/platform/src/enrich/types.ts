/**
 * togari_enrich — types for the AI enrichment feature.
 *
 * "Structure data where it doesn't exist": take a CRM record plus a
 * natural-language prompt, run AI research (optionally web-grounded), and
 * write structured fields back onto the record via the SchemaRegistry.
 */

/** A single structured field the model produced. */
export interface EnrichedField {
  /** snake_case field key, e.g. "industry", "arr_estimate". */
  name: string;
  /** The value routed into the SchemaRegistry typed column. */
  value: string | number | boolean;
  /** Declared type. Mirrors SchemaRegistry FieldType. */
  type: "string" | "number" | "date" | "bool" | "json";
  /** Model self-reported confidence 0..1, when available. */
  confidence?: number;
  /** Where the value came from (context field, web, inference). */
  source?: string;
}

/** Result of an enrich() or structure() run. */
export interface EnrichResult {
  /** Target entity ("deal" | "contact" | "company"), omitted for structure(). */
  entity?: string;
  /** Target record id, omitted for structure(). */
  entityId?: string;
  /** Structured fields the model returned. */
  fields: EnrichedField[];
  /** How many fields were successfully written onto the record. */
  written: number;
  /** One-line summary of what was enriched. */
  summary: string;
  /** Optional cost / provenance note (e.g. no API key, web skipped). */
  costNote?: string;
}
