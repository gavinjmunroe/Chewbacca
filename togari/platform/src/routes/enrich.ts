/**
 * AI enrichment REST route.
 *
 * Mounted at /api/v1, so the full path is:
 *   POST /api/v1/enrich
 *
 * Body: { entity: "deal"|"contact"|"company", entity_id, prompt, use_web? }
 * Researches the record against the prompt, structures the answer into typed
 * fields, and writes them back onto the record via the SchemaRegistry. Returns
 * the EnrichResult as JSON.
 *
 * Tenancy: client_id from the x-togari-client header (canonical), default "bma".
 */

import { Router } from "express";
import { defaultSchemaBq } from "../schema/service";
import { EnrichService, type EnrichEntity } from "../enrich/service";
import { createLogger } from "../observability/logger";

const logger = createLogger("routes/enrich");

const DEFAULT_CLIENT_ID = "bma";
const VALID_ENTITIES: readonly EnrichEntity[] = ["deal", "contact", "company"];

function headerValue(v: unknown): string | undefined {
  if (Array.isArray(v)) return typeof v[0] === "string" ? v[0] : undefined;
  return typeof v === "string" ? v : undefined;
}

export function createEnrichRouter(): Router {
  const router = Router();

  // POST /enrich — research + structure + write fields back onto a record.
  router.post("/enrich", async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        entity?: string;
        entity_id?: string;
        prompt?: string;
        use_web?: boolean;
      };

      const entity = body.entity as EnrichEntity | undefined;
      if (!entity || !VALID_ENTITIES.includes(entity)) {
        res.status(400).json({
          error: "invalid_entity",
          message: `entity must be one of: ${VALID_ENTITIES.join(", ")}.`,
        });
        return;
      }
      if (!body.entity_id || typeof body.entity_id !== "string") {
        res.status(400).json({
          error: "missing_entity_id",
          message: "entity_id is required.",
        });
        return;
      }
      if (!body.prompt || typeof body.prompt !== "string") {
        res.status(400).json({
          error: "missing_prompt",
          message: "prompt is required.",
        });
        return;
      }

      const clientId =
        headerValue(req.headers["x-togari-client"]) || DEFAULT_CLIENT_ID;

      const service = new EnrichService({ bq: defaultSchemaBq() });
      const result = await service.enrich({
        clientId,
        entity,
        entityId: body.entity_id,
        prompt: body.prompt,
        useWeb: body.use_web === true,
      });

      logger.info("enrich.request", {
        clientId,
        entity,
        entityId: body.entity_id,
        found: result.fields.length,
        written: result.written,
      });

      res.status(200).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        "enrich.request.failed",
        err instanceof Error ? err : new Error(message),
      );
      res.status(500).json({ error: "enrich_failed", message });
    }
  });

  return router;
}
