/**
 * @togari/admin — Clay webhook ingestion route
 *
 * POST /api/ingest/clay
 *   Headers:
 *     X-Clay-Signature: sha256=<hex>  (HMAC of raw body with CLAY_WEBHOOK_SECRET)
 *     Content-Type: application/json
 *   Body: Clay-shaped webhook payload (see schema.ts)
 *
 * Response:
 *   200 { ok: true, clay_run_id, import_id, status: 'completed'|'duplicate',
 *         imported_company_count, imported_contact_count }
 *   400 { error: 'invalid_json' | 'invalid_payload', detail? }
 *   401 { error: 'unauthorized', reason }
 *   500 { error: 'persistence_failed', detail }
 *
 * Mount with raw body parser so HMAC verification sees the bytes Clay signed:
 *   app.use('/api/ingest/clay', express.raw({ type: 'application/json', limit: '10mb' }), clayIngestRouter)
 */

import express, { type Request, type Response, type Router } from "express";
import { verifyClayHmacRequest } from "../../ingest/clay/hmac";
import { ClayWebhookPayloadSchema } from "../../ingest/clay/schema";
import { persistClayPayload } from "../../ingest/clay/persister";
import { createFixedWindowRateLimit } from "../../middleware/ingest-rate-limit";
import { createLogger } from "../../observability/logger";

const logger = createLogger("routes/ingest/clay");

export function createClayIngestRouter(): Router {
  const router: Router = express.Router();
  const perMin = Number(process.env.CLAY_INGEST_RATE_LIMIT_PER_MIN) || 600;
  router.use(createFixedWindowRateLimit(perMin));

  router.post(
    "/",
    express.raw({ type: "application/json", limit: "10mb" }),
    async (req: Request, res: Response) => {
      // ── Feature gate ───────────────────────────────────────────
      // This batch route persists via per-row BigQuery DML, which does not
      // scale (DML concurrency limits + seconds-per-statement) and is not the
      // supported ingest path. The passthrough route
      // (POST /webhooks/clay/companies|/contacts) is. Keep this disabled unless
      // explicitly opted in, so it can't be wired up by accident.
      if (process.env.CLAY_HMAC_INGEST_ENABLED !== "true") {
        res.status(501).json({
          error: "not_implemented",
          message:
            "HMAC batch ingest is disabled. Use POST /webhooks/clay/companies or /contacts instead.",
        });
        return;
      }

      const secret = process.env.CLAY_WEBHOOK_SECRET;

      // ── HMAC ───────────────────────────────────────────────────
      const hmac = verifyClayHmacRequest(req, secret);
      if (!hmac.ok) {
        if (hmac.reason === "missing_secret") {
          logger.error("CLAY_WEBHOOK_SECRET not configured; refusing webhook");
        } else {
          logger.warn("Clay webhook signature check failed", {
            reason: hmac.reason,
          });
        }
        res.status(401).json({ error: "unauthorized", reason: hmac.reason });
        return;
      }

      // ── JSON parse ─────────────────────────────────────────────
      const rawBody = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(req.body ?? "");
      let body: unknown;
      try {
        body = JSON.parse(rawBody.toString("utf8"));
      } catch {
        res.status(400).json({ error: "invalid_json" });
        return;
      }

      // ── Zod validate ───────────────────────────────────────────
      const parsed = ClayWebhookPayloadSchema.safeParse(body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "invalid_payload", detail: parsed.error.flatten() });
        return;
      }

      // ── Persist ────────────────────────────────────────────────
      try {
        const result = await persistClayPayload(parsed.data);
        res.status(200).json({
          ok: true,
          clay_run_id: parsed.data.clay_run_id,
          import_id: result.importId,
          status: result.status,
          imported_company_count: result.companyCount,
          imported_contact_count: result.contactCount,
        });
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        logger.error(
          "Clay webhook persistence failed",
          err instanceof Error ? err : new Error(detail),
          {
            clay_run_id: parsed.data.clay_run_id,
          },
        );
        res.status(500).json({ error: "persistence_failed", detail });
      }
    },
  );

  return router;
}
