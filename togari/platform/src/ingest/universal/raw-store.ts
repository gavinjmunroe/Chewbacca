/**
 * Universal ingestion — raw store.
 *
 * The lakehouse invariant: EVERY submission is preserved verbatim before any
 * extraction is attempted. `storeRaw` always writes a row into
 * `togari_data_lake.raw_ingestions` (status "received") so that even if the
 * downstream Anthropic extraction fails, the raw payload is durably captured
 * and can be re-processed later. `setStatus` advances the row's lifecycle
 * (received -> processed | failed) and records how many entities were routed.
 */

import crypto from "crypto";
import { BigQueryClient } from "../../bigquery/client";
import { resolveDataset } from "../../services/dataset-resolver";
import { createLogger } from "../../observability/logger";
import type { IngestInput } from "./types";

const logger = createLogger("ingest/universal/raw-store");

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";

function rawIngestionsTable(): string {
  return `\`${PROJECT_ID}.${resolveDataset()}.raw_ingestions\``;
}

/**
 * Persist the raw submission. Returns the generated ingestion id. This must
 * always succeed independently of extraction — the raw is the source of truth.
 */
export async function storeRaw(
  bq: BigQueryClient,
  input: IngestInput,
): Promise<{ ingestionId: string }> {
  const ingestionId = crypto.randomUUID();

  const hasJson = input.rawJson !== undefined && input.rawJson !== null;
  const rawJsonString = hasJson ? JSON.stringify(input.rawJson) : null;

  // PARSE_JSON only when we actually have JSON; otherwise write NULL. The
  // @rawJson param is passed either way so the parameter set stays stable.
  const sql = `
    INSERT INTO ${rawIngestionsTable()}
      (ingestion_id, client_id, source, content_type, raw_text, raw_json,
       file_name, status, extracted_count, created_at)
    VALUES
      (@ingestionId, @clientId, @source, @contentType, @rawText,
       ${hasJson ? "PARSE_JSON(@rawJson)" : "NULL"},
       @fileName, 'received', 0, CURRENT_TIMESTAMP())
  `.trim();

  const params: Record<string, unknown> = {
    ingestionId,
    clientId: input.clientId,
    source: input.source,
    contentType: input.contentType,
    rawText: input.rawText ?? null,
    rawJson: rawJsonString,
    fileName: input.fileName ?? null,
  };

  await bq.executeWrite(sql, params);
  logger.info("raw ingestion stored", {
    ingestionId,
    clientId: input.clientId,
    source: input.source,
    contentType: input.contentType,
  });

  return { ingestionId };
}

/**
 * Advance a raw_ingestions row's status and (optionally) record how many
 * structured entities were extracted from it.
 */
export async function setStatus(
  bq: BigQueryClient,
  ingestionId: string,
  status: string,
  extractedCount?: number,
): Promise<void> {
  const sql = `
    UPDATE ${rawIngestionsTable()}
       SET status = @status,
           extracted_count = @extractedCount
     WHERE ingestion_id = @ingestionId
  `.trim();

  await bq.executeWrite(sql, {
    ingestionId,
    status,
    extractedCount: extractedCount ?? 0,
  });
}
