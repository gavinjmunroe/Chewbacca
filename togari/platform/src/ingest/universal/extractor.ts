/**
 * Universal ingestion — entity extractor.
 *
 * Reads a raw submission (free-form text like "Joe loves X, said Y, wants a
 * follow-up about Z" OR tabular records) and asks Claude to return STRICT JSON
 * of structured entities using the ExtractedEntity shapes. Mirrors the
 * Anthropic fetch call in src/core/tools/email-ops.ts exactly.
 *
 * Safe by construction: if ANTHROPIC_API_KEY is missing, or the model returns
 * unparseable text, this returns an empty ExtractionResult rather than
 * throwing — the raw is already preserved, so extraction is best-effort.
 */

import { SONNET } from "../../config/models";
import { createLogger } from "../../observability/logger";
import type { ExtractedEntity, ExtractionResult } from "./types";

const logger = createLogger("ingest/universal/extractor");

const EXTRACTION_SYSTEM_PROMPT = `You are Togari's ingestion engine. You read a raw submission (free-form text, or a list of tabular records) and extract the structured CRM/pipeline entities it contains.

Return ONLY valid JSON in this exact shape:
{ "entities": Entity[], "summary": string }

Each Entity is one of these discriminated shapes (include "kind" and only the relevant fields):
- { "kind": "contact", "full_name"?: string, "email"?: string, "company"?: string, "title"?: string, "phone"?: string }
- { "kind": "company", "name"?: string, "domain"?: string, "industry"?: string }
- { "kind": "activity", "deal_ref"?: string, "contact_ref"?: string, "type": string, "content": string }
- { "kind": "task", "content": string, "due"?: string, "owner"?: string }
- { "kind": "fact", "subject": string, "statement": string }
- { "kind": "pipeline_update", "company_or_deal": string, "to_stage"?: string }
- { "kind": "deal", "company": string, "value"?: number, "stage"?: string, "pipeline"?: string, "contact_name"?: string, "contact_email"?: string, "notes"?: string }

Rules:
- Extract every distinct entity you can identify. A single note may yield multiple entities (e.g. a contact, an activity, and a task).
- Emit a "deal" ONLY when the submission clearly describes a sales opportunity to track (a company plus a deal value, stage, or explicit intent like "log this deal" / "new deal" / "opportunity"). Do NOT emit a deal for a plain mention of a company. Prefer "deal" over "company" when a monetary value or a pipeline stage is present.
- When a submission says an existing deal moved stages (e.g. "Acme moved to negotiation"), emit "pipeline_update", not "deal".
- Do NOT invent data. Omit optional fields you are unsure of.
- "summary" is one concise sentence describing what the submission was about.
- If nothing structured can be extracted, return { "entities": [], "summary": "<short description>" }.
- Return raw JSON only. No markdown fences, no prose before or after.`;

const MAX_CONTENT_CHARS = 24000;

function buildUserPrompt(input: {
  text?: string;
  records?: unknown[];
}): string {
  if (input.records && input.records.length > 0) {
    const json = JSON.stringify(input.records, null, 2).slice(
      0,
      MAX_CONTENT_CHARS,
    );
    return `Extract structured entities from these ${input.records.length} tabular records:\n\n${json}`;
  }
  const text = (input.text ?? "").slice(0, MAX_CONTENT_CHARS);
  return `Extract structured entities from this submission:\n\n${text || "(empty)"}`;
}

/** Best-effort JSON extraction from a model text response. */
function parseExtraction(rawText: string): ExtractionResult {
  const cleaned = rawText
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();

  const attempt = (candidate: string): ExtractionResult | null => {
    try {
      const parsed = JSON.parse(candidate) as {
        entities?: unknown;
        summary?: unknown;
      };
      const entities = Array.isArray(parsed.entities)
        ? (parsed.entities.filter(
            (e) => e && typeof e === "object" && "kind" in (e as object),
          ) as ExtractedEntity[])
        : [];
      const summary = typeof parsed.summary === "string" ? parsed.summary : "";
      return { entities, summary };
    } catch {
      return null;
    }
  };

  const direct = attempt(cleaned);
  if (direct) return direct;

  // Fall back to the first {...} block if the model wrapped it in prose.
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const sliced = attempt(cleaned.slice(start, end + 1));
    if (sliced) return sliced;
  }

  return { entities: [], summary: "" };
}

/**
 * Extract structured entities from text or tabular records. Returns an empty
 * result (never throws) when the API key is missing or parsing fails.
 */
export async function extractEntities(input: {
  text?: string;
  records?: unknown[];
}): Promise<ExtractionResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logger.warn("ANTHROPIC_API_KEY not set — skipping extraction (raw only)");
    return { entities: [], summary: "" };
  }

  const userPrompt = buildUserPrompt(input);

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: SONNET,
        max_tokens: 2048,
        system: EXTRACTION_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      logger.error(
        "extraction request failed",
        new Error(`Anthropic API ${response.status}: ${errorBody}`),
      );
      return { entities: [], summary: "" };
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const rawText = (data.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");

    const result = parseExtraction(rawText);
    logger.info("extraction complete", { entities: result.entities.length });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      "extraction threw — returning empty result",
      err instanceof Error ? err : new Error(message),
    );
    return { entities: [], summary: "" };
  }
}
