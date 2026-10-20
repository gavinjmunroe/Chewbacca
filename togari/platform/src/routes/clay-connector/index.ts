/**
 * Universal Clay connector — one Togari endpoint a user drops onto ANY Clay
 * table as an HTTP API enrichment column. Zero per-table code: any row shape is
 * accepted, unknown tables auto-register, and the response is FLAT JSON so Clay
 * maps each top-level key straight back into a column.
 *
 * Endpoints (mounted at /clay/v1 by the server):
 *   POST /clay/v1/sync    — the universal action endpoint (ingest|dnc|upsert|enrich)
 *   GET  /clay/v1/schema  — self-describing action + field catalog (no auth)
 *   GET  /clay/v1/health  — reachability check
 *
 * Response contract: /sync ALWAYS answers HTTP 200 with a flat object. A bad
 * row or a per-action failure returns { ok: false, action, error } at 200 so a
 * single row never breaks the whole Clay column. Only a failed auth returns 401.
 */

import express, { Request, Response, Router } from "express";
import crypto from "crypto";
import { BigQueryClient } from "../../bigquery/client";
import { resolveDataset } from "../../services/dataset-resolver";
import { UniversalIngestService } from "../../ingest/universal/service";
import { V1Service } from "../../v1/service";
import { checkDncByEmail } from "../../dnc";
import { createLogger } from "../../observability/logger";
import { checkConnectorAuth } from "./auth";
import { registerTableIfNew } from "./registry";

const logger = createLogger("routes/clay-connector");

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";
const DEFAULT_CLIENT_ID = "bma";

type ConnectorAction = "ingest" | "dnc" | "upsert" | "enrich" | "client";
const KNOWN_ACTIONS: ConnectorAction[] = [
  "ingest",
  "dnc",
  "upsert",
  "enrich",
  "client",
];

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

/**
 * Resolve the canonical client_id. Precedence: explicit body client_id, then
 * the x-togari-client header, then "bma". (The auth token binding is a single
 * shared key here, so it carries no per-client identity to fall back on.)
 */
function resolveClientId(req: Request, body: Record<string, unknown>): string {
  const fromBody =
    typeof body.client_id === "string" ? body.client_id.trim() : "";
  if (fromBody) return fromBody;
  const fromHeader = (req.header("x-togari-client") || "").trim();
  if (fromHeader) return fromHeader;
  return DEFAULT_CLIENT_ID;
}

/** First non-empty string among the candidate row keys. */
function pick(
  row: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return undefined;
}

// ── action: ingest ─────────────────────────────────────────────────

async function doIngest(
  bq: BigQueryClient,
  clientId: string,
  tableKey: string,
  row: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const svc = new UniversalIngestService({ bq });
  const result = await svc.ingest({
    clientId,
    source: `clay:${tableKey}`,
    contentType: "json",
    rawJson: row,
  });
  const routedTotal =
    result.routed.contacts + result.routed.companies + result.routed.activities;
  return {
    // A partial failure (extracted > 0 but nothing routed) is reported as
    // ok:false so it never looks like a clean success in the Clay column.
    ok: result.routingErrors.length === 0,
    action: "ingest",
    togari_ingestion_id: result.ingestionId,
    extracted: result.extracted,
    routed_contacts: result.routed.contacts,
    routed_companies: result.routed.companies,
    routed_activities: result.routed.activities,
    routed_total: routedTotal,
    routing_errors: result.routingErrors.length,
    routing_error_detail: result.routingErrors.slice(0, 3).join(" | "),
    summary: result.summary,
  };
}

// ── action: dnc ────────────────────────────────────────────────────

async function doDnc(
  clientId: string,
  email: string,
  domain: string | undefined,
): Promise<Record<string, unknown>> {
  const check = await checkDncByEmail(
    { email, domain },
    { tenantId: clientId },
  );
  return {
    ok: true,
    action: "dnc",
    is_dnc: check.suppressed,
    dnc_reason: check.reason ?? "",
    matched: check.matches?.length ?? 0,
  };
}

// ── action: upsert ─────────────────────────────────────────────────

async function doUpsert(
  bq: BigQueryClient,
  clientId: string,
  row: Record<string, unknown>,
  email: string,
): Promise<Record<string, unknown>> {
  const fullName = pick(row, "full_name", "name");
  const company = pick(row, "company", "company_name");
  const title = pick(row, "title", "job_title");
  const emailKey = email.trim().toLowerCase();
  const togariId = crypto
    .createHash("sha256")
    .update(`${clientId}:${emailKey}`)
    .digest("hex");

  // Idempotent MERGE on LOWER(email), same natural-key pattern as the universal
  // ingest contact route. Only the row we present is written; unknown Clay
  // columns are ignored here (ingest is the path that captures the full row).
  // Columns match the real togari_structured_contacts schema (camelCase,
  // DealCloud-derived): workEmail/fullName/currentCompany/currentTitle.
  const sql = `
    MERGE ${qualified("togari_structured_contacts")} AS target
    USING (
      SELECT
        @rowId AS row_id,
        @email AS workEmail,
        @fullName AS fullName,
        @company AS currentCompany,
        @title AS currentTitle
    ) AS source
    ON LOWER(target.workEmail) = LOWER(source.workEmail)
    WHEN MATCHED THEN UPDATE SET
      fullName = source.fullName,
      currentCompany = source.currentCompany,
      currentTitle = source.currentTitle
    WHEN NOT MATCHED THEN INSERT
      (row_id, workEmail, fullName, currentCompany, currentTitle, createdAt)
      VALUES
      (source.row_id, source.workEmail, source.fullName, source.currentCompany,
       source.currentTitle, CURRENT_TIMESTAMP())
  `.trim();

  await bq.executeWrite(sql, {
    rowId: togariId,
    email,
    fullName: fullName ?? null,
    company: company ?? null,
    title: title ?? null,
  });

  return {
    ok: true,
    action: "upsert",
    togari_id: togariId,
    upserted: true,
  };
}

// ── action: client (V1 source of truth) ────────────────────────────

/** Row keys we map to first-class V1 client columns; everything else -> attributes. */
const CLIENT_MAPPED_KEYS = new Set([
  "name",
  "company",
  "company_name",
  "account",
  "lead",
  "full_name",
  "primary_email",
  "email",
  "work_email",
  "primary_domain",
  "domain",
  "company_domain",
  "website",
  "stage",
  "status_stage",
  "owner",
  "account_owner",
  "rep",
  "status",
  "summary",
  "notes",
]);

/**
 * Map an arbitrary Clay row into a V1 client (the source-of-truth table Sagar
 * lives in). Common columns become first-class fields; every unmapped column is
 * preserved in the flexible `attributes` JSON so nothing is dropped. Dedup +
 * merge is handled by V1Service (by email, then domain, then name).
 */
async function doClient(
  bq: BigQueryClient,
  clientId: string,
  tableKey: string,
  row: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const name = pick(row, "name", "company", "company_name", "account", "lead");
  if (!name) {
    return {
      ok: false,
      action: "client",
      error: "no name/company/account to identify the client",
    };
  }
  const email = pick(row, "primary_email", "email", "work_email");
  const domain = pick(
    row,
    "primary_domain",
    "domain",
    "company_domain",
    "website",
  );
  const stage = pick(row, "stage", "status_stage");
  const owner = pick(row, "owner", "account_owner", "rep");
  const status = pick(row, "status");
  const summary = pick(row, "summary", "notes");

  const attributes: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (
      !CLIENT_MAPPED_KEYS.has(k) &&
      v !== null &&
      v !== undefined &&
      v !== ""
    ) {
      attributes[k] = v;
    }
  }

  const svc = new V1Service({ bq });
  const { clientId: cid, operation } = await svc.upsertClient(
    {
      name,
      primaryEmail: email,
      primaryDomain: domain,
      stage,
      owner,
      status,
      summary,
      attributes: Object.keys(attributes).length ? attributes : undefined,
      source: `clay:${tableKey}`,
    },
    { tenant: { brand: clientId } },
  );

  return {
    ok: true,
    action: "client",
    togari_client_id: cid,
    operation,
  };
}

// ── Router ──────────────────────────────────────────────────────────

/**
 * Build the universal Clay connector router. The server mounts it at /clay/v1
 * so the full paths are /clay/v1/sync, /clay/v1/schema, /clay/v1/health.
 *
 * The router applies its OWN express.json() because it mounts before the global
 * body parser.
 */
export function createClayConnectorRouter(): Router {
  const router = express.Router();
  router.use(express.json({ limit: "512kb" }));

  // POST /clay/v1/sync — the universal drop-on-any-table endpoint.
  router.post("/sync", async (req: Request, res: Response) => {
    const auth = checkConnectorAuth(req);
    if (!auth.ok) {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const body: Record<string, unknown> =
      req.body && typeof req.body === "object" ? req.body : {};

    // Control fields may arrive in the URL query OR the JSON body. Clay's HTTP
    // API column commonly pins static controls (like action) in the URL and
    // maps row columns into the body, so we accept either. Query wins.
    const q = (name: string): string =>
      typeof req.query[name] === "string" ? String(req.query[name]).trim() : "";

    // Control fields are pulled out; everything else is the Clay row itself.
    const rawAction = (
      q("action") || (typeof body.action === "string" ? body.action.trim() : "")
    ).toLowerCase();
    const action: ConnectorAction = KNOWN_ACTIONS.includes(
      rawAction as ConnectorAction,
    )
      ? (rawAction as ConnectorAction)
      : "ingest";

    const clientId = q("client_id") || resolveClientId(req, body);
    const tableKey =
      q("table") ||
      (typeof body.table === "string" && body.table.trim() !== ""
        ? body.table.trim()
        : "unknown");

    const bq = moduleBq();

    // Auto-register the table. Best-effort; never blocks the action.
    await registerTableIfNew(bq, { tableKey, clientId });

    // The Clay row is the body minus the control fields.
    const { action: _a, table: _t, client_id: _c, ...row } = body;

    // email/domain resolution for dnc + upsert (body overrides, then row).
    const email =
      q("email") ||
      (typeof body.email === "string" && body.email.trim()) ||
      pick(row, "email", "work_email") ||
      "";
    const domain =
      q("domain") ||
      (typeof body.domain === "string" && body.domain.trim()) ||
      pick(row, "domain", "company_domain") ||
      undefined;

    try {
      let payload: Record<string, unknown>;

      switch (action) {
        case "dnc": {
          if (!email) {
            payload = {
              ok: false,
              action,
              error: "no email or domain to check",
            };
            break;
          }
          payload = await doDnc(clientId, email, domain);
          break;
        }
        case "upsert": {
          if (!email) {
            payload = { ok: false, action, error: "email required for upsert" };
            break;
          }
          payload = await doUpsert(bq, clientId, row, email);
          break;
        }
        case "enrich": {
          // Real combination: run DNC then ingest, merge the flat fields.
          const dncFields = email
            ? await doDnc(clientId, email, domain)
            : { is_dnc: false, dnc_reason: "", matched: 0 };
          const ingestFields = await doIngest(bq, clientId, tableKey, row);
          payload = {
            ...ingestFields,
            action: "enrich",
            enrich: "combined",
            is_dnc: dncFields.is_dnc,
            dnc_reason: dncFields.dnc_reason,
            matched: dncFields.matched,
          };
          break;
        }
        case "client": {
          payload = await doClient(bq, clientId, tableKey, row);
          break;
        }
        case "ingest":
        default: {
          payload = await doIngest(bq, clientId, tableKey, row);
          break;
        }
      }

      logger.info("clay-connector.sync", {
        clientId,
        tableKey,
        action,
        ok: payload.ok === true,
      });

      return res
        .status(200)
        .json({ table: tableKey, client_id: clientId, ...payload });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        "clay-connector.sync.failed",
        err instanceof Error ? err : new Error(message),
        { clientId, tableKey, action },
      );
      // Still 200 so one bad row does not break the Clay column.
      return res.status(200).json({
        ok: false,
        action,
        table: tableKey,
        client_id: clientId,
        error: message,
      });
    }
  });

  // GET /clay/v1/schema — self-describing catalog (no auth so it is discoverable).
  router.get("/schema", (_req: Request, res: Response) => {
    return res.status(200).json({
      service: "togari-clay-connector",
      endpoint: "/clay/v1/sync",
      method: "POST",
      auth: "Authorization: Bearer <CLAY_CONNECTOR_KEY> | X-Togari-Key header | ?token=",
      recommended:
        'For the CRM source of truth, use action "client": each Clay row becomes a client in Togari (deduped by email, then domain, then name). Only "name" is required; any extra fields are stored on the client automatically.',
      example_request: {
        method: "POST",
        url: "/clay/v1/sync",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer <your key>",
        },
        body: {
          action: "client",
          name: "Acme Inc",
          primary_email: "jane@acme.com",
          primary_domain: "acme.com",
          stage: "Discovery",
          notes: "met at conference",
        },
      },
      control_fields: {
        action: `one of ${KNOWN_ACTIONS.join(", ")} (default "ingest")`,
        table:
          "optional Clay table name, used for auto-registration and lineage",
        client_id: 'optional tenant, defaults to "bma"',
        email:
          "optional explicit email, else read from row.email / row.work_email",
        domain:
          "optional explicit domain, else read from row.domain / row.company_domain",
      },
      actions: [
        {
          action: "ingest",
          inputs: "any Clay row (stored raw, then extracted + routed)",
          returns: [
            "ok",
            "togari_ingestion_id",
            "extracted",
            "routed_contacts",
            "routed_companies",
            "routed_activities",
            "summary",
          ],
        },
        {
          action: "dnc",
          inputs:
            "email (body.email or row.email/row.work_email), optional domain",
          returns: ["ok", "is_dnc", "dnc_reason", "matched"],
        },
        {
          action: "client",
          inputs:
            "any Clay row; maps name/company + primary_email + primary_domain + stage + owner + status + summary, and stores every other column on the client. Only name (or company) is required.",
          returns: ["ok", "togari_client_id", "operation"],
        },
        {
          action: "upsert",
          inputs: "email + optional full_name/name, company, title",
          returns: ["ok", "togari_id", "upserted"],
        },
        {
          action: "enrich",
          inputs: "any Clay row with an email — runs dnc + ingest combined",
          returns: [
            "ok",
            "enrich",
            "is_dnc",
            "dnc_reason",
            "matched",
            "togari_ingestion_id",
            "extracted",
          ],
        },
      ],
    });
  });

  // GET /clay/v1/health — reachability. Auth-light: reports service liveness.
  router.get("/health", (_req: Request, res: Response) => {
    return res.status(200).json({ ok: true, service: "togari-clay-connector" });
  });

  return router;
}
