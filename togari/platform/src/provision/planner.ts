/**
 * Natural-language warehouse planner.
 *
 * Turns a sentence about a client into a strict ProvisionPlan: the pipelines,
 * ordered stages, and custom data-point fields that client wants tracked. The
 * planner NEVER writes anything; it only produces the plan. The service layer
 * decides what to persist.
 *
 * Planning uses Claude (Sonnet) via the Anthropic Messages API, mirroring the
 * fetch pattern in src/core/tools/email-ops.ts (draftReply). When
 * ANTHROPIC_API_KEY is missing, or the model's JSON cannot be parsed, we fall
 * back to a safe default plan so provisioning never hard-fails on planning.
 */

import { SONNET } from "../config/models";
import { createLogger } from "../observability/logger";
import type {
  ProvisionPlan,
  ProvisionPipeline,
  ProvisionField,
  ProvisionFieldType,
} from "./types";

const logger = createLogger("provision/planner");

const VALID_FIELD_TYPES: readonly ProvisionFieldType[] = [
  "string",
  "number",
  "date",
  "bool",
  "json",
];

const VALID_ENTITIES = ["deal", "contact", "company"] as const;

const PLANNER_SYSTEM_PROMPT = `You are the warehouse architect for Togari, a data platform for professional services firms.

Given a natural-language description of a client and what they do, design their warehouse structure: the pipelines they run, the ordered stages within each pipeline, and the custom data-point fields they want to track.

Rules:
- Choose sensible, client-specific pipelines. Most firms have 1-3 pipelines (e.g. "media outreach", "retainer clients", "inbound", "outbound").
- Each pipeline has ordered stages numbered from 1. Use canonical deal stages (lead, qualified, proposal_sent, negotiation, in_progress, closed_won) where they fit, but rename them to the client's language when the description implies it (e.g. a PR firm might use pitched -> placed -> published).
- Custom fields attach to one entity: "deal", "contact", or "company". Pick the most natural entity for each data point (a journalist is a contact; an embargo date is a deal).
- Field types must be one of: string, number, date, bool, json.
- Keep field names short and human ("outlet", "embargo_date", "angle"). Do not invent fields the description does not imply.

Also identify the client's display name from the description (e.g. "provision a client named Northwind Ventures" -> "Northwind Ventures"). Return it as client_name. If no specific client is named, return an empty string.

Return ONLY valid JSON with this exact shape (no prose, no markdown fences):
{
  "client_name": string,
  "pipelines": [
    { "name": string, "stages": [ { "name": string, "order": number, "description"?: string } ] }
  ],
  "fields": [
    { "entity": "deal" | "contact" | "company", "fieldName": string, "fieldType": "string" | "number" | "date" | "bool" | "json", "description"?: string }
  ],
  "notes"?: string
}`;

/**
 * A conservative default plan used when Claude is unavailable or returns
 * unparseable output. One "clients" pipeline with lead -> active -> closed and
 * a couple of generic string fields, so provisioning still produces a usable
 * baseline warehouse.
 */
export function defaultPlan(clientId: string): ProvisionPlan {
  return {
    clientId,
    pipelines: [
      {
        name: "clients",
        stages: [
          { name: "lead", order: 1 },
          { name: "active", order: 2 },
          { name: "closed", order: 3 },
        ],
      },
    ],
    fields: [
      { entity: "deal", fieldName: "source", fieldType: "string" },
      { entity: "contact", fieldName: "role", fieldType: "string" },
    ],
    notes: "Default baseline plan (no model output available).",
  };
}

function isFieldType(t: unknown): t is ProvisionFieldType {
  return (
    typeof t === "string" &&
    (VALID_FIELD_TYPES as readonly string[]).includes(t)
  );
}

function normalizeEntity(entity: unknown): string {
  const e = typeof entity === "string" ? entity.trim().toLowerCase() : "";
  return (VALID_ENTITIES as readonly string[]).includes(e) ? e : "deal";
}

/**
 * Coerce arbitrary parsed JSON into a well-formed ProvisionPlan. Skips
 * malformed pipelines/stages/fields rather than throwing, so a partially
 * valid model response still yields a usable plan.
 */
function coercePlan(clientId: string, raw: unknown): ProvisionPlan {
  const obj = (raw ?? {}) as {
    client_name?: unknown;
    pipelines?: unknown;
    fields?: unknown;
    notes?: unknown;
  };
  const clientName =
    typeof obj.client_name === "string" ? obj.client_name.trim() : "";

  const pipelines: ProvisionPipeline[] = [];
  if (Array.isArray(obj.pipelines)) {
    for (const p of obj.pipelines) {
      if (!p || typeof p !== "object") continue;
      const pp = p as { name?: unknown; stages?: unknown };
      const name = typeof pp.name === "string" ? pp.name.trim() : "";
      if (!name) continue;
      const stages: ProvisionPipeline["stages"] = [];
      if (Array.isArray(pp.stages)) {
        pp.stages.forEach((s, i) => {
          if (!s || typeof s !== "object") return;
          const ss = s as {
            name?: unknown;
            order?: unknown;
            description?: unknown;
          };
          const stageName = typeof ss.name === "string" ? ss.name.trim() : "";
          if (!stageName) return;
          const order =
            typeof ss.order === "number" && Number.isFinite(ss.order)
              ? ss.order
              : i + 1;
          stages.push({
            name: stageName,
            order,
            ...(typeof ss.description === "string" && ss.description.trim()
              ? { description: ss.description.trim() }
              : {}),
          });
        });
      }
      if (stages.length > 0) pipelines.push({ name, stages });
    }
  }

  const fields: ProvisionField[] = [];
  if (Array.isArray(obj.fields)) {
    for (const f of obj.fields) {
      if (!f || typeof f !== "object") continue;
      const ff = f as {
        entity?: unknown;
        fieldName?: unknown;
        fieldType?: unknown;
        description?: unknown;
      };
      const fieldName =
        typeof ff.fieldName === "string" ? ff.fieldName.trim() : "";
      if (!fieldName) continue;
      fields.push({
        entity: normalizeEntity(ff.entity),
        fieldName,
        fieldType: isFieldType(ff.fieldType) ? ff.fieldType : "string",
        ...(typeof ff.description === "string" && ff.description.trim()
          ? { description: ff.description.trim() }
          : {}),
      });
    }
  }

  if (pipelines.length === 0 && fields.length === 0) {
    return { ...defaultPlan(clientId), ...(clientName ? { clientName } : {}) };
  }

  return {
    clientId,
    ...(clientName ? { clientName } : {}),
    pipelines,
    fields,
    ...(typeof obj.notes === "string" && obj.notes.trim()
      ? { notes: obj.notes.trim() }
      : {}),
  };
}

/**
 * Plan a client's warehouse structure from a natural-language description.
 * Always resolves to a valid ProvisionPlan (falls back to defaultPlan on any
 * failure). Never writes to BigQuery.
 */
export async function planClientWarehouse(input: {
  clientId: string;
  description: string;
}): Promise<ProvisionPlan> {
  const clientId = input.clientId?.trim() || "bma";
  const description = (input.description ?? "").trim();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !description) {
    logger.info("provision.plan.default", {
      clientId,
      reason: !apiKey ? "no_api_key" : "empty_description",
    });
    return defaultPlan(clientId);
  }

  const userPrompt = `Client id: ${clientId}
Description of the client and what they do:
${description}

Design their warehouse. Return only the JSON.`;

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
        system: PLANNER_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Anthropic API ${response.status}: ${errorBody}`);
    }

    const data = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const rawText = (data.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");

    const cleaned = rawText
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);

    const plan = coercePlan(clientId, parsed);
    logger.info("provision.plan.built", {
      clientId,
      pipelines: plan.pipelines.length,
      fields: plan.fields.length,
    });
    return plan;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      "provision.plan.failed",
      err instanceof Error ? err : new Error(msg),
      { clientId },
    );
    return defaultPlan(clientId);
  }
}
