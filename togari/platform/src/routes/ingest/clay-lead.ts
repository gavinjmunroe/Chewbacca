/**
 * Phase-1 flagship fan-out endpoint: POST /webhooks/clay/lead
 *
 * Clay sends ONE enriched, contact-level lead. Togari fans it out across
 * three branches, with DNC evaluated FIRST as a hard compliance gate:
 *
 *   1. DNC check   — is this email/domain on the client's do-not-contact
 *                    list? If suppressed, the Rytual distribution branch is
 *                    skipped (but the lead is still recorded in GCP).
 *   2. GCP insert  — always persist the lead into togari_data_lake.contacts
 *                    with server-stamped lineage columns.
 *   3. Rytual      — only when NOT suppressed, add the lead to the Rytual
 *                    audience table for downstream distribution.
 *
 * Each branch reports its own status. A per-branch failure (e.g. the Rytual
 * table not existing yet) is caught and surfaced in the body rather than
 * failing the whole request. HTTP is always 200 on a well-formed authorized
 * request; branch outcomes carry 207-style semantics inside the body.
 */

import crypto from "crypto";
import express, { Request, Response, Router, NextFunction } from "express";
import { z } from "zod";
import { BigQueryClient } from "../../bigquery/client";
import { resolveDataset } from "../../services/dataset-resolver";
import { checkDncByEmail } from "../../dnc";
import { createLogger } from "../../observability/logger";

const logger = createLogger("routes/clay-lead");

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";
const DEFAULT_CLIENT_ID = "bma";

function qualified(table: string): string {
  return `\`${PROJECT_ID}.${resolveDataset()}.${table}\``;
}

function moduleBq(): BigQueryClient {
  return new BigQueryClient(
    PROJECT_ID,
    null,
    process.env.GCP_CREDENTIALS_BASE64 ||
      process.env.GOOGLE_CREDENTIALS_BASE64 ||
      null,
  );
}

// ── Auth (mirrors src/routes/ingest/clay-passthrough.ts) ────────────

function safeEqual(a: string, b: string): boolean {
  // Constant-time comparison to avoid leaking the key via timing. Length is
  // compared first because timingSafeEqual throws on unequal-length buffers.
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireClayIngestAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const expected = process.env.CLAY_INGEST_API_KEY;
  if (!expected) {
    res.status(500).json({ error: "CLAY_INGEST_API_KEY not configured" });
    return;
  }
  const provided = (req.header("authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!provided || !safeEqual(provided, expected)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

// ── Payload — one enriched contact-level lead ───────────────────────

const ClayLeadPayload = z
  .object({
    email: z.string().trim().min(1, "email is required"),
    full_name: z.string().trim().min(1).optional(),
    company: z.string().trim().min(1).optional(),
    company_domain: z.string().trim().min(1).optional(),
    tag: z.string().trim().min(1).optional(),
  })
  .passthrough();

type BranchResult = Record<string, unknown>;

// ── Branch 2: GCP insert into togari_data_lake.contacts ─────────────

async function insertLeadToGcp(
  bq: BigQueryClient,
  clientId: string,
  lead: {
    email: string;
    full_name?: string;
    company?: string;
    company_domain?: string;
  },
): Promise<BranchResult> {
  const rowId = crypto
    .createHash("sha256")
    .update(`${clientId}:${lead.email.trim().toLowerCase()}`)
    .digest("hex");

  // Land in togari_structured_contacts (the real CRM contacts table). Its
  // schema is camelCase/DealCloud-derived: workEmail/fullName/currentCompany.
  // (There is no plain togari_data_lake.contacts table in prod.)
  const sql = `
    INSERT INTO ${qualified("togari_structured_contacts")}
      (row_id, workEmail, fullName, currentCompany, companyDomain, createdAt)
    VALUES
      (@rowId, @email, @fullName, @company, @companyDomain, CURRENT_TIMESTAMP())
  `.trim();

  const params: Record<string, unknown> = {
    rowId,
    email: lead.email,
    fullName: lead.full_name ?? null,
    company: lead.company ?? null,
    companyDomain: lead.company_domain ?? null,
  };

  try {
    const write = await bq.executeWrite(sql, params);
    return {
      status: "inserted",
      row_id: rowId,
      num_rows: write.numDmlAffectedRows,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      "clay-lead.gcp.failed",
      err instanceof Error ? err : new Error(message),
    );
    return { status: "failed", error: message, row_id: rowId };
  }
}

// ── Branch 3: Rytual audience insert ────────────────────────────────

async function insertRytualAudience(
  bq: BigQueryClient,
  clientId: string,
  lead: {
    email: string;
    full_name?: string;
    company?: string;
    company_domain?: string;
  },
): Promise<BranchResult> {
  const audienceId = crypto.randomUUID();
  const sql = `
    INSERT INTO ${qualified("rytual_audience")}
      (audience_id, client_id, email, full_name, company, company_domain,
       added_at, source)
    VALUES
      (@audienceId, @clientId, @email, @fullName, @company, @companyDomain,
       CURRENT_TIMESTAMP(), @source)
  `.trim();

  const params: Record<string, unknown> = {
    audienceId,
    clientId,
    email: lead.email,
    fullName: lead.full_name ?? null,
    company: lead.company ?? null,
    companyDomain: lead.company_domain ?? null,
    source: "clay_lead",
  };

  try {
    const write = await bq.executeWrite(sql, params);
    return {
      status: "added",
      audience_id: audienceId,
      num_rows: write.numDmlAffectedRows,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      "clay-lead.rytual.failed",
      err instanceof Error ? err : new Error(message),
    );
    return { status: "failed", error: message, audience_id: audienceId };
  }
}

// ── Router ──────────────────────────────────────────────────────────

/**
 * Router for the flagship Clay lead fan-out. Mount under /webhooks/clay so
 * the full path is /webhooks/clay/lead.
 */
export function createClayLeadRouter(): Router {
  const router = express.Router();
  router.use(express.json({ limit: "256kb" }));

  router.post(
    "/lead",
    requireClayIngestAuth,
    async (req: Request, res: Response) => {
      const parsed = ClayLeadPayload.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "invalid_payload",
          details: parsed.error.flatten(),
        });
      }
      const payload = parsed.data;
      const clientId = payload.tag ?? DEFAULT_CLIENT_ID;
      const lead = {
        email: payload.email,
        full_name: payload.full_name,
        company: payload.company,
        company_domain: payload.company_domain,
      };
      const bq = moduleBq();

      // Branch 1: DNC — the compliance gate. Evaluate before distribution.
      let dnc: BranchResult;
      let suppressed = false;
      try {
        const check = await checkDncByEmail(
          { email: lead.email, domain: lead.company_domain },
          { tenantId: clientId },
        );
        suppressed = check.suppressed;
        dnc = {
          status: "checked",
          suppressed: check.suppressed,
          reason: check.reason ?? null,
          matches: check.matches?.length ?? 0,
        };
      } catch (err) {
        // Fail-closed on DNC error: if we cannot verify DNC, do NOT distribute.
        const message = err instanceof Error ? err.message : String(err);
        logger.error(
          "clay-lead.dnc.failed",
          err instanceof Error ? err : new Error(message),
        );
        suppressed = true;
        dnc = { status: "error", suppressed: true, error: message };
      }

      // Branch 2: GCP insert — always record the lead.
      const gcp = await insertLeadToGcp(bq, clientId, lead);

      // Branch 3: Rytual — only when NOT suppressed.
      let rytual: BranchResult;
      if (suppressed) {
        rytual = { skipped: true, reason: "dnc_suppressed" };
      } else {
        rytual = await insertRytualAudience(bq, clientId, lead);
      }

      logger.info("clay-lead.fanout", {
        clientId,
        suppressed,
        gcpStatus: gcp.status,
        rytualStatus: (rytual.status as string) ?? "skipped",
      });

      return res.status(200).json({
        email: lead.email,
        client_id: clientId,
        dnc,
        gcp,
        rytual,
      });
    },
  );

  return router;
}
