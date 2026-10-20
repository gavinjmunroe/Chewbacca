/**
 * ProvisionService — one-prompt per-client warehouse provisioning.
 *
 * "Joe, these are your pipelines, these are the data points you want, done."
 * Describe a client in natural language and this service sets up their
 * warehouse structure: pipelines + ordered stages (rows in pipeline_stages)
 * and custom data-point fields (rows via SchemaRegistry). No DDL is ever
 * emitted; everything is additive rows.
 *
 * Two entry points:
 *   - preview(): plan only, zero writes.
 *   - provision(): plan, then persist, idempotently.
 *
 * Idempotency:
 *   - Stages: for each pipeline we read the existing stage names for that
 *     (client_id, pipeline) and only INSERT the stages not already present.
 *   - Fields: SchemaRegistry.defineField is itself idempotent (returns the
 *     existing field_id without writing when the def already exists).
 *
 * Defensive: per-item errors are caught and logged; only successful writes are
 * counted, so one bad stage or field never aborts the whole provision.
 */

import crypto from "crypto";
import { BigQueryClient } from "../bigquery/client";
import { resolveDataset } from "../services/dataset-resolver";
import { SchemaRegistry } from "../schema/registry";
import { createLogger } from "../observability/logger";
import { planClientWarehouse } from "./planner";
import type { ProvisionPlan, ProvisionResult } from "./types";

const logger = createLogger("provision/service");

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";

function stagesTable(): string {
  return `\`${PROJECT_ID}.${resolveDataset()}.pipeline_stages\``;
}

export interface ProvisionInput {
  clientId: string;
  description: string;
  /**
   * True when the caller explicitly named the client (client_id or client_name
   * arg). When false, the service auto-derives an isolated client_id from the
   * client name the planner extracts, so "provision a client named X" never
   * pollutes the token's tenant.
   */
  clientExplicit?: boolean;
}

/** Slugify a client display name into a stable client_id. */
function slugifyClientId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

export class ProvisionService {
  private bq: BigQueryClient;
  private schema: SchemaRegistry;

  constructor(deps: { bq: BigQueryClient }) {
    this.bq = deps.bq;
    this.schema = new SchemaRegistry({ bq: deps.bq });
  }

  /**
   * Resolve the effective client_id: an explicit caller-provided id wins;
   * otherwise, if the planner identified a client name in the description,
   * slugify it into an isolated client_id so the client's warehouse never lands
   * in the token's tenant.
   */
  private effectiveClientId(
    requestedClientId: string,
    plan: ProvisionPlan,
    clientExplicit: boolean,
  ): string {
    if (clientExplicit) return requestedClientId;
    if (plan.clientName) {
      const slug = slugifyClientId(plan.clientName);
      if (slug) return slug;
    }
    return requestedClientId;
  }

  /** Plan the client's warehouse without writing anything. */
  async preview(input: ProvisionInput): Promise<ProvisionPlan> {
    const requestedClientId = input.clientId?.trim() || "bma";
    const plan = await planClientWarehouse({
      clientId: requestedClientId,
      description: input.description,
    });
    plan.clientId = this.effectiveClientId(
      requestedClientId,
      plan,
      input.clientExplicit === true,
    );
    return plan;
  }

  /**
   * Plan then persist the client's warehouse structure. Idempotent and
   * defensive: skips stages that already exist, relies on SchemaRegistry for
   * field idempotency, and counts only successful writes.
   */
  async provision(input: ProvisionInput): Promise<ProvisionResult> {
    const requestedClientId = input.clientId?.trim() || "bma";
    const plan = await planClientWarehouse({
      clientId: requestedClientId,
      description: input.description,
    });
    // Auto-isolate the client's warehouse when the caller did not explicitly
    // name a client id (e.g. "provision a client named Northwind Ventures").
    const clientId = this.effectiveClientId(
      requestedClientId,
      plan,
      input.clientExplicit === true,
    );
    plan.clientId = clientId;

    let stagesCreated = 0;
    const stageErrors: string[] = [];
    for (const pipeline of plan.pipelines) {
      try {
        stagesCreated += await this.seedStages(
          clientId,
          pipeline.name,
          pipeline.stages,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        stageErrors.push(`${pipeline.name}: ${msg}`);
        logger.error(
          "provision.stages.failed",
          err instanceof Error ? err : new Error(msg),
          { clientId, pipeline: pipeline.name },
        );
      }
    }

    let fieldsCreated = 0;
    for (const field of plan.fields) {
      try {
        const { created } = await this.schema.defineField({
          clientId,
          entity: field.entity,
          fieldName: field.fieldName,
          fieldType: field.fieldType,
          description: field.description,
        });
        if (created) fieldsCreated += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(
          "provision.field.failed",
          err instanceof Error ? err : new Error(msg),
          { clientId, entity: field.entity, fieldName: field.fieldName },
        );
      }
    }

    logger.info("provision.done", {
      clientId,
      stagesCreated,
      fieldsCreated,
      pipelines: plan.pipelines.length,
      fields: plan.fields.length,
    });

    return { clientId, stagesCreated, fieldsCreated, plan, stageErrors };
  }

  /**
   * Seed one pipeline's stages, skipping any whose stage_name already exists
   * for this (client_id, pipeline). Returns the number of new stage rows
   * inserted. A single multi-row INSERT is used for the missing stages.
   */
  private async seedStages(
    clientId: string,
    pipeline: string,
    stages: ProvisionPlan["pipelines"][number]["stages"],
  ): Promise<number> {
    if (stages.length === 0) return 0;

    const existing = await this.existingStageNames(clientId, pipeline);
    const toInsert = stages.filter(
      (s) => !existing.has(s.name.trim().toLowerCase()),
    );
    if (toInsert.length === 0) return 0;

    const valuesSql = toInsert
      .map((_, i) => {
        const n = i + 1;
        return `(@stageId${n}, @clientId, @stageName${n}, @pipeline, @stageOrder${n}, @stageDesc${n}, TRUE, NULL, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`;
      })
      .join(",\n        ");

    const params: Record<string, unknown> = { clientId, pipeline };
    toInsert.forEach((stage, i) => {
      const n = i + 1;
      params[`stageId${n}`] = crypto.randomUUID();
      params[`stageName${n}`] = stage.name;
      params[`stageOrder${n}`] = stage.order;
      params[`stageDesc${n}`] = stage.description ?? null;
    });

    const insertSql = `
      INSERT INTO ${stagesTable()}
        (stage_id, client_id, stage_name, pipeline, stage_order, description, is_active, auto_rules, created_at, updated_at)
      VALUES
        ${valuesSql}
    `.trim();

    await this.bq.executeWrite(insertSql, params);

    logger.info("provision.stages.seeded", {
      clientId,
      pipeline,
      inserted: toInsert.length,
    });

    return toInsert.length;
  }

  /** Fetch the set of existing stage_names for a (client_id, pipeline). */
  private async existingStageNames(
    clientId: string,
    pipeline: string,
  ): Promise<Set<string>> {
    const sql = `
      SELECT stage_name
        FROM ${stagesTable()}
       WHERE client_id = @clientId
         AND pipeline = @pipeline
    `.trim();
    const { rows } = await this.bq.executeQuery(sql, { clientId, pipeline });
    const names = new Set<string>();
    for (const r of rows) {
      const name = (r as { stage_name?: unknown }).stage_name;
      if (typeof name === "string") names.add(name.trim().toLowerCase());
    }
    return names;
  }
}
