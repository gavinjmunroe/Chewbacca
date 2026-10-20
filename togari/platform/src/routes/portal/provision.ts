/**
 * Client-facing provisioning portal backend.
 *
 * Mounted at /api/v1/portal so the full paths are:
 *   POST /api/v1/portal/provision/preview  — plan a client's warehouse (no writes)
 *   POST /api/v1/portal/provision          — plan AND build the warehouse
 *
 * The "Joe, these are your pipelines, these are the data points you want,
 * done" feature: send a plain-English description of a client and Togari sets
 * up their warehouse structure (pipelines, ordered stages, custom fields).
 * Preview is read-only; provision writes rows into pipeline_stages and defines
 * custom fields via the schema registry. No DDL is ever emitted.
 *
 * client_id resolves from the request body, then the `x-togari-client` header,
 * then "bma".
 */

import express, { Router } from "express";
import type { Request, Response } from "express";
import { BigQueryClient } from "../../bigquery/client";
import { ProvisionService } from "../../provision/service";
import { createLogger } from "../../observability/logger";

const logger = createLogger("routes/portal/provision");

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";

function buildBq(): BigQueryClient {
  return new BigQueryClient(
    PROJECT_ID,
    null,
    process.env.GCP_CREDENTIALS_BASE64 ||
      process.env.GOOGLE_CREDENTIALS_BASE64 ||
      null,
  );
}

function resolveClientId(req: Request, bodyClientId?: unknown): string {
  const authed = (req as { togariClientId?: string }).togariClientId;
  if (authed && authed.trim()) return authed.trim();
  if (typeof bodyClientId === "string" && bodyClientId.trim()) {
    return bodyClientId.trim();
  }
  const header = req.header("x-togari-client");
  if (header && header.trim()) return header.trim();
  return "bma";
}

export function createProvisionPortalRouter(): Router {
  const router = Router();
  router.use(express.json({ limit: "1mb" }));

  // ── POST /provision/preview ──────────────────────────────────────
  router.post("/provision/preview", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      description?: string;
      client_id?: string;
      client_name?: string;
    };
    const description =
      typeof body.description === "string" ? body.description : "";
    if (!description.trim()) {
      return res
        .status(400)
        .json({ success: false, error: "description is required" });
    }
    const clientId = resolveClientId(req, body.client_id);

    try {
      const svc = new ProvisionService({ bq: buildBq() });
      const plan = await svc.preview({
        clientId,
        description,
        clientExplicit: !!(body.client_id || body.client_name),
      });
      return res.status(200).json({ success: true, data: { plan } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(
        "POST /provision/preview failed",
        err instanceof Error ? err : new Error(msg),
        { clientId },
      );
      return res.status(500).json({ success: false, error: msg });
    }
  });

  // ── POST /provision ──────────────────────────────────────────────
  router.post("/provision", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      description?: string;
      client_id?: string;
      client_name?: string;
    };
    const description =
      typeof body.description === "string" ? body.description : "";
    if (!description.trim()) {
      return res
        .status(400)
        .json({ success: false, error: "description is required" });
    }
    const clientId = resolveClientId(req, body.client_id);

    try {
      const svc = new ProvisionService({ bq: buildBq() });
      const result = await svc.provision({
        clientId,
        description,
        clientExplicit: !!(body.client_id || body.client_name),
      });
      return res.status(200).json({
        success: true,
        data: {
          client_id: result.clientId,
          stages_created: result.stagesCreated,
          fields_created: result.fieldsCreated,
          stage_errors: result.stageErrors,
          plan: result.plan,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(
        "POST /provision failed",
        err instanceof Error ? err : new Error(msg),
        { clientId },
      );
      return res.status(500).json({ success: false, error: msg });
    }
  });

  return router;
}
