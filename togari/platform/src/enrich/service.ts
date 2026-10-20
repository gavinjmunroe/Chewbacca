/**
 * EnrichService — the Clay-killer AI enrichment engine for Togari.
 *
 * "Structure data where it doesn't exist." Two modes:
 *
 *   enrich()    — load a CRM record for context, run an AI research pass
 *                 (optionally grounded on the open web via Exa), parse the
 *                 model's STRICT-JSON field list, and write each field back
 *                 onto the record through the SchemaRegistry (metadata-backed
 *                 custom fields, never a physical column). This is the
 *                 "add an AI column that researches and structures data"
 *                 feature.
 *
 *   structure() — freeform: given just a prompt (and optional raw text),
 *                 return structured fields without a target record. Writes
 *                 nothing. Mirrors Clay's "structure this blob" without a CRM
 *                 row to land on.
 *
 * The Anthropic call mirrors src/core/tools/email-ops.ts draftReply exactly:
 * fetch /v1/messages, x-api-key + anthropic-version headers, SONNET model,
 * parse JSON out of the text content (stripping ```json fences). Missing
 * ANTHROPIC_API_KEY is a safe no-op that returns an empty result with a note.
 *
 * Tenancy: client_id is canonical (default "bma").
 */

import { BigQueryClient } from "../bigquery/client";
import { resolveDataset } from "../services/dataset-resolver";
import { createLogger } from "../observability/logger";
import { SONNET } from "../config/models";
import { SchemaRegistry } from "../schema/registry";
import { exaAnswer } from "../integrations/exa/client";
import type { EnrichedField, EnrichResult } from "./types";

const logger = createLogger("enrich/service");

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";

/** Value types the SchemaRegistry can persist through setValue(). */
const PERSISTABLE_TYPES = ["string", "number", "date", "bool", "json"] as const;

/**
 * Upper bound on the Exa web-grounding step. Chosen well under any MCP
 * client's idle/read timeout so a slow Exa call degrades enrichment to
 * context-only instead of dropping the transport.
 */
const WEB_GROUNDING_TIMEOUT_MS = 12_000;

export type EnrichEntity = "deal" | "contact" | "company";

export interface EnrichInput {
  clientId: string;
  entity: EnrichEntity;
  entityId: string;
  prompt: string;
  useWeb?: boolean;
}

export interface StructureInput {
  prompt: string;
  text?: string;
}

function tableRef(table: string): string {
  return `\`${PROJECT_ID}.${resolveDataset()}.${table}\``;
}

/** Coerce an unknown JSON value into a persistable primitive for SchemaRegistry. */
function toPrimitive(value: unknown): string | number | boolean {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  // Objects / arrays / null are stored as their JSON string form.
  return JSON.stringify(value ?? null);
}

/** Normalize the model's raw field object into a typed EnrichedField, or null. */
function coerceField(raw: unknown): EnrichedField | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (!name) return null;
  if (r.value === undefined || r.value === null) return null;

  const declared = typeof r.type === "string" ? r.type.toLowerCase() : "string";
  const type = (PERSISTABLE_TYPES as readonly string[]).includes(declared)
    ? (declared as EnrichedField["type"])
    : "string";

  const field: EnrichedField = {
    name,
    value: toPrimitive(r.value),
    type,
  };
  if (typeof r.confidence === "number") field.confidence = r.confidence;
  if (typeof r.source === "string") field.source = r.source;
  return field;
}

/** Parse the model's text output into { fields, summary }, tolerant of fences. */
function parseModelJson(rawText: string): {
  fields: EnrichedField[];
  summary: string;
} {
  const cleaned = rawText
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { fields: [], summary: "Model did not return valid JSON." };
  }
  const obj = (parsed ?? {}) as Record<string, unknown>;
  const rawFields = Array.isArray(obj.fields) ? obj.fields : [];
  const fields = rawFields
    .map(coerceField)
    .filter((f): f is EnrichedField => f !== null);
  const summary =
    typeof obj.summary === "string" && obj.summary.trim()
      ? obj.summary.trim()
      : "";
  return { fields, summary };
}

export class EnrichService {
  private bq: BigQueryClient;
  private registry: SchemaRegistry;

  constructor(deps: { bq: BigQueryClient }) {
    this.bq = deps.bq;
    this.registry = new SchemaRegistry({ bq: deps.bq });
  }

  /**
   * Load the target record so the model has grounding context. Best-effort:
   * any error (missing table, no row) resolves to {} so enrichment still runs.
   */
  private async loadEntityContext(
    clientId: string,
    entity: EnrichEntity,
    entityId: string,
  ): Promise<Record<string, unknown>> {
    try {
      let sql: string;
      const params: Record<string, unknown> = { clientId, id: entityId };

      if (entity === "deal") {
        // A BMA operator's token scopes to the org (client_brand='bma') while
        // each deal's client_id is the specific client. Match on either so an
        // org-scoped caller can reach its client deals and a client-scoped
        // caller reaches its own.
        sql = `
          SELECT deal_id, deal_name, company, stage, pipeline, notes,
                 contact_email, contact_full_name, value, close_date,
                 next_action, next_action_date, owner
            FROM ${tableRef("togari_structured_deals")}
           WHERE deal_id = @id
             AND (client_brand = @clientId OR client_id = @clientId)
           LIMIT 1
        `.trim();
      } else if (entity === "contact") {
        // entityId may be a row_id OR a workEmail — accept either.
        sql = `
          SELECT row_id, fullName, workEmail, currentCompany, currentTitle
            FROM ${tableRef("togari_structured_contacts")}
           WHERE client_id = @clientId
             AND (row_id = @id OR LOWER(workEmail) = LOWER(@id))
           LIMIT 1
        `.trim();
      } else {
        sql = `
          SELECT company_id, name, domain, industry, description
            FROM ${tableRef("togari_companies")}
           WHERE company_id = @id OR LOWER(name) = LOWER(@id)
           LIMIT 1
        `.trim();
      }

      const { rows } = await this.bq.executeQuery(sql, params);
      if (!rows.length) return {};
      return rows[0] as Record<string, unknown>;
    } catch (err) {
      logger.warn("enrich.context.load_failed", {
        entity,
        entityId,
        error: err instanceof Error ? err.message : String(err),
      });
      return {};
    }
  }

  /**
   * Best-effort web grounding via Exa. Empty string when unavailable.
   *
   * Hard-bounded by WEB_GROUNDING_TIMEOUT_MS: Exa's /answer with internal
   * retries can run tens of seconds, and a synchronous MCP tool call that
   * blocks that long severs the streamable-HTTP transport. Racing the call
   * against a timeout guarantees enrichment degrades to context-only rather
   * than killing the connection.
   */
  private async webGrounding(query: string): Promise<string> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const grounding = exaAnswer({ query, text: false }).then(
        (res) => res.answer?.trim() ?? "",
      );
      const timeout = new Promise<string>((resolve) => {
        timer = setTimeout(() => {
          logger.warn("enrich.web.grounding_timed_out", {
            timeoutMs: WEB_GROUNDING_TIMEOUT_MS,
          });
          resolve("");
        }, WEB_GROUNDING_TIMEOUT_MS);
      });
      return await Promise.race([grounding, timeout]);
    } catch (err) {
      logger.warn("enrich.web.grounding_skipped", {
        error: err instanceof Error ? err.message : String(err),
      });
      return "";
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Run the Anthropic research pass. Returns parsed fields + summary. */
  private async runModel(params: {
    contextBlock: string;
    webBlock: string;
    request: string;
  }): Promise<{ fields: EnrichedField[]; summary: string; note?: string }> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return {
        fields: [],
        summary: "",
        note: "ANTHROPIC_API_KEY not set; enrichment skipped.",
      };
    }

    const system = `You are a data enrichment engine. Given a record CONTEXT and optional WEB RESEARCH, answer the user's ENRICHMENT REQUEST by returning STRICT JSON and nothing else:
{ "fields": [ { "name": "<snake_case>", "value": <string|number|boolean>, "type": "string"|"number"|"date"|"bool"|"json", "confidence": <0..1>, "source": "<where the value came from>" } ], "summary": "<one line>" }
Only include fields you can actually support from the CONTEXT or WEB RESEARCH. Do NOT invent values. Use snake_case field names. Dates as ISO strings with type "date". If you cannot support any field, return { "fields": [], "summary": "..." }.`;

    const userPrompt = `CONTEXT:
${params.contextBlock || "(none)"}

WEB RESEARCH:
${params.webBlock || "(none)"}

ENRICHMENT REQUEST:
${params.request}`;

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: SONNET,
          max_tokens: 2048,
          system,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Anthropic API ${response.status}: ${errorBody}`);
      }

      const data = (await response.json()) as any;
      const rawText: string = (data.content ?? [])
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("");

      const { fields, summary } = parseModelJson(rawText);
      return { fields, summary };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(
        "enrich.model.failed",
        err instanceof Error ? err : new Error(message),
      );
      return {
        fields: [],
        summary: "",
        note: `Enrichment model call failed: ${message}`,
      };
    }
  }

  /**
   * Enrich a specific CRM record: research, structure, and write fields back.
   */
  async enrich(input: EnrichInput): Promise<EnrichResult> {
    const context = await this.loadEntityContext(
      input.clientId,
      input.entity,
      input.entityId,
    );
    const contextBlock = Object.keys(context).length
      ? JSON.stringify(context, null, 2)
      : "";

    // Derive a human name for the entity to sharpen the web query.
    const entityName =
      (context.deal_name as string) ||
      (context.fullName as string) ||
      (context.name as string) ||
      (context.company as string) ||
      input.entityId;

    let webBlock = "";
    if (input.useWeb) {
      const query = `${input.prompt} for ${entityName}`.trim();
      webBlock = await this.webGrounding(query);
    }

    const { fields, summary, note } = await this.runModel({
      contextBlock,
      webBlock,
      request: input.prompt,
    });

    let written = 0;
    for (const field of fields) {
      try {
        await this.registry.setValue({
          clientId: input.clientId,
          entity: input.entity,
          entityId: input.entityId,
          fieldName: field.name,
          value: field.value,
        });
        written += 1;
      } catch (err) {
        logger.warn("enrich.write.field_failed", {
          field: field.name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info("enrich.done", {
      clientId: input.clientId,
      entity: input.entity,
      entityId: input.entityId,
      found: fields.length,
      written,
      usedWeb: input.useWeb === true && webBlock.length > 0,
    });

    return {
      entity: input.entity,
      entityId: input.entityId,
      fields,
      written,
      summary: summary || `Enriched ${written} field(s).`,
      costNote: note,
    };
  }

  /**
   * Freeform "structure this data" mode: no entity target, writes nothing.
   */
  async structure(input: StructureInput): Promise<EnrichResult> {
    const request = input.text
      ? `${input.prompt}\n\nTEXT TO STRUCTURE:\n${input.text}`
      : input.prompt;

    const { fields, summary, note } = await this.runModel({
      contextBlock: "",
      webBlock: "",
      request,
    });

    logger.info("enrich.structure.done", { found: fields.length });

    return {
      fields,
      written: 0,
      summary: summary || `Structured ${fields.length} field(s).`,
      costNote: note,
    };
  }
}
