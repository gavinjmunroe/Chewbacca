/**
 * Auto-ingestion HTTP router.
 *
 * Mounted at /api/v1/ingest so the full paths are:
 *   POST /api/v1/ingest/gmail      — pull recent emails and ingest each through
 *                                    the universal pipeline.
 *   POST /api/v1/ingest/fireflies  — pull recent transcripts and ingest each.
 *
 * client_id comes from the x-togari-client header (default "bma"). Both routes
 * delegate to the source helpers, which raw-preserve, AI-extract, and route
 * every item into the CRM/pipeline. Missing credentials return HTTP 200 with
 * configured:false and a note (a not-configured connector is not an error).
 */

import express, { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { BigQueryClient } from "../../bigquery/client";
import { createLogger } from "../../observability/logger";
import { ingestGmail } from "../../ingest/sources/gmail-ingest";
import { ingestFireflies } from "../../ingest/sources/fireflies-ingest";

const logger = createLogger("routes/ingest/auto");

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

function clientIdFrom(req: Request): string {
  const header = req.header("x-togari-client");
  return header && header.trim().length > 0 ? header.trim() : DEFAULT_CLIENT_ID;
}

const GmailBody = z.object({
  max: z.number().int().positive().max(100).optional(),
  query: z.string().optional(),
});

const FirefliesBody = z.object({
  max: z.number().int().positive().max(100).optional(),
});

export function createAutoIngestRouter(): Router {
  const router = Router();
  router.use(express.json({ limit: "1mb" }));

  router.post("/gmail", async (req: Request, res: Response) => {
    const parsed = GmailBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_payload",
        details: parsed.error.flatten(),
      });
    }
    const clientId = clientIdFrom(req);
    try {
      const result = await ingestGmail({
        bq: moduleBq(),
        clientId,
        maxMessages: parsed.data.max,
        query: parsed.data.query,
      });
      return res.status(200).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        "gmail ingest route failed",
        err instanceof Error ? err : new Error(message),
        { clientId },
      );
      return res.status(500).json({ error: "ingest_failed", message });
    }
  });

  router.post("/fireflies", async (req: Request, res: Response) => {
    const parsed = FirefliesBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_payload",
        details: parsed.error.flatten(),
      });
    }
    const clientId = clientIdFrom(req);
    try {
      const result = await ingestFireflies({
        bq: moduleBq(),
        clientId,
        maxMeetings: parsed.data.max,
      });
      return res.status(200).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        "fireflies ingest route failed",
        err instanceof Error ? err : new Error(message),
        { clientId },
      );
      return res.status(500).json({ error: "ingest_failed", message });
    }
  });

  return router;
}
