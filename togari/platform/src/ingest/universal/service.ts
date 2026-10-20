/**
 * Universal ingestion — orchestration service.
 *
 * The heart of Togari as a lakehouse. One entry point, `ingest`, that:
 *   1. ALWAYS stores the raw submission first (raw is the source of truth).
 *   2. Normalizes the payload (CSV / JSON / XLSX -> records, else text).
 *   3. Extracts structured entities via Claude (best-effort, never fatal).
 *   4. ROUTES each entity into the existing pipeline / CRM tables:
 *        contact          -> togari_structured_contacts
 *        company          -> togari_companies
 *        activity         -> activities
 *        task / fact      -> activities (type 'task' / 'note')
 *        pipeline_update  -> activities (type 'pipeline_update')
 *   5. Marks the raw row 'processed' with the extracted count.
 *
 * Routing is defensive per-entity: a bad row or a missing table is caught and
 * counted as skipped so one failure never poisons the batch. The raw is never
 * lost regardless of what happens downstream.
 */

import crypto from "crypto";
import { BigQueryClient } from "../../bigquery/client";
import { resolveDataset } from "../../services/dataset-resolver";
import { createLogger } from "../../observability/logger";
import { storeRaw, setStatus } from "./raw-store";
import { normalizePayload } from "./parsers";
import { extractEntities } from "./extractor";
import type { ExtractedEntity, IngestInput } from "./types";
import { createDeal, searchDeal, updateDeal } from "../../core/tools/deal-ops";
import { normalizeStage } from "../../core/config/stage-aliases";

const logger = createLogger("ingest/universal/service");

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";
const SOURCE_FILE = "universal_ingest";

function qualified(table: string): string {
  return `\`${PROJECT_ID}.${resolveDataset()}.${table}\``;
}

export interface IngestServiceDeps {
  bq: BigQueryClient;
}

export interface RoutedCounts {
  contacts: number;
  companies: number;
  activities: number;
  deals: number;
}

export interface IngestResult {
  ingestionId: string;
  extracted: number;
  routed: RoutedCounts;
  routingErrors: string[];
  summary: string;
}

export class UniversalIngestService {
  private bq: BigQueryClient;

  constructor(deps: IngestServiceDeps) {
    this.bq = deps.bq;
  }

  async ingest(input: IngestInput): Promise<IngestResult> {
    // (a) Preserve the raw submission FIRST. This must always succeed.
    const { ingestionId } = await storeRaw(this.bq, input);

    // (b) Normalize the payload into records or text.
    const parsed = normalizePayload({
      contentType: input.contentType,
      rawText: input.rawText,
      rawJson: input.rawJson,
    });

    // (c) Extract structured entities (best-effort).
    let extraction;
    try {
      extraction = await extractEntities({
        text: parsed.text,
        records: parsed.records,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        "extraction failed — raw preserved, marking processed with 0 entities",
        err instanceof Error ? err : new Error(message),
        { ingestionId },
      );
      extraction = { entities: [] as ExtractedEntity[], summary: "" };
    }

    // (d) Route entities into the CRM / pipeline tables. Routing failures are
    // NOT silently swallowed: they are collected, logged at error level, and
    // returned to the caller so a total failure can never masquerade as an
    // ok:true / routed:0 success.
    const routed: RoutedCounts = {
      contacts: 0,
      companies: 0,
      activities: 0,
      deals: 0,
    };
    const routingErrors: string[] = [];
    const importRunId = crypto.randomUUID();

    for (const entity of extraction.entities) {
      try {
        await this.routeEntity(input.clientId, entity, importRunId);
        if (entity.kind === "contact") routed.contacts += 1;
        else if (entity.kind === "company") routed.companies += 1;
        else if (entity.kind === "deal") routed.deals += 1;
        else routed.activities += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        routingErrors.push(`${entity.kind}: ${message}`);
        logger.error(
          "entity routing failed",
          err instanceof Error ? err : new Error(message),
          { ingestionId, kind: entity.kind },
        );
      }
    }

    // (e) Mark the raw row processed with the extracted count.
    try {
      await setStatus(
        this.bq,
        ingestionId,
        "processed",
        extraction.entities.length,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn("setStatus failed", { ingestionId, error: message });
    }

    logger.info("universal ingest complete", {
      ingestionId,
      extracted: extraction.entities.length,
      routed,
    });

    return {
      ingestionId,
      extracted: extraction.entities.length,
      routed,
      routingErrors,
      summary: extraction.summary,
    };
  }

  private async routeEntity(
    clientId: string,
    entity: ExtractedEntity,
    importRunId: string,
  ): Promise<void> {
    switch (entity.kind) {
      case "contact":
        return this.routeContact(clientId, entity, importRunId);
      case "company":
        return this.routeCompany(clientId, entity);
      case "activity":
        return this.routeActivity(clientId, entity.type, entity.content);
      case "task":
        return this.routeActivity(clientId, "task", entity.content);
      case "fact":
        return this.routeActivity(
          clientId,
          "note",
          `${entity.subject}: ${entity.statement}`,
        );
      case "deal":
        return this.routeDeal(entity);
      case "pipeline_update":
        return this.routePipelineUpdate(clientId, entity);
      default:
        return;
    }
  }

  /**
   * Create a deal from an ingested submission via the canonical createDeal
   * path (same writer the MCP create_deal tool uses), so ingestion actually
   * lands opportunities in the pipeline — not just activity rows. createDeal
   * derives its own bma_deal_<company>_<date> id and client_brand, so the
   * ingest clientId is not threaded in here by design.
   */
  private async routeDeal(
    entity: Extract<ExtractedEntity, { kind: "deal" }>,
  ): Promise<void> {
    const company = (entity.company ?? "").trim();
    if (!company) throw new Error("deal entity missing company");
    await createDeal({
      company,
      value: entity.value,
      stage: entity.stage,
      pipeline: entity.pipeline,
      contactName: entity.contact_name,
      contactEmail: entity.contact_email,
      notes: entity.notes ?? "Created via universal ingest",
    });
  }

  /**
   * A pipeline_update means an existing deal changed stage. If we can find a
   * matching deal by company name and the update carries a resolvable target
   * stage, move it for real; otherwise fall back to logging the intent as an
   * activity so nothing is lost.
   */
  private async routePipelineUpdate(
    clientId: string,
    entity: Extract<ExtractedEntity, { kind: "pipeline_update" }>,
  ): Promise<void> {
    const targetStage = entity.to_stage
      ? normalizeStage(entity.to_stage)
      : null;

    if (targetStage) {
      try {
        const deal = await searchDeal(entity.company_or_deal);
        if (deal?.deal_id) {
          await updateDeal(deal.deal_id, { stage: targetStage });
          return;
        }
      } catch (err) {
        logger.warn("pipeline_update: deal move failed, logging activity", {
          company_or_deal: entity.company_or_deal,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return this.routeActivity(
      clientId,
      "pipeline_update",
      entity.to_stage
        ? `${entity.company_or_deal} -> ${entity.to_stage}`
        : entity.company_or_deal,
    );
  }

  private async routeContact(
    clientId: string,
    entity: Extract<ExtractedEntity, { kind: "contact" }>,
    importRunId: string,
  ): Promise<void> {
    const emailKey = (entity.email ?? "").trim().toLowerCase();
    const rowId = crypto
      .createHash("sha256")
      .update(`${clientId}:${emailKey}`)
      .digest("hex");

    // Columns match the real togari_structured_contacts schema (camelCase,
    // DealCloud-derived): workEmail/fullName/currentCompany/currentTitle.
    void importRunId;
    const sql = `
      INSERT INTO ${qualified("togari_structured_contacts")}
        (row_id, workEmail, fullName, currentCompany, currentTitle, phone, createdAt)
      VALUES
        (@rowId, @email, @fullName, @company, @title, @phone, CURRENT_TIMESTAMP())
    `.trim();

    await this.bq.executeWrite(sql, {
      rowId,
      email: entity.email ?? null,
      fullName: entity.full_name ?? null,
      company: entity.company ?? null,
      title: entity.title ?? null,
      phone: entity.phone ?? null,
    });
  }

  private async routeCompany(
    clientId: string,
    entity: Extract<ExtractedEntity, { kind: "company" }>,
  ): Promise<void> {
    const companyId = crypto.randomUUID();
    // Columns match the real togari_companies schema. There is no industry
    // column, so industry lands in notes.
    const sql = `
      INSERT INTO ${qualified("togari_companies")}
        (company_id, client_id, name, domain, notes,
         created_at, first_seen_at, last_seen_at)
      VALUES
        (@companyId, @clientId, @name, @domain, @industry,
         CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
    `.trim();

    await this.bq.executeWrite(sql, {
      companyId,
      clientId,
      name: entity.name ?? null,
      domain: entity.domain ?? null,
      industry: entity.industry ?? null,
    });
  }

  private async routeActivity(
    clientId: string,
    type: string,
    content: string,
  ): Promise<void> {
    const activityId = crypto.randomUUID();
    const sql = `
      INSERT INTO ${qualified("activities")}
        (activity_id, client_id, type, content, timestamp)
      VALUES
        (@activityId, @clientId, @type, @content, CURRENT_TIMESTAMP())
    `.trim();

    await this.bq.executeWrite(sql, {
      activityId,
      clientId,
      type,
      content,
    });
  }
}
