/**
 * Tool registry for the enrichment agent.
 *
 * Tool slots, matching the Tab 3 plan:
 *   - searchExaCompany          → Tab 5b fills (Exa)
 *   - searchCrustDataCompany    → Tab 5b fills (CrustData)
 *   - researchPerplexity        → Tab 5b fills (Perplexity)
 *   - enrichContactCrustData    → Tab 5b fills (CrustData enrich)
 *   - persistContacts           → owned here (push into accumulator)
 *   - getAllPersistedContacts   → owned here (read accumulator)
 *
 * Until Tab 4/5b land, the unfilled slots are wired as `tool()` definitions
 * whose `execute` throws "not implemented". That keeps the type surface
 * stable and the agent loop compilable today; if the agent actually picks
 * one of those stubs at runtime, the error is surfaced in Sentry instead of
 * silently no-op'ing.
 */

import { z } from "zod";
import type { ContactAccumulator } from "./accumulator";
import { pushContacts } from "./accumulator";
import type { ContactInfoJson } from "./types";

/**
 * Context passed to every tool's `execute` function. The accumulator lives
 * inside this object so multiple tools share a single contact list.
 */
export interface ToolContext {
  tenantId: string;
  enrichmentRunId: string;
  companyId: string;
  companyName: string;
  companyWebsite?: string | null;
  companyAddress?: string | null;
  companyDatapoints?: Record<string, string>;
  accumulator: ContactAccumulator;
}

const contactInputSchema = z.object({
  name: z.string().min(1),
  title: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().nullable().optional(),
  linkedin_url: z.string().url().nullable().optional(),
  title_tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  notes: z.string().nullable().optional(),
  source_urls: z.array(z.string().url()).optional(),
});

type ContactInput = z.infer<typeof contactInputSchema>;

function contactInputToJson(
  input: ContactInput,
  source: string,
): ContactInfoJson {
  return {
    schema_version: 2,
    name: input.name,
    title: input.title ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    notes: input.notes ?? null,
    source_urls: input.source_urls ?? [],
    provenance: {
      source: source as ContactInfoJson["provenance"] extends infer P
        ? P extends { source: infer S }
          ? S
          : never
        : never,
      fetched_at: new Date().toISOString(),
    },
  };
}

// ── Owned tools ────────────────────────────────────────────────────────────

const persistContactsSchema = z.object({
  source: z
    .string()
    .describe(
      "Which tool surfaced these contacts (exa, crustdata, perplexity, grata).",
    ),
  contacts: z
    .array(contactInputSchema)
    .min(1)
    .describe("1 to N contacts to persist this turn."),
});

const getAllPersistedContactsSchema = z.object({});

const notImplementedSchema = z.object({}).passthrough();

/**
 * AI SDK v5's exported `tool()` factory triggers an "excessively deep" generic
 * instantiation when fed our zod schemas under strict TS. The runtime expects
 * a plain object with `description`, `inputSchema`, and `execute`, so we
 * sidestep the factory and assemble that shape directly. The agent loop in
 * agentConfig.ts passes the tools through `generateText` via a cast to ToolSet
 * — runtime validation is preserved because each tool still carries its
 * `inputSchema`.
 */
type AnyTool = {
  description: string;
  inputSchema: z.ZodTypeAny;
  execute: (input: unknown) => Promise<unknown>;
};

function makeTool<T extends z.ZodTypeAny, R>(spec: {
  description: string;
  inputSchema: T;
  execute: (input: z.infer<T>) => Promise<R>;
}): AnyTool {
  return spec as unknown as AnyTool;
}

export function createEnrichmentTools(
  ctx: ToolContext,
): Record<string, AnyTool> {
  const persistContacts = makeTool({
    description:
      "Push one or more validated decision-maker contacts into the run's accumulator. This is the only way contacts reach the database. Use as soon as a Tier-1 or Tier-2 contact has a verified channel.",
    inputSchema: persistContactsSchema,
    execute: async (input: z.infer<typeof persistContactsSchema>) => {
      const normalised = input.contacts.map((c) =>
        contactInputToJson(c, input.source),
      );
      pushContacts(ctx.accumulator, input.source, normalised);
      return {
        persistedCount: normalised.length,
        totalAccumulated: ctx.accumulator.contacts.length,
      };
    },
  });

  const getAllPersistedContacts = makeTool({
    description:
      "Return every contact currently in the accumulator (name, title, source). Use to avoid re-persisting the same person.",
    inputSchema: getAllPersistedContactsSchema,
    execute: async () => ({
      contacts: ctx.accumulator.contacts.map((c) => ({
        name: c.contact.name ?? null,
        title: c.contact.title ?? null,
        email: c.contact.email ?? null,
        source: c.source,
      })),
    }),
  });

  function notImplementedTool(toolName: string, owner: string) {
    return makeTool({
      description: `(${toolName}) not yet implemented — owned by ${owner}. Calling will throw.`,
      inputSchema: notImplementedSchema,
      execute: async () => {
        throw new Error(
          `Tool "${toolName}" is not yet implemented. Pending ${owner}.`,
        );
      },
    });
  }

  return {
    persistContacts,
    getAllPersistedContacts,
    searchExaCompany: notImplementedTool("searchExaCompany", "Tab 5b (Exa)"),
    searchCrustDataCompany: notImplementedTool(
      "searchCrustDataCompany",
      "Tab 5b (CrustData)",
    ),
    researchPerplexity: notImplementedTool(
      "researchPerplexity",
      "Tab 5b (Perplexity)",
    ),
    enrichContactCrustData: notImplementedTool(
      "enrichContactCrustData",
      "Tab 5b (CrustData enrich)",
    ),
  };
}

export type EnrichmentTools = ReturnType<typeof createEnrichmentTools>;
