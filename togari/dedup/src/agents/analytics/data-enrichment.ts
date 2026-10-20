/**
 * Analytics Data Enrichment
 * Batch contact enrichment orchestrator: queries contacts from BigQuery,
 * calls Clay (company/contact), Exa (news), normalizes with Structify,
 * writes results to the enrichments table.
 *
 * Rate limits: Clay 10 calls/min, Exa 100 calls/day.
 * Follows prompt-delegation model for missing API keys.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { BigQuery } from '@google-cloud/bigquery';
import { randomUUID } from 'crypto';

// ─── Constants ─────────────────────────────────────────────────────────────

const MAX_CONTACTS_PER_BATCH = 500;
const MAX_COST_PER_BATCH_USD = 5.0;
const CLAY_COST_PER_CALL = 0.01;
const EXA_COST_PER_CALL = 0.001;
const CLAY_API_BASE = 'https://api.clay.com/v1';
const EXA_API_BASE = 'https://api.exa.ai';
const MUTATION_REGEX = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|MERGE|GRANT|REVOKE)\b/i;

// ─── Zod Schemas ───────────────────────────────────────────────────────────

export const enrichInputSchema = z.object({
  client_id: z.string().describe('BMA tenant client identifier'),
  contact_ids: z.array(z.string()).optional()
    .describe('Specific contact IDs (workEmail or linkedinUrl) to enrich'),
  filter: z.string().optional()
    .describe('BigQuery WHERE clause fragment, e.g. "currentCompany LIKE \'%healthcare%\'"'),
  force_refresh: z.boolean().optional().default(false)
    .describe('Re-enrich contacts even if enriched within last 30 days'),
});

export type EnrichInput = z.infer<typeof enrichInputSchema>;

const resultPreviewSchema = z.object({
  contact: z.string(),
  company: z.string(),
  status: z.enum(['success', 'partial', 'failed']),
  sources: z.array(z.string()),
});

export const enrichOutputSchema = z.object({
  total: z.number(),
  enriched: z.number(),
  skipped: z.number(),
  failed: z.number(),
  cost_usd: z.number(),
  results_preview: z.array(resultPreviewSchema),
  notes: z.array(z.string()).optional(),
});

export type EnrichOutput = z.infer<typeof enrichOutputSchema>;

// ─── Types ─────────────────────────────────────────────────────────────────

interface ContactRow {
  workEmail: string | null;
  linkedinUrl: string | null;
  fullName: string | null;
  currentCompany: string | null;
  companyDomain: string | null;
  already_enriched: boolean;
}

interface EnrichmentResult {
  contact_id: string;
  company: string;
  company_domain: string;
  clay_company: unknown | null;
  clay_contact: unknown | null;
  exa_news: unknown | null;
  structify_normalized: unknown | null;
  source_apis: string[];
  cost_usd: number;
  status: 'success' | 'partial' | 'failed';
  error_message: string;
}

// ─── API Throttle ──────────────────────────────────────────────────────────

class ApiThrottle {
  private callTimestamps: number[] = [];

  constructor(
    private maxCalls: number,
    private windowMs: number,
  ) {}

  async waitForSlot(): Promise<void> {
    const now = Date.now();
    // Remove expired timestamps
    this.callTimestamps = this.callTimestamps.filter(t => now - t < this.windowMs);

    if (this.callTimestamps.length >= this.maxCalls) {
      const oldest = this.callTimestamps[0];
      const waitMs = this.windowMs - (now - oldest) + 50; // 50ms buffer
      if (waitMs > 0) {
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
      // Clean again after wait
      const afterWait = Date.now();
      this.callTimestamps = this.callTimestamps.filter(t => afterWait - t < this.windowMs);
    }

    this.callTimestamps.push(Date.now());
  }

  get remainingCalls(): number {
    const now = Date.now();
    const active = this.callTimestamps.filter(t => now - t < this.windowMs);
    return Math.max(0, this.maxCalls - active.length);
  }
}

// Module-level throttles (persist across calls within same process)
const clayThrottle = new ApiThrottle(10, 60_000);      // 10 per minute
const exaThrottle = new ApiThrottle(100, 86_400_000);   // 100 per day

// ─── BigQuery Helpers ──────────────────────────────────────────────────────

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

function validateFilter(filter: string): void {
  if (MUTATION_REGEX.test(filter)) {
    throw new Error('Filter contains disallowed SQL keywords. Only SELECT-safe WHERE expressions are permitted.');
  }
  if (filter.includes(';')) {
    throw new Error('Filter must not contain semicolons.');
  }
}

async function queryContacts(
  bq: BigQuery,
  clientId: string,
  contactIds?: string[],
  filter?: string,
  forceRefresh?: boolean,
): Promise<ContactRow[]> {
  const conditions: string[] = [];
  const params: Record<string, unknown> = { client_id: clientId };

  if (contactIds && contactIds.length > 0) {
    conditions.push('(c.workEmail IN UNNEST(@contact_ids) OR c.linkedinUrl IN UNNEST(@contact_ids))');
    params.contact_ids = contactIds;
  }

  if (filter) {
    validateFilter(filter);
    conditions.push(`(${filter})`);
  }

  const whereClause = conditions.length > 0
    ? `AND ${conditions.join(' AND ')}`
    : '';

  const enrichmentJoin = forceRefresh
    ? ''
    : `LEFT JOIN ${fqt('enrichments')} e
         ON (c.workEmail = e.contact_id OR c.linkedinUrl = e.contact_id)
         AND e.enriched_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)`;

  const enrichmentSelect = forceRefresh
    ? 'FALSE AS already_enriched'
    : 'CASE WHEN e.enrichment_id IS NOT NULL THEN TRUE ELSE FALSE END AS already_enriched';

  const [rows] = await bq.query({
    query: `
      SELECT
        c.workEmail,
        c.linkedinUrl,
        c.fullName,
        c.currentCompany,
        c.companyDomain,
        ${enrichmentSelect}
      FROM ${fqt('togari_structured_contacts')} c
      ${enrichmentJoin}
      WHERE TRUE
        ${whereClause}
      LIMIT ${MAX_CONTACTS_PER_BATCH}
    `,
    params,
    useLegacySql: false,
  });

  return (rows as Record<string, unknown>[]).map(r => ({
    workEmail: r.workEmail != null ? String(r.workEmail) : null,
    linkedinUrl: r.linkedinUrl != null ? String(r.linkedinUrl) : null,
    fullName: r.fullName != null ? String(r.fullName) : null,
    currentCompany: r.currentCompany != null ? String(r.currentCompany) : null,
    companyDomain: r.companyDomain != null ? String(r.companyDomain) : null,
    already_enriched: Boolean(r.already_enriched),
  }));
}

async function writeEnrichmentResults(
  bq: BigQuery,
  clientId: string,
  results: EnrichmentResult[],
): Promise<void> {
  if (results.length === 0) return;

  const now = new Date();
  const rows = results.map(r => ({
    enrichment_id: randomUUID(),
    client_id: clientId,
    contact_id: r.contact_id,
    company_domain: r.company_domain,
    clay_company: r.clay_company ? JSON.stringify(r.clay_company) : null,
    clay_contact: r.clay_contact ? JSON.stringify(r.clay_contact) : null,
    exa_news: r.exa_news ? JSON.stringify(r.exa_news) : null,
    structify_normalized: r.structify_normalized ? JSON.stringify(r.structify_normalized) : null,
    source_apis: r.source_apis,
    cost_usd: r.cost_usd,
    status: r.status,
    error_message: r.error_message || null,
    enriched_at: now.toISOString(),
    created_at: now.toISOString(),
  }));

  const dataset = process.env.BIGQUERY_DATASET ?? 'togari_data_lake';
  await bq.dataset(dataset).table('enrichments').insert(rows).catch(err => {
    process.stderr.write(`Enrichment write failed: ${err.message}\n`);
  });
}

// ─── External API Clients ──────────────────────────────────────────────────

async function callClayEnrichCompany(
  domain: string,
  apiKey: string,
): Promise<unknown | null> {
  try {
    await clayThrottle.waitForSlot();
    const res = await fetch(`${CLAY_API_BASE}/enrichment/company`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ domain }),
    });
    if (!res.ok) {
      process.stderr.write(`Clay company enrich failed (${res.status}): ${domain}\n`);
      return null;
    }
    return await res.json();
  } catch (err) {
    process.stderr.write(`Clay company enrich error: ${err instanceof Error ? err.message : err}\n`);
    return null;
  }
}

async function callClayEnrichContact(
  email: string,
  name: string,
  apiKey: string,
): Promise<unknown | null> {
  try {
    await clayThrottle.waitForSlot();
    const res = await fetch(`${CLAY_API_BASE}/enrichment/contact`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, name }),
    });
    if (!res.ok) {
      process.stderr.write(`Clay contact enrich failed (${res.status}): ${email}\n`);
      return null;
    }
    return await res.json();
  } catch (err) {
    process.stderr.write(`Clay contact enrich error: ${err instanceof Error ? err.message : err}\n`);
    return null;
  }
}

async function callExaSearch(
  query: string,
  apiKey: string,
): Promise<unknown | null> {
  try {
    if (exaThrottle.remainingCalls <= 0) {
      process.stderr.write('Exa daily limit reached — skipping\n');
      return null;
    }
    await exaThrottle.waitForSlot();
    const res = await fetch(`${EXA_API_BASE}/search`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        num_results: 5,
        use_autoprompt: true,
      }),
    });
    if (!res.ok) {
      process.stderr.write(`Exa search failed (${res.status}): ${query}\n`);
      return null;
    }
    return await res.json();
  } catch (err) {
    process.stderr.write(`Exa search error: ${err instanceof Error ? err.message : err}\n`);
    return null;
  }
}

function normalizeEnrichmentData(
  clayCompany: unknown | null,
  clayContact: unknown | null,
  exaNews: unknown | null,
): unknown {
  // Combine and normalize results into a clean schema
  const normalized: Record<string, unknown> = {};

  if (clayCompany && typeof clayCompany === 'object') {
    const cc = clayCompany as Record<string, unknown>;
    normalized.company = {
      revenue: cc.revenue ?? cc.annual_revenue ?? null,
      headcount: cc.headcount ?? cc.employee_count ?? null,
      industry: cc.industry ?? null,
      tech_stack: cc.tech_stack ?? cc.technologies ?? [],
      description: cc.description ?? null,
      founded_year: cc.founded_year ?? cc.founded ?? null,
    };
  }

  if (clayContact && typeof clayContact === 'object') {
    const ct = clayContact as Record<string, unknown>;
    normalized.contact = {
      verified_email: ct.verified_email ?? ct.email ?? null,
      phone: ct.phone ?? ct.direct_phone ?? null,
      seniority: ct.seniority ?? ct.level ?? null,
      department: ct.department ?? null,
      title: ct.title ?? ct.job_title ?? null,
    };
  }

  if (exaNews && typeof exaNews === 'object') {
    const en = exaNews as Record<string, unknown>;
    const results = Array.isArray(en.results) ? en.results : [];
    normalized.recent_news = results.slice(0, 5).map((r: unknown) => {
      if (r && typeof r === 'object') {
        const item = r as Record<string, unknown>;
        return {
          title: item.title ?? null,
          url: item.url ?? null,
          published_date: item.published_date ?? item.publishedDate ?? null,
          summary: item.text ? String(item.text).slice(0, 200) : null,
        };
      }
      return r;
    });
  }

  return normalized;
}

// ─── Enrichment Orchestrator ───────────────────────────────────────────────

async function enrichContact(
  contact: ContactRow,
  clayApiKey: string | undefined,
  exaApiKey: string | undefined,
): Promise<EnrichmentResult> {
  const contactId = contact.workEmail || contact.linkedinUrl || 'unknown';
  const company = contact.currentCompany || 'Unknown';
  const domain = contact.companyDomain || '';
  const sourceApis: string[] = [];
  let totalCost = 0;
  const errors: string[] = [];

  let clayCompany: unknown | null = null;
  let clayContact: unknown | null = null;
  let exaNews: unknown | null = null;

  // Clay enrichment
  if (clayApiKey && domain) {
    clayCompany = await callClayEnrichCompany(domain, clayApiKey);
    totalCost += CLAY_COST_PER_CALL;
    if (clayCompany) sourceApis.push('clay_company');
    else errors.push('clay_company_failed');

    if (contact.workEmail) {
      clayContact = await callClayEnrichContact(
        contact.workEmail,
        contact.fullName || '',
        clayApiKey,
      );
      totalCost += CLAY_COST_PER_CALL;
      if (clayContact) sourceApis.push('clay_contact');
      else errors.push('clay_contact_failed');
    }
  }

  // Exa news search
  if (exaApiKey && company !== 'Unknown') {
    exaNews = await callExaSearch(`${company} recent news updates`, exaApiKey);
    totalCost += EXA_COST_PER_CALL;
    if (exaNews) sourceApis.push('exa');
    else errors.push('exa_failed');
  }

  // Normalize (always runs — structify step)
  const normalized = normalizeEnrichmentData(clayCompany, clayContact, exaNews);
  if (normalized && Object.keys(normalized as object).length > 0) {
    sourceApis.push('structify');
  }

  const hasAnyData = clayCompany || clayContact || exaNews;
  const allFailed = sourceApis.filter(s => s !== 'structify').length === 0 && errors.length > 0;

  return {
    contact_id: contactId,
    company,
    company_domain: domain,
    clay_company: clayCompany,
    clay_contact: clayContact,
    exa_news: exaNews,
    structify_normalized: normalized,
    source_apis: sourceApis,
    cost_usd: totalCost,
    status: allFailed ? 'failed' : hasAnyData ? 'success' : 'partial',
    error_message: errors.join('; '),
  };
}

// ─── Tool Registration ─────────────────────────────────────────────────────

export function registerDataEnrichmentTools(server: McpServer): void {
  server.tool(
    'analytics_enrich_data',
    'Batch contact enrichment: queries contacts from BigQuery, enriches via Clay (company/contact data), ' +
    'Exa (web intelligence/news), and Structify (normalization). Writes results to the enrichments table. ' +
    'Respects rate limits: max 10 Clay calls/min, 100 Exa calls/day. ' +
    'Returns { total, enriched, skipped, failed, cost_usd, results_preview }.',
    {
      client_id: z.string().describe('BMA tenant client identifier'),
      contact_ids: z.array(z.string()).optional()
        .describe('Specific contact IDs (workEmail or linkedinUrl) to enrich'),
      filter: z.string().optional()
        .describe('BigQuery WHERE clause fragment, e.g. "currentCompany LIKE \'%healthcare%\'"'),
      force_refresh: z.boolean().optional().default(false)
        .describe('Re-enrich contacts even if enriched within last 30 days'),
    },
    async (params) => {
      try {
        // Validate: at least one selector required
        if (!params.contact_ids?.length && !params.filter) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                error: 'validation_error',
                message: 'Provide at least one of contact_ids or filter to select contacts.',
              }),
            }],
            isError: true,
          };
        }

        const bq = getBqClient();
        const notes: string[] = [];

        // Load API keys from environment
        const clayApiKey = process.env.CLAY_API_KEY;
        const exaApiKey = process.env.EXA_API_KEY;

        if (!clayApiKey) notes.push('CLAY_API_KEY not configured — Clay enrichment skipped');
        if (!exaApiKey) notes.push('EXA_API_KEY not configured — Exa search skipped');

        // Step 1 + 2: Query contacts and check enrichment recency
        const contacts = await queryContacts(
          bq,
          params.client_id,
          params.contact_ids,
          params.filter,
          params.force_refresh ?? false,
        );

        const total = contacts.length;
        const toEnrich = contacts.filter(c => !c.already_enriched);
        const skipped = total - toEnrich.length;

        if (toEnrich.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                action: 'analytics_enrich_data',
                total,
                enriched: 0,
                skipped,
                failed: 0,
                cost_usd: 0,
                results_preview: [],
                notes: skipped > 0
                  ? ['All contacts were enriched within the last 30 days. Use force_refresh=true to re-enrich.']
                  : ['No contacts matched the query.'],
              }, null, 2),
            }],
          };
        }

        // Cost estimate check
        const estimatedClayCalls = clayApiKey ? toEnrich.length * 2 : 0; // company + contact
        const estimatedExaCalls = exaApiKey ? toEnrich.length : 0;
        const estimatedCost =
          estimatedClayCalls * CLAY_COST_PER_CALL +
          estimatedExaCalls * EXA_COST_PER_CALL;

        if (estimatedCost > MAX_COST_PER_BATCH_USD) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                error: 'cost_limit_exceeded',
                message: `Estimated cost $${estimatedCost.toFixed(2)} exceeds $${MAX_COST_PER_BATCH_USD} limit. ` +
                  `Reduce batch size (currently ${toEnrich.length} contacts) or enrich in smaller batches.`,
                contacts_found: toEnrich.length,
              }),
            }],
            isError: true,
          };
        }

        // Step 3: Enrich each contact
        const results: EnrichmentResult[] = [];
        for (const contact of toEnrich) {
          const result = await enrichContact(contact, clayApiKey, exaApiKey);
          results.push(result);
        }

        // Step 4: Write to BigQuery
        const successResults = results.filter(r => r.status !== 'failed');
        await writeEnrichmentResults(bq, params.client_id, successResults);

        // Step 5: Compute summary
        const enriched = results.filter(r => r.status === 'success').length;
        const partial = results.filter(r => r.status === 'partial').length;
        const failed = results.filter(r => r.status === 'failed').length;
        const totalCost = results.reduce((sum, r) => sum + r.cost_usd, 0);

        const resultsPreview = results.slice(0, 5).map(r => ({
          contact: r.contact_id,
          company: r.company,
          status: r.status,
          sources: r.source_apis,
        }));

        if (partial > 0) {
          notes.push(`${partial} contacts partially enriched (some APIs failed or returned no data)`);
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'analytics_enrich_data',
              total,
              enriched: enriched + partial,
              skipped,
              failed,
              cost_usd: Math.round(totalCost * 1000) / 1000,
              results_preview: resultsPreview,
              notes: notes.length > 0 ? notes : undefined,
            }, null, 2),
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: 'enrich_data_failed',
              message,
            }),
          }],
          isError: true,
        };
      }
    },
  );
}
