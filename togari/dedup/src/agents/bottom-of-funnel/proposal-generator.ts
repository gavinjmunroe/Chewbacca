/**
 * BOF Proposal Generator
 * Generates structured proposals for qualified opportunities.
 *
 * Queries BigQuery for deal details, company enrichment, and recent activities,
 * then returns structured data for Claude to assemble into a proposal.
 * Follows the prompt-delegation model: returns data, not prose.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { BigQuery } from '@google-cloud/bigquery';
import { buyerPersonaSchema } from '../../schemas/enums';

// ─── Zod Schemas ────────────────────────────────────────────────────────────

export const proposalInputSchema = z.object({
  deal_id: z.string().describe('UUID of the deal in togari.deals'),
  client_id: z.string().describe('Client/company identifier'),
});

export type ProposalInput = z.infer<typeof proposalInputSchema>;

const proposalSectionSchema = z.object({
  title: z.string().describe('Section heading'),
  body: z.string().describe('Section content, word-limited by persona'),
});

const proposalSectionsSchema = z.object({
  executive_summary: proposalSectionSchema,
  problem_statement: proposalSectionSchema,
  proposed_solution: proposalSectionSchema,
  scope_and_deliverables: proposalSectionSchema,
  pricing: proposalSectionSchema,
  timeline: proposalSectionSchema,
  next_steps: proposalSectionSchema,
});

const dealSummarySchema = z.object({
  deal_id: z.string(),
  deal_name: z.string(),
  company: z.string(),
  value: z.number().nullable(),
  stage: z.string(),
  notes: z.string().nullable(),
  contact_ids: z.array(z.string()),
});

export const proposalOutputSchema = z.object({
  proposal: proposalSectionsSchema,
  persona: buyerPersonaSchema.describe('Detected buyer persona (A/B/C)'),
  deal_summary: dealSummarySchema,
});

export type ProposalOutput = z.infer<typeof proposalOutputSchema>;

// ─── Persona Definitions (word limits per section) ──────────────────────────

const PERSONA_DEFS: Record<string, { label: string; title_match: RegExp; max_words: number }> = {
  A: {
    label: 'VP RevOps',
    title_match: /\b(vp|vice\s*president).*(rev\s*ops|revenue\s*operations)/i,
    max_words: 120,
  },
  B: {
    label: 'Head of Strategy',
    title_match: /\b(head|director|svp|vp).*(strategy|strategic)/i,
    max_words: 150,
  },
  C: {
    label: 'CCO Startup',
    title_match: /\b(cco|chief\s*commercial|chief\s*customer)/i,
    max_words: 90,
  },
};

function detectPersona(contactTitle: string | null): { id: string; label: string; max_words: number } {
  if (contactTitle) {
    for (const [id, def] of Object.entries(PERSONA_DEFS)) {
      if (def.title_match.test(contactTitle)) {
        return { id, label: def.label, max_words: def.max_words };
      }
    }
  }
  // Default to Persona B (most general, middle word count)
  return { id: 'B', label: 'Head of Strategy (default)', max_words: 150 };
}

// ─── BigQuery Helpers ───────────────────────────────────────────────────────

function getBqClient(): BigQuery {
  const projectId = process.env.GCP_PROJECT_ID;
  const options: ConstructorParameters<typeof BigQuery>[0] = { projectId };

  const gcpCredentialsBase64 = process.env.GCP_CREDENTIALS_BASE64;
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (gcpCredentialsBase64) {
    const decoded = Buffer.from(gcpCredentialsBase64, 'base64').toString('utf-8');
    options.credentials = JSON.parse(decoded);
  } else if (credentialsPath) {
    options.keyFilename = credentialsPath;
  }

  return new BigQuery(options);
}

interface DealRow {
  deal_name: string;
  company: string;
  value: number | null;
  stage: string;
  notes: string | null;
  contact_ids: string[];
}

interface EnrichmentRow {
  revenue: number | null;
  headcount: number | null;
  tech_stack: string | null;
}

interface ActivityRow {
  activity_type: string;
  summary: string;
  created_at: string;
}

interface ContactRow {
  currentTitle: string | null;
}

async function queryDealDetails(bq: BigQuery, dealId: string): Promise<DealRow | null> {
  const [rows] = await bq.query({
    query: `
      SELECT deal_name, company, value, stage, notes, contact_ids
      FROM \`togari.deals\`
      WHERE deal_id = @deal_id
      LIMIT 1
    `,
    params: { deal_id: dealId },
    useLegacySql: false,
  });
  return (rows as DealRow[])[0] ?? null;
}

async function queryEnrichments(bq: BigQuery, clientId: string): Promise<EnrichmentRow | null> {
  const [rows] = await bq.query({
    query: `
      SELECT revenue, headcount, tech_stack
      FROM \`togari.enrichments\`
      WHERE client_id = @client_id
      LIMIT 1
    `,
    params: { client_id: clientId },
    useLegacySql: false,
  });
  return (rows as EnrichmentRow[])[0] ?? null;
}

async function queryRecentActivities(bq: BigQuery, dealId: string): Promise<ActivityRow[]> {
  const [rows] = await bq.query({
    query: `
      SELECT activity_type, summary, CAST(created_at AS STRING) AS created_at
      FROM \`togari.activities\`
      WHERE deal_id = @deal_id
        AND activity_type IN ('meeting_notes', 'call_summary')
      ORDER BY created_at DESC
      LIMIT 10
    `,
    params: { deal_id: dealId },
    useLegacySql: false,
  });
  return rows as ActivityRow[];
}

async function queryPrimaryContactTitle(bq: BigQuery, contactIds: string[]): Promise<string | null> {
  if (!contactIds || contactIds.length === 0) return null;

  const [rows] = await bq.query({
    query: `
      SELECT currentTitle
      FROM \`togari.contacts\`
      WHERE linkedinUrl IN UNNEST(@contact_ids)
         OR workEmail IN UNNEST(@contact_ids)
      LIMIT 1
    `,
    params: { contact_ids: contactIds },
    useLegacySql: false,
  });
  return (rows as ContactRow[])[0]?.currentTitle ?? null;
}

// ─── Prompt Builder ─────────────────────────────────────────────────────────

function buildProposalPrompt(
  deal: DealRow,
  enrichment: EnrichmentRow | null,
  activities: ActivityRow[],
  persona: { id: string; label: string; max_words: number },
): string {
  const activityBlock = activities.length > 0
    ? activities.map((a) => `- [${a.activity_type}] ${a.created_at}: ${a.summary}`).join('\n')
    : 'No recent meeting notes or call summaries found.';

  const enrichmentBlock = enrichment
    ? [
        `Revenue: ${enrichment.revenue ? `$${enrichment.revenue.toLocaleString()}` : 'Unknown'}`,
        `Headcount: ${enrichment.headcount ?? 'Unknown'}`,
        `Tech Stack: ${enrichment.tech_stack ?? 'Unknown'}`,
      ].join('\n')
    : 'No enrichment data available.';

  return `You are generating a structured proposal for a B2B deal.

BUYER PERSONA: ${persona.id} — ${persona.label}
MAX WORDS PER SECTION: ${persona.max_words}

DEAL DETAILS:
- Deal Name: ${deal.deal_name}
- Company: ${deal.company}
- Value: ${deal.value ? `$${deal.value.toLocaleString()}` : 'TBD'}
- Stage: ${deal.stage}
- Notes: ${deal.notes ?? 'None'}

COMPANY ENRICHMENT:
${enrichmentBlock}

RECENT ACTIVITIES:
${activityBlock}

INSTRUCTIONS:
Generate each proposal section as a concise, data-driven paragraph.
Each section MUST be under ${persona.max_words} words.
Do NOT use filler language, platitudes, or generic consulting-speak.
Ground every claim in the data above.
If data is missing for a section, state what is known and flag what needs discovery.

Return valid JSON matching this structure. Each section has a "title" and "body":
{
  "executive_summary": { "title": "Executive Summary", "body": "..." },
  "problem_statement": { "title": "Problem Statement", "body": "..." },
  "proposed_solution": { "title": "Proposed Solution", "body": "..." },
  "scope_and_deliverables": { "title": "Scope & Deliverables", "body": "..." },
  "pricing": { "title": "Pricing", "body": "..." },
  "timeline": { "title": "Timeline", "body": "..." },
  "next_steps": { "title": "Next Steps", "body": "..." }
}`;
}

// ─── Tool Registration ──────────────────────────────────────────────────────

export function registerProposalGeneratorTools(server: McpServer): void {
  server.tool(
    'bof_generate_proposal',
    'Generate a structured proposal for a qualified deal. Queries deal details, company enrichment, and recent activities from BigQuery, determines buyer persona, and returns structured proposal data with a prompt for Claude to assemble.',
    {
      deal_id: z.string().describe('UUID of the deal in togari.deals'),
      client_id: z.string().describe('Client/company identifier for enrichment lookup'),
    },
    async (params) => {
      try {
        const bq = getBqClient();

        // Step 1: Query deal details
        const deal = await queryDealDetails(bq, params.deal_id);
        if (!deal) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                error: 'deal_not_found',
                message: `No deal found with deal_id: ${params.deal_id}. Run mof_deal_search to locate the correct deal.`,
              }),
            }],
          };
        }

        // Step 2–3: Query enrichment and activities in parallel
        const [enrichment, activities, contactTitle] = await Promise.all([
          queryEnrichments(bq, params.client_id),
          queryRecentActivities(bq, params.deal_id),
          queryPrimaryContactTitle(bq, deal.contact_ids),
        ]);

        // Step 4: Determine buyer persona from contact title
        const persona = detectPersona(contactTitle);

        // Step 5: Build prompt and return structured data
        const prompt = buildProposalPrompt(deal, enrichment, activities, persona);

        const dealSummary = {
          deal_id: params.deal_id,
          deal_name: deal.deal_name,
          company: deal.company,
          value: deal.value,
          stage: deal.stage,
          notes: deal.notes,
          contact_ids: deal.contact_ids,
        };

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'bof_generate_proposal',
              prompt,
              instructions: `Generate the proposal sections. Each section has a "title" and "body". Each body MUST be under ${persona.max_words} words. Return JSON with keys: executive_summary, problem_statement, proposed_solution, scope_and_deliverables, pricing, timeline, next_steps.`,
              constraints: {
                persona: persona.id,
                persona_label: persona.label,
                max_words_per_section: persona.max_words,
              },
              deal_summary: dealSummary,
              enrichment: enrichment ?? { revenue: null, headcount: null, tech_stack: null },
              recent_activities: activities,
              output_schema: {
                proposal: {
                  executive_summary: '{ title: string, body: string }',
                  problem_statement: '{ title: string, body: string }',
                  proposed_solution: '{ title: string, body: string }',
                  scope_and_deliverables: '{ title: string, body: string }',
                  pricing: '{ title: string, body: string }',
                  timeline: '{ title: string, body: string }',
                  next_steps: '{ title: string, body: string }',
                },
                persona: 'A | B | C',
                deal_summary: 'object',
              },
            }, null, 2),
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: 'proposal_generation_failed',
              message,
            }),
          }],
          isError: true,
        };
      }
    },
  );
}
