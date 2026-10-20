/**
 * Universal ingestion — shared types.
 *
 * Togari's lakehouse promise: ingest ANY data, preserve the raw submission
 * verbatim, then intelligently extract structured entities and route them into
 * the pipeline / CRM tables. These types describe the boundary between the raw
 * submission (IngestInput) and the model-extracted structured entities
 * (ExtractedEntity / ExtractionResult).
 */

/** Supported content encodings for a raw submission. */
export type IngestContentType = "text" | "csv" | "json" | "xlsx";

/**
 * A single raw submission handed to the universal ingestion service. Exactly
 * one of rawText / rawJson is expected for text/csv/json; xlsx arrives as a
 * base64 file (carried in rawText by the router before parsing).
 */
export interface IngestInput {
  clientId: string;
  source: string;
  contentType: IngestContentType;
  rawText?: string;
  rawJson?: unknown;
  fileName?: string;
}

/**
 * A structured entity the model pulled out of a raw submission. Discriminated
 * on `kind` so the router can fan each entity into the correct table.
 */
export type ExtractedEntity =
  | {
      kind: "contact";
      full_name?: string;
      email?: string;
      company?: string;
      title?: string;
      phone?: string;
    }
  | {
      kind: "company";
      name?: string;
      domain?: string;
      industry?: string;
    }
  | {
      kind: "activity";
      deal_ref?: string;
      contact_ref?: string;
      type: string;
      content: string;
    }
  | {
      kind: "task";
      content: string;
      due?: string;
      owner?: string;
    }
  | {
      kind: "fact";
      subject: string;
      statement: string;
    }
  | {
      kind: "pipeline_update";
      company_or_deal: string;
      to_stage?: string;
    }
  | {
      kind: "deal";
      company: string;
      value?: number;
      stage?: string;
      pipeline?: string;
      contact_name?: string;
      contact_email?: string;
      notes?: string;
    };

/** The model's extraction output: the entities plus a short human summary. */
export interface ExtractionResult {
  entities: ExtractedEntity[];
  summary: string;
}
