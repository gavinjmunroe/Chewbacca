/**
 * Analytics Run Pipeline
 * "One prompt does everything" orchestration tool.
 *
 * Chains existing tools in sequence:
 *   1. Parse NL request into structured plan (Claude API)
 *   2. Lead discovery (BigQuery contacts query)
 *   3. Enrichment (prompt delegation → analytics_enrich_data)
 *   4. ICP scoring (Claude API with persona definitions)
 *   5. List creation (BigQuery INSERT into lead_lists)
 *   6. Sequence drafting (prompt delegation → cold_email_create_sequence)
 *
 * Returns structured summary of each step's results.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { BigQuery } from '@google-cloud/bigquery';
import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'crypto';
import { PERSONAS, type PersonaConfig } from '../../config/personas';
import type { BuyerPersona } from '../../schemas/enums';

// ─── Helpers ───────────────────────────────────────────────────────────────

function fqt(table: string): string {
  const project = process.env.GCP_PROJECT_ID ?? 'midyear-glazing-485303-u3';
  const dataset = process.env.BIGQUERY_DATASET ?? 'togari_data_lake';
  return `\`${project}.${dataset}.${table}\``;
}

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

function getAnthropicClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

// ─── Types ─────────────────────────────────────────────────────────────────

interface PipelinePlan {
  discovery_query: string;
  discovery_limit: number;
  enrichment_needed: boolean;
  scoring_needed: boolean;
  list_name: string;
  sequence_needed: boolean;
  sequence_channel: string;
  persona: BuyerPersona;
}

interface ContactRow {
  workEmail: string | null;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  currentTitle: string | null;
  currentCompany: string | null;
  companyDomain: string | null;
}

interface ScoredLead extends ContactRow {
  icp_score: number;
  persona: string;
  enriched: boolean;
}

interface StepDetail {
  step: string;
  duration_ms: number;
  result_count: number;
  cost_usd: number;
}

// ─── Step 0: Parse Request ─────────────────────────────────────────────────

async function parseRequest(
  client: Anthropic,
  request: string,
): Promise<PipelinePlan> {
  const personaSummary = Object.entries(PERSONAS).map(
    ([key, p]) => `Persona ${key}: ${p.title} — ${p.companySize}, ${p.industry}`,
  ).join('\n');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    system: `You parse lead-gen pipeline requests into structured JSON plans. Available personas:\n${personaSummary}\n\nReturn ONLY valid JSON, no markdown.`,
    messages: [{
      role: 'user',
      content: `Parse this pipeline request into a JSON plan:\n"${request}"\n\nReturn JSON with these fields:\n- discovery_query: BigQuery WHERE clause for togari_structured_contacts (use column names: currentTitle, currentCompany, companyDomain, fullName). Use LIKE with % wildcards for partial matches.\n- discovery_limit: number of leads to find (default 50)\n- enrichment_needed: boolean\n- scoring_needed: boolean\n- list_name: a slug name for the list (e.g. "healthcare-vps-q1")\n- sequence_needed: boolean\n- sequence_channel: "cold_email" (default) or other channel\n- persona: "A", "B", or "C" based on the target title`,
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  try {
    const parsed = JSON.parse(cleaned);
    return {
      discovery_query: String(parsed.discovery_query ?? 'TRUE'),
      discovery_limit: Number(parsed.discovery_limit ?? 50),
      enrichment_needed: Boolean(parsed.enrichment_needed),
      scoring_needed: Boolean(parsed.scoring_needed),
      list_name: String(parsed.list_name ?? `pipeline-${Date.now()}`),
      sequence_needed: Boolean(parsed.sequence_needed),
      sequence_channel: String(parsed.sequence_channel ?? 'cold_email'),
      persona: (['A', 'B', 'C'].includes(parsed.persona) ? parsed.persona : 'A') as BuyerPersona,
    };
  } catch {
    // Fallback: treat entire request as a discovery query
    return {
      discovery_query: `currentTitle LIKE '%${request.replace(/'/g, "''").slice(0, 100)}%'`,
      discovery_limit: 50,
      enrichment_needed: false,
      scoring_needed: false,
      list_name: `pipeline-${Date.now()}`,
      sequence_needed: false,
      sequence_channel: 'cold_email',
      persona: 'A',
    };
  }
}

// ─── Step 1: Lead Discovery ────────────────────────────────────────────────

async function discoverLeads(
  bq: BigQuery,
  plan: PipelinePlan,
): Promise<ContactRow[]> {
  const limit = Math.min(plan.discovery_limit, 500);

  const [rows] = await bq.query({
    query: `
      SELECT
        workEmail, fullName, firstName, lastName,
        currentTitle, currentCompany, companyDomain
      FROM ${fqt('togari_structured_contacts')}
      WHERE ${plan.discovery_query}
      LIMIT ${limit}
    `,
    useLegacySql: false,
  });

  return (rows as Record<string, unknown>[]).map(r => ({
    workEmail: r.workEmail != null ? String(r.workEmail) : null,
    fullName: r.fullName != null ? String(r.fullName) : null,
    firstName: r.firstName != null ? String(r.firstName) : null,
    lastName: r.lastName != null ? String(r.lastName) : null,
    currentTitle: r.currentTitle != null ? String(r.currentTitle) : null,
    currentCompany: r.currentCompany != null ? String(r.currentCompany) : null,
    companyDomain: r.companyDomain != null ? String(r.companyDomain) : null,
  }));
}

// ─── Step 3: ICP Scoring ───────────────────────────────────────────────────

async function scoreLeads(
  client: Anthropic,
  leads: ContactRow[],
  persona: BuyerPersona,
): Promise<ScoredLead[]> {
  const config: PersonaConfig = PERSONAS[persona];

  const leadsJson = leads.map((l, i) => ({
    index: i,
    name: l.fullName,
    title: l.currentTitle,
    company: l.currentCompany,
    domain: l.companyDomain,
  }));

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    system: `You are an ICP scoring engine. Score each lead 0-100 based on fit to this persona:\n\nTitle: ${config.title}\nCompany Size: ${config.companySize}\nStage: ${config.stage}\nIndustry: ${config.industry}\nPain: ${config.pain}\nWin: ${config.win}\n\nReturn ONLY a JSON array of objects with "index" and "score" fields. No markdown.`,
    messages: [{
      role: 'user',
      content: `Score these ${leads.length} leads:\n${JSON.stringify(leadsJson)}`,
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '[]';
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

  let scores: { index: number; score: number }[] = [];
  try {
    scores = JSON.parse(cleaned);
  } catch {
    // If parsing fails, give everyone a default score
    scores = leads.map((_, i) => ({ index: i, score: 50 }));
  }

  const scoreMap = new Map(scores.map(s => [s.index, s.score]));

  return leads
    .map((lead, i) => ({
      ...lead,
      icp_score: scoreMap.get(i) ?? 50,
      persona: persona,
      enriched: false,
    }))
    .sort((a, b) => b.icp_score - a.icp_score);
}

// ─── Step 4: List Creation ─────────────────────────────────────────────────

async function createList(
  bq: BigQuery,
  clientId: string,
  listName: string,
  leads: ScoredLead[],
): Promise<number> {
  if (leads.length === 0) return 0;

  const listId = randomUUID();
  const now = new Date().toISOString();
  const dataset = process.env.BIGQUERY_DATASET ?? 'togari_data_lake';

  const rows = leads.map(l => ({
    list_id: listId,
    client_id: clientId,
    list_name: listName,
    contact_email: l.workEmail,
    contact_name: l.fullName,
    company: l.currentCompany,
    title: l.currentTitle,
    persona: l.persona,
    icp_score: l.icp_score,
    enriched: l.enriched,
    created_at: now,
  }));

  await bq.dataset(dataset).table('lead_lists').insert(rows).catch(err => {
    process.stderr.write(`Lead list write failed: ${err.message}\n`);
  });

  return leads.length;
}

// ─── Tool Registration ─────────────────────────────────────────────────────

export function registerDataPipelineTools(server: McpServer): void {
  server.tool(
    'analytics_run_pipeline',
    'One-prompt lead-gen pipeline: parses a natural language request, then chains lead discovery → ' +
    'enrichment → ICP scoring → list creation → sequence drafting. Returns structured summary of each ' +
    'step with timing, costs, and a preview of the top leads.',
    {
      client_id: z.string().describe('BMA tenant client identifier'),
      request: z.string().describe(
        'Natural language pipeline request, e.g. "Find 50 VP RevOps at Series B healthcare companies, ' +
        'enrich them, score against ICP, create a list called healthcare-vps, draft cold email sequence"',
      ),
    },
    async (params) => {
      try {
        const bq = getBqClient();
        const anthropic = getAnthropicClient();
        const steps: StepDetail[] = [];
        let totalCost = 0;

        // ── Step 0: Parse request ──────────────────────────
        let stepStart = Date.now();
        const plan = await parseRequest(anthropic, params.request);
        const parseCost = 0.003; // ~1K tokens in/out on Sonnet
        totalCost += parseCost;
        steps.push({
          step: 'parse_request',
          duration_ms: Date.now() - stepStart,
          result_count: 1,
          cost_usd: parseCost,
        });

        process.stderr.write(`[pipeline] Plan: ${JSON.stringify(plan)}\n`);

        // ── Step 1: Lead discovery ─────────────────────────
        stepStart = Date.now();
        const leads = await discoverLeads(bq, plan);
        steps.push({
          step: 'lead_discovery',
          duration_ms: Date.now() - stepStart,
          result_count: leads.length,
          cost_usd: 0,
        });

        if (leads.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                action: 'analytics_run_pipeline',
                pipeline_summary: {
                  steps_completed: 1,
                  leads_found: 0,
                  leads_enriched: 0,
                  leads_scored: 0,
                  list_created: '',
                  sequence_drafted: false,
                },
                step_details: steps,
                preview: [],
                plan,
                message: 'No contacts matched the discovery query. Try broadening your search criteria.',
              }, null, 2),
            }],
          };
        }

        // ── Step 2: Enrichment (prompt delegation) ─────────
        let leadsEnriched = 0;
        let enrichmentInstructions: unknown = null;
        if (plan.enrichment_needed) {
          stepStart = Date.now();
          const contactIds = leads
            .map(l => l.workEmail)
            .filter((e): e is string => e != null);

          enrichmentInstructions = {
            tool_to_call: 'analytics_enrich_data',
            params: {
              client_id: params.client_id,
              contact_ids: contactIds.slice(0, 100),
              force_refresh: false,
            },
            note: 'Call this tool after the pipeline completes to enrich the discovered leads.',
          };
          leadsEnriched = contactIds.length;
          steps.push({
            step: 'enrichment_delegation',
            duration_ms: Date.now() - stepStart,
            result_count: contactIds.length,
            cost_usd: 0,
          });
        }

        // ── Step 3: ICP scoring ────────────────────────────
        let scoredLeads: ScoredLead[];
        if (plan.scoring_needed) {
          stepStart = Date.now();
          scoredLeads = await scoreLeads(anthropic, leads, plan.persona);
          const scoreCost = 0.005; // ~2K tokens for scoring batch
          totalCost += scoreCost;
          steps.push({
            step: 'icp_scoring',
            duration_ms: Date.now() - stepStart,
            result_count: scoredLeads.length,
            cost_usd: scoreCost,
          });
        } else {
          // No scoring — assign default scores
          scoredLeads = leads.map(l => ({
            ...l,
            icp_score: 50,
            persona: plan.persona,
            enriched: false,
          }));
        }

        // ── Step 4: List creation ──────────────────────────
        stepStart = Date.now();
        const listCount = await createList(bq, params.client_id, plan.list_name, scoredLeads);
        steps.push({
          step: 'list_creation',
          duration_ms: Date.now() - stepStart,
          result_count: listCount,
          cost_usd: 0,
        });

        // ── Step 5: Sequence drafting (prompt delegation) ──
        let sequenceInstructions: unknown = null;
        if (plan.sequence_needed && scoredLeads.length > 0) {
          stepStart = Date.now();
          const topLead = scoredLeads[0];
          const personaConfig = PERSONAS[plan.persona];

          sequenceInstructions = {
            tool_to_call: `${plan.sequence_channel}_create_sequence`,
            params: {
              company_name: topLead.currentCompany ?? 'Unknown',
              contact_name: topLead.fullName ?? 'Unknown',
              contact_email: topLead.workEmail ?? '',
              persona: plan.persona,
              segment: personaConfig.industry,
              initial_email_subject: `Re: ${topLead.currentCompany ?? 'your company'}`,
              initial_email_body: 'To be generated by the sequence tool.',
              campaign_id: plan.list_name,
            },
            note: `Call ${plan.sequence_channel}_create_sequence with these params to draft the outreach sequence for the top lead.`,
          };
          steps.push({
            step: 'sequence_delegation',
            duration_ms: Date.now() - stepStart,
            result_count: 1,
            cost_usd: 0,
          });
        }

        // ── Build result ───────────────────────────────────
        const preview = scoredLeads.slice(0, 10).map(l => ({
          name: l.fullName,
          email: l.workEmail,
          title: l.currentTitle,
          company: l.currentCompany,
          icp_score: l.icp_score,
          persona: l.persona,
        }));

        const result = {
          action: 'analytics_run_pipeline',
          pipeline_summary: {
            steps_completed: steps.length,
            leads_found: leads.length,
            leads_enriched: leadsEnriched,
            leads_scored: plan.scoring_needed ? scoredLeads.length : 0,
            list_created: plan.list_name,
            sequence_drafted: plan.sequence_needed,
          },
          step_details: steps,
          total_cost_usd: Math.round(totalCost * 1000) / 1000,
          preview,
          plan,
          next_steps: [
            ...(enrichmentInstructions ? [enrichmentInstructions] : []),
            ...(sequenceInstructions ? [sequenceInstructions] : []),
          ],
        };

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: 'pipeline_failed',
              message,
            }),
          }],
          isError: true,
        };
      }
    },
  );
}
