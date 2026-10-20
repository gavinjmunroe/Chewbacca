/**
 * Universal ingestion HTTP router.
 *
 * Mounted at /api/v1 so the full paths are:
 *   POST /api/v1/ingest        — submit any payload (text/csv/json/xlsx). The
 *                                raw is preserved, then structured entities are
 *                                extracted and routed into the CRM/pipeline.
 *   GET  /api/v1/ingest/:id    — read a raw_ingestions row's status.
 *
 * client_id comes from the x-togari-client header (default "bma"). XLSX arrives
 * as base64 in `file_base64`; it is carried in rawText through to the parser.
 */

import express, { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { BigQueryClient } from "../../bigquery/client";
import { resolveDataset } from "../../services/dataset-resolver";
import { createLogger } from "../../observability/logger";
import { UniversalIngestService } from "../../ingest/universal/service";
import type { IngestContentType } from "../../ingest/universal/types";

const logger = createLogger("routes/ingest/universal");

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";
const DEFAULT_CLIENT_ID = "bma";

function moduleBq(): BigQueryClient {
  return new BigQueryClient(
    PROJECT_ID,
    null,
    process.env.GCP_CREDENTIALS_BASE64 ||
      process.env.GOOGLE_CREDENTIALS_BASE64 ||
      null,
  );
}

function rawIngestionsTable(): string {
  return `\`${PROJECT_ID}.${resolveDataset()}.raw_ingestions\``;
}

const IngestBody = z
  .object({
    source: z.string().trim().min(1).optional(),
    content_type: z.enum(["text", "csv", "json", "xlsx"]),
    raw_text: z.string().optional(),
    raw_json: z.unknown().optional(),
    file_base64: z.string().optional(),
    file_name: z.string().optional(),
  })
  .refine(
    (v) =>
      v.raw_text !== undefined ||
      v.raw_json !== undefined ||
      v.file_base64 !== undefined,
    { message: "Provide one of: raw_text, raw_json, file_base64." },
  );

function clientIdFrom(req: Request): string {
  const header = req.header("x-togari-client");
  return header && header.trim().length > 0 ? header.trim() : DEFAULT_CLIENT_ID;
}

export function createUniversalIngestRouter(): Router {
  const router = Router();
  router.use(express.json({ limit: "10mb" }));

  router.post("/ingest", async (req: Request, res: Response) => {
    const parsed = IngestBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_payload",
        details: parsed.error.flatten(),
      });
    }
    const body = parsed.data;
    const clientId = clientIdFrom(req);

    // XLSX (and any base64 file) rides in rawText through to the parser.
    const rawText = body.file_base64 ?? body.raw_text;

    try {
      const service = new UniversalIngestService({ bq: moduleBq() });
      const result = await service.ingest({
        clientId,
        source: body.source ?? "api",
        contentType: body.content_type as IngestContentType,
        rawText,
        rawJson: body.raw_json,
        fileName: body.file_name,
      });

      return res.status(200).json({
        ingestion_id: result.ingestionId,
        extracted: result.extracted,
        routed: result.routed,
        summary: result.summary,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        "universal ingest failed",
        err instanceof Error ? err : new Error(message),
        { clientId },
      );
      return res.status(500).json({ error: "ingest_failed", message });
    }
  });

  router.get("/ingest/:ingestion_id", async (req: Request, res: Response) => {
    const ingestionId = req.params.ingestion_id;
    const clientId = clientIdFrom(req);

    const sql = `
      SELECT ingestion_id, client_id, source, content_type,
             status, extracted_count, file_name, created_at
        FROM ${rawIngestionsTable()}
       WHERE ingestion_id = @ingestionId
       LIMIT 1
    `.trim();

    try {
      const bq = moduleBq();
      const result = await bq.executeQuery(sql, { ingestionId });
      if (result.rows.length === 0) {
        return res
          .status(404)
          .json({ error: "not_found", ingestion_id: ingestionId });
      }
      const r = result.rows[0];
      return res.status(200).json({
        ingestion_id: r.ingestion_id,
        client_id: r.client_id,
        source: r.source,
        content_type: r.content_type,
        status: r.status,
        extracted_count: r.extracted_count,
        file_name: r.file_name,
        created_at: r.created_at,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        "universal ingest status failed",
        err instanceof Error ? err : new Error(message),
        { clientId, ingestionId },
      );
      return res.status(500).json({ error: "status_failed", message });
    }
  });

  return router;
}
