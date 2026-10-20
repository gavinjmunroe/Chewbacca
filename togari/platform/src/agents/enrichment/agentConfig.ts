/**
 * Agent configuration for the PE-buy-side enrichment loop.
 * Ported in structure from autotier's agentConfig.ts; rewired to Togari's
 * BigQuery-backed admin_settings, Vercel AI SDK, and PE-tailored system
 * prompt.
 *
 * Caller (worker/jobs/processEnrichmentCompany) builds the ToolContext,
 * invokes `runEnrichmentAgent`, and persists the returned contacts.
 */

import { generateText, stepCountIs, type ToolSet } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { BigQueryClient } from "../../bigquery/client";
import { createLogger } from "../../observability/logger";
import { getTenantSecret } from "../../secrets/tenantSecrets";
import { createAccumulator, type ContactAccumulator } from "./accumulator";
import {
  ENRICHMENT_AGENT_SYSTEM_PROMPT,
  generateEnrichmentPrompt,
} from "./systemPrompt";
import { createEnrichmentTools, type ToolContext } from "./tools";
import type { ContactInfoJson } from "./types";

const logger = createLogger("agents/enrichment");

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";
const DATASET = process.env.BIGQUERY_DATASET || "togari_core";
const ADMIN_SETTINGS = `\`${PROJECT_ID}.${DATASET}.admin_settings\``;

const FALLBACK_DEFAULTS = {
  maxSteps: 15,
  model: "openai/gpt-5.4",
  verbose: true,
};

let cachedBq: BigQueryClient | null = null;
function bq(): BigQueryClient {
  if (!cachedBq) {
    cachedBq = new BigQueryClient(
      PROJECT_ID,
      null,
      process.env.GCP_CREDENTIALS_BASE64 ||
        process.env.GOOGLE_CREDENTIALS_BASE64 ||
        null,
    );
  }
  return cachedBq;
}

async function getAgenticMaxSteps(tenantId: string): Promise<number> {
  try {
    const { rows } = await bq().executeQuery(
      `SELECT value FROM ${ADMIN_SETTINGS}
        WHERE tenant_id = @tenant_id AND \`key\` = 'agentic_max_steps'
        LIMIT 1`,
      { tenant_id: tenantId },
    );
    const raw = rows[0]?.value;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (typeof parsed === "number" && parsed > 0) {
      return Math.min(parsed, 60);
    }
  } catch (err) {
    logger.debug("agentic_max_steps lookup failed, using fallback", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return FALLBACK_DEFAULTS.maxSteps;
}

/**
 * Resolve the OpenAI API key for a given tenant. Per-tenant secrets in
 * `tenant_secrets` win; in non-production we fall back to the process env so
 * local dev keeps working without seeding BQ.
 */
async function resolveOpenAIApiKey(tenantId: string): Promise<string> {
  let secret: string | null = null;
  try {
    secret = await getTenantSecret(tenantId, "OPENAI_API_KEY");
  } catch (err) {
    logger.warn("getTenantSecret failed for OPENAI_API_KEY", {
      tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  if (secret) return secret;

  if (process.env.NODE_ENV !== "production" && process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY;
  }
  throw new Error(
    `No OpenAI API key configured for tenant "${tenantId}". ` +
      "Run setTenantSecret(tenantId, 'OPENAI_API_KEY', ...) to seed it.",
  );
}

/**
 * For models prefixed with `openai/`, build an explicit provider scoped to the
 * tenant's API key. Other model strings (anthropic/..., google/...) flow
 * through the Vercel AI SDK's default routing unchanged for now — Phase 2 can
 * extend this to Anthropic etc. as those secrets land in tenant_secrets.
 */
async function resolveModelForTenant(
  model: string,
  tenantId: string,
): Promise<Parameters<typeof generateText>[0]["model"]> {
  if (!model.startsWith("openai/")) {
    return model as Parameters<typeof generateText>[0]["model"];
  }
  const modelName = model.slice("openai/".length);
  const apiKey = await resolveOpenAIApiKey(tenantId);
  return createOpenAI({ apiKey })(modelName);
}

export interface AgentConfig {
  maxSteps?: number;
  model?: string;
  verbose?: boolean;
}

export interface ToolUsage {
  step: number;
  toolName: string;
}

export interface EnrichmentConfidence {
  sourcesUsed: string[];
  hasAddressVerified: boolean;
  crossValidatedCount: number;
}

export interface AgentResult {
  success: boolean;
  response: string;
  stepCount: number;
  error?: string;
  toolsUsed: ToolUsage[];
  confidence: EnrichmentConfidence;
  contacts: Array<{ contact: ContactInfoJson; source: string }>;
}

function extractToolUsage(steps: unknown[]): ToolUsage[] {
  const ordered: ToolUsage[] = [];
  let stepNumber = 1;
  for (const step of steps) {
    const s = step as { toolCalls?: Array<{ toolName: string }> };
    for (const tc of s.toolCalls ?? []) {
      ordered.push({ step: stepNumber++, toolName: tc.toolName });
    }
  }
  return ordered;
}

function computeConfidence(
  accumulator: ContactAccumulator,
): EnrichmentConfidence {
  const sourcesUsed = [...new Set(accumulator.contacts.map((e) => e.source))];

  // Togari's enrichment plane doesn't (yet) compute Enformion-style address
  // match scores, so we leave this as "not yet" for v1 and revisit when
  // Tab 5b's enrich tools start filling in cross-source signals.
  const hasAddressVerified = false;

  const nameToSources = new Map<string, Set<string>>();
  for (const { contact, source } of accumulator.contacts) {
    const key = (contact.name ?? "").toLowerCase().trim();
    if (!key) continue;
    const existing = nameToSources.get(key);
    if (existing) existing.add(source);
    else nameToSources.set(key, new Set([source]));
  }
  const crossValidatedCount = [...nameToSources.values()].filter(
    (sources) => sources.size >= 2,
  ).length;

  return { sourcesUsed, hasAddressVerified, crossValidatedCount };
}

export async function runEnrichmentAgent(
  context: Omit<ToolContext, "accumulator">,
  config: AgentConfig = {},
): Promise<AgentResult> {
  const model = config.model ?? FALLBACK_DEFAULTS.model;
  const dbMaxSteps = config.maxSteps
    ? config.maxSteps
    : await getAgenticMaxSteps(context.tenantId);
  const maxSteps = dbMaxSteps || FALLBACK_DEFAULTS.maxSteps;
  const verbose = config.verbose ?? FALLBACK_DEFAULTS.verbose;

  if (verbose) {
    logger.info(
      `starting agent: company=${context.companyId} run=${context.enrichmentRunId} model=${model} maxSteps=${maxSteps}`,
    );
  }

  const resolvedModel = await resolveModelForTenant(model, context.tenantId);

  const accumulator = createAccumulator();
  const fullContext: ToolContext = { ...context, accumulator };
  const tools = createEnrichmentTools(fullContext);

  const promptContext: Parameters<typeof generateEnrichmentPrompt>[0] = {
    companyName: context.companyName,
    companyWebsite: context.companyWebsite,
    companyAddress: context.companyAddress,
  };
  if (context.companyDatapoints) {
    promptContext.companyDatapoints = context.companyDatapoints;
  }
  const taskPrompt = generateEnrichmentPrompt(promptContext);

  const emptyResult: Pick<
    AgentResult,
    "toolsUsed" | "confidence" | "contacts"
  > = {
    toolsUsed: [],
    confidence: {
      sourcesUsed: [],
      hasAddressVerified: false,
      crossValidatedCount: 0,
    },
    contacts: [],
  };

  try {
    const result = await generateText({
      model: resolvedModel,
      system: ENRICHMENT_AGENT_SYSTEM_PROMPT,
      prompt: taskPrompt,
      tools: tools as unknown as ToolSet,
      stopWhen: stepCountIs(maxSteps),
    });

    const toolsUsed = extractToolUsage(result.steps ?? []);
    const stepCount = toolsUsed.length;
    const confidence = computeConfidence(accumulator);

    if (verbose) {
      logger.info(
        `agent done: company=${context.companyId} toolCalls=${stepCount} contacts=${accumulator.contacts.length} sources=[${confidence.sourcesUsed.join(", ")}]`,
      );
    }

    return {
      success: true,
      response: result.text,
      stepCount,
      toolsUsed,
      confidence,
      contacts: accumulator.contacts,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`agent error: ${errorMessage}`, error);
    return {
      success: false,
      response: "",
      stepCount: 0,
      error: errorMessage,
      ...emptyResult,
    };
  }
}

export type { ToolContext } from "./tools";
