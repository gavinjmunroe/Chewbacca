/**
 * Enrichment Pipeline — Two modes:
 *
 * V1 (Legacy Clay workflow — still supported):
 *   Step 1: "Find Companies" — Exa search by industry + location
 *   Step 2: "Job Posting" signal — Exa search for job postings
 *   Step 3: Recruiter enrichment — Clay contact enrichment
 *   Step 4: Sync to Clay — push results to pre-configured Clay table
 *
 * V2 (Signal Query):
 *   1. Parse natural language signal_query via Claude → structured search params
 *   2. Run Exa search with structured params
 *   3. Dedup against togari_structured_contacts by email
 *   4. Clay enrichment for net-new contacts (10/min rate limit)
 *   5. Store new contacts in togari_structured_contacts
 *   6. Write SignalResult to signal_results table
 *   7. Return SignalResult with matched_contacts and new_since_last_run
 *
 * Rate limits: Clay 10 calls/min, Exa 100 calls/day.
 */

import Anthropic from '@anthropic-ai/sdk';
import { BigQuery } from '@google-cloud/bigquery';
import { randomUUID } from 'crypto';
import type {
  Subscription,
  DiscoveredCompany,
  JobPostingMatch,
  RecruiterContact,
  EnrichmentRunStats,
  SeniorityLevel,
  ContactMatch,
  ExaResult,
  SignalResult,
  ContactSource,
} from './types';

// ─── Constants ────────────────────────────────────────────────────────────

const CLAY_API_BASE = 'https://api.clay.com/v1';
const EXA_API_BASE = 'https://api.exa.ai';
const CLAY_COST_PER_CALL = 0.01;
const EXA_COST_PER_CALL = 0.001;
const MAX_POSTINGS_PER_NOTIFICATION = 20;
const MAX_EXA_CALLS_PER_CRON = 50;

const JOB_BOARD_DOMAINS = [
  'linkedin.com',
  'greenhouse.io',
  'lever.co',
  'indeed.com',
  'boards.greenhouse.io',
  'jobs.lever.co',
  'wellfound.com',
  'builtin.com',
];

/** Maps seniority levels to search keywords for Exa queries */
const SENIORITY_KEYWORDS: Record<SeniorityLevel, string[]> = {
  internship: ['intern', 'internship'],
  entry_level: ['entry level', 'junior', 'associate', 'entry-level'],
  associate: ['associate', 'analyst'],
  mid_senior: ['senior', 'mid-senior', 'lead', 'staff'],
  director: ['director', 'head of', 'vp'],
  executive: ['c-suite', 'chief', 'ceo', 'cto', 'cfo', 'executive'],
};

// ─── API Throttle ─────────────────────────────────────────────────────────

class ApiThrottle {
  private callTimestamps: number[] = [];

  constructor(
    private maxCalls: number,
    private windowMs: number,
  ) {}

  async waitForSlot(): Promise<void> {
    const now = Date.now();
    this.callTimestamps = this.callTimestamps.filter(t => now - t < this.windowMs);

    if (this.callTimestamps.length >= this.maxCalls) {
      const oldest = this.callTimestamps[0];
      const waitMs = this.windowMs - (now - oldest) + 50;
      if (waitMs > 0) {
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
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

  reset(): void {
    this.callTimestamps = [];
  }
}

const clayThrottle = new ApiThrottle(10, 60_000);
const exaThrottle = new ApiThrottle(100, 86_400_000);

/** Track Exa calls within a single cron run for the per-run cap */
let exaCallsThisRun = 0;

export function resetRunExaCounter(): void {
  exaCallsThisRun = 0;
}

export function clearClayThrottle(): void {
  clayThrottle.reset();
}

// ─── Exa Cache ────────────────────────────────────────────────────────────

const exaCache = new Map<string, ExaSearchResult[]>();

interface ExaSearchResult {
  title: string;
  url: string;
  published_date: string | null;
  text: string | null;
  author: string | null;
}

// ─── BigQuery Helpers ─────────────────────────────────────────────────────

function getBqClient(): BigQuery {
  const projectId = process.env.GCP_PROJECT_ID ?? 'midyear-glazing-485303-u3';
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

function fqt(table: string): string {
  const project = process.env.GCP_PROJECT_ID ?? 'midyear-glazing-485303-u3';
  const dataset = process.env.BIGQUERY_DATASET ?? 'togari_data_lake';
  return `\`${project}.${dataset}.${table}\``;
}

// ─── Anthropic Client ────────────────────────────────────────────────────

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

// ═══════════════════════════════════════════════════════════════════════════
// V2: SIGNAL QUERY PIPELINE
// ═══════════════════════════════════════════════════════════════════════════

/** Structured search params parsed from a natural language signal query */
interface ParsedSignalQuery {
  job_titles: string[];
  industries: string[];
  locations: string[];
  companies: string[];
  keywords: string[];
  seniority: SeniorityLevel | null;
}

/**
 * Parse a natural language signal query into structured search parameters using Claude.
 */
async function parseSignalQuery(signalQuery: string): Promise<ParsedSignalQuery> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Fallback: treat the entire query as keywords
    return {
      job_titles: [],
      industries: [],
      locations: ['United States'],
      companies: [],
      keywords: signalQuery.split(/[,;]+/).map(s => s.trim()).filter(Boolean),
      seniority: null,
    };
  }

  try {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Parse this natural language signal query into structured search parameters for finding contacts and job postings. Return ONLY valid JSON, no markdown.

Signal query: "${signalQuery}"

Return JSON with these fields:
{
  "job_titles": ["specific role titles to search for"],
  "industries": ["industry verticals"],
  "locations": ["geographic locations, default to 'United States' if none specified"],
  "companies": ["specific company names if mentioned"],
  "keywords": ["additional search terms"],
  "seniority": null or one of "internship", "entry_level", "associate", "mid_senior", "director", "executive"
}

Extract as many relevant parameters as you can from the query. Be specific with job titles.`,
      }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');

    const parsed = JSON.parse(text) as ParsedSignalQuery;
    // Ensure required arrays exist
    return {
      job_titles: Array.isArray(parsed.job_titles) ? parsed.job_titles : [],
      industries: Array.isArray(parsed.industries) ? parsed.industries : [],
      locations: Array.isArray(parsed.locations) && parsed.locations.length > 0
        ? parsed.locations
        : ['United States'],
      companies: Array.isArray(parsed.companies) ? parsed.companies : [],
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
      seniority: parsed.seniority || null,
    };
  } catch (err) {
    process.stderr.write(`Signal query parse error: ${err instanceof Error ? err.message : err}\n`);
    return {
      job_titles: [],
      industries: [],
      locations: ['United States'],
      companies: [],
      keywords: signalQuery.split(/[,;]+/).map(s => s.trim()).filter(Boolean),
      seniority: null,
    };
  }
}

/**
 * Search Exa with parsed signal params, returning raw ExaResult[] for the signal result.
 */
async function runSignalExaSearch(
  params: ParsedSignalQuery,
  exaApiKey: string,
  maxResults: number,
): Promise<{ exaResults: ExaResult[]; exaCalls: number }> {
  const exaResults: ExaResult[] = [];
  let exaCalls = 0;

  // Build search queries from parsed params
  const queries: string[] = [];

  // Job title + location queries
  for (const title of params.job_titles.slice(0, 5)) {
    const locationClause = params.locations[0] || 'United States';
    const seniorityClause = params.seniority
      ? ` ${SENIORITY_KEYWORDS[params.seniority].slice(0, 2).join(' OR ')}`
      : '';
    queries.push(`"${title}"${seniorityClause} hiring ${locationClause}`);
  }

  // Industry + keyword queries
  for (const industry of params.industries.slice(0, 3)) {
    const kwClause = params.keywords.slice(0, 3).join(' ');
    queries.push(`${industry} ${kwClause} hiring ${params.locations[0] || 'United States'}`);
  }

  // Specific company queries
  for (const company of params.companies.slice(0, 5)) {
    const titleClause = params.job_titles.length > 0
      ? params.job_titles.slice(0, 2).map(t => `"${t}"`).join(' OR ')
      : params.keywords.join(' ');
    queries.push(`${titleClause} "${company}" hiring`);
  }

  // Deduplicate queries
  const uniqueQueries = [...new Set(queries)];

  for (const query of uniqueQueries) {
    if (exaThrottle.remainingCalls <= 0) break;
    if (exaCallsThisRun >= MAX_EXA_CALLS_PER_CRON) break;

    const cached = exaCache.get(query);
    let results: ExaSearchResult[];

    if (cached) {
      results = cached;
    } else {
      try {
        await exaThrottle.waitForSlot();
        const res = await fetch(`${EXA_API_BASE}/search`, {
          method: 'POST',
          headers: {
            'x-api-key': exaApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query,
            num_results: Math.min(maxResults, 20),
            use_autoprompt: true,
          }),
        });

        exaCalls++;
        exaCallsThisRun++;

        if (!res.ok) {
          process.stderr.write(`Exa signal search failed (${res.status}): ${query}\n`);
          continue;
        }

        const data = await res.json() as { results?: unknown[] };
        results = (data.results || []).map(parseExaResult);
        exaCache.set(query, results);
      } catch (err) {
        process.stderr.write(`Exa signal search error: ${err instanceof Error ? err.message : err}\n`);
        continue;
      }
    }

    for (const r of results) {
      exaResults.push({
        title: r.title,
        url: r.url,
        published_date: r.published_date,
        text: r.text,
        author: r.author,
        highlight: r.text ? r.text.slice(0, 200) : null,
        score: null,
      });
    }
  }

  // Deduplicate by URL
  const seenUrls = new Set<string>();
  const deduped = exaResults.filter(r => {
    if (seenUrls.has(r.url)) return false;
    seenUrls.add(r.url);
    return true;
  });

  process.stderr.write(`  Signal Exa search: ${deduped.length} results from ${exaCalls} API calls\n`);
  return { exaResults: deduped, exaCalls };
}

/**
 * Check BigQuery togari_structured_contacts for existing contacts by email.
 * Returns a Set of known emails for dedup.
 */
async function getExistingContactEmails(emails: string[]): Promise<Set<string>> {
  if (emails.length === 0) return new Set();

  try {
    const bq = getBqClient();
    const [rows] = await bq.query({
      query: `
        SELECT LOWER(workEmail) as email
        FROM ${fqt('togari_structured_contacts')}
        WHERE LOWER(workEmail) IN UNNEST(@emails)
      `,
      params: { emails: emails.map(e => e.toLowerCase()) },
      useLegacySql: false,
    });

    return new Set((rows as Record<string, unknown>[]).map(r => String(r.email)));
  } catch (err) {
    process.stderr.write(`Contact dedup query error: ${err instanceof Error ? err.message : err}\n`);
    return new Set();
  }
}

/**
 * Enrich contacts via Clay API — returns enriched ContactMatch[].
 * Respects 10/min rate limit via clayThrottle.
 */
async function enrichContactsViaClay(
  rawContacts: Array<{ name: string; company: string; domain: string | null }>,
  clayApiKey: string,
): Promise<ContactMatch[]> {
  const enriched: ContactMatch[] = [];

  for (const contact of rawContacts) {
    if (clayThrottle.remainingCalls <= 0) {
      process.stderr.write('  Clay rate limit reached — stopping enrichment\n');
      break;
    }

    try {
      await clayThrottle.waitForSlot();
      const res = await fetch(`${CLAY_API_BASE}/enrichment/contact`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${clayApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: contact.name,
          company: contact.company,
          domain: contact.domain,
        }),
      });

      if (!res.ok) continue;

      const data = await res.json() as Record<string, unknown>;
      enriched.push({
        contact_id: randomUUID(),
        name: contact.name,
        title: data.title ? String(data.title) : null,
        email: data.verified_email ? String(data.verified_email)
          : data.email ? String(data.email) : null,
        linkedin_url: data.linkedin_url ? String(data.linkedin_url) : null,
        company: contact.company,
        company_domain: contact.domain,
        source: 'clay' as ContactSource,
        confidence_score: data.confidence ? Number(data.confidence) : null,
      });
    } catch {
      // Clay enrichment failed for this contact — continue
    }
  }

  return enriched;
}

/**
 * Store new contacts in BigQuery togari_structured_contacts.
 */
async function storeNewContacts(contacts: ContactMatch[]): Promise<void> {
  if (contacts.length === 0) return;

  try {
    const bq = getBqClient();
    const dataset = process.env.BIGQUERY_DATASET ?? 'togari_data_lake';
    const now = new Date().toISOString();

    const rows = contacts
      .filter(c => c.email) // Only store contacts with emails
      .map(c => {
        const nameParts = (c.name || '').split(' ');
        return {
          linkedinUrl: c.linkedin_url || null,
          fullName: c.name || null,
          firstName: nameParts[0] || null,
          lastName: nameParts.slice(1).join(' ') || null,
          workEmail: c.email,
          phone: null,
          currentTitle: c.title || null,
          currentCompany: c.company,
          companyDomain: c.company_domain || null,
          createdAt: now,
        };
      });

    if (rows.length > 0) {
      await bq.dataset(dataset).table('togari_structured_contacts').insert(rows);
      process.stderr.write(`  Stored ${rows.length} new contacts in togari_structured_contacts\n`);
    }
  } catch (err) {
    process.stderr.write(`Store contacts error: ${err instanceof Error ? err.message : err}\n`);
  }
}

/**
 * Write a SignalResult to the BigQuery signal_results table.
 */
async function writeSignalResult(result: SignalResult): Promise<void> {
  try {
    const bq = getBqClient();
    const dataset = process.env.BIGQUERY_DATASET ?? 'togari_data_lake';

    await bq.dataset(dataset).table('signal_results').insert([{
      result_id: result.result_id,
      subscription_id: result.subscription_id,
      matched_contacts: JSON.stringify(result.matched_contacts),
      exa_results: JSON.stringify(result.exa_results),
      new_since_last_run: result.new_since_last_run,
      created_at: result.created_at,
    }]);
  } catch (err) {
    process.stderr.write(`Write signal result error: ${err instanceof Error ? err.message : err}\n`);
  }
}

/**
 * V2 Signal Query Pipeline — runs the full signal processing flow.
 *
 * 1. Parse signal_query → structured params via Claude
 * 2. Exa search with structured params
 * 3. Extract contacts from Exa results
 * 4. Dedup against togari_structured_contacts by email
 * 5. Clay enrichment for net-new contacts
 * 6. Store new contacts in BigQuery
 * 7. Write SignalResult to signal_results table
 * 8. Return SignalResult
 */
export async function runSignalQuery(subscription: Subscription): Promise<SignalResult> {
  const signalQuery = subscription.signal_query;
  if (!signalQuery) {
    throw new Error('Subscription has no signal_query — use legacy enrichment pipeline instead');
  }

  const exaApiKey = process.env.EXA_API_KEY;
  const clayApiKey = process.env.CLAY_API_KEY;

  process.stderr.write(`  Signal query: "${signalQuery}"\n`);

  // Step 1: Parse natural language query into structured params
  const parsed = await parseSignalQuery(signalQuery);
  process.stderr.write(`  Parsed: ${parsed.job_titles.length} titles, ${parsed.industries.length} industries, ${parsed.companies.length} companies\n`);

  // Step 2: Run Exa search
  let exaResults: ExaResult[] = [];
  let exaCalls = 0;
  if (exaApiKey) {
    const searchResult = await runSignalExaSearch(
      parsed,
      exaApiKey,
      subscription.companies_limit || subscription.max_companies,
    );
    exaResults = searchResult.exaResults;
    exaCalls = searchResult.exaCalls;
  } else {
    process.stderr.write('  EXA_API_KEY not configured — skipping Exa search\n');
  }

  // Step 3: Extract potential contacts from Exa results
  const rawContacts: Array<{ name: string; company: string; domain: string | null; email: string | null }> = [];
  for (const result of exaResults) {
    const company = extractCompanyFromTitle(result.title);
    const domain = extractDomainFromUrl(result.url);
    const name = result.author || extractNameFromTitle(result.title);
    if (name && company) {
      // Generate guessed email for dedup lookup
      const guessedEmail = domain
        ? `${name.toLowerCase().replace(/\s+/g, '.')}@${domain}`
        : null;
      rawContacts.push({ name, company, domain, email: guessedEmail });
    }
  }

  // Step 4: Dedup against existing contacts
  const candidateEmails = rawContacts
    .map(c => c.email)
    .filter((e): e is string => e !== null);
  const existingEmails = await getExistingContactEmails(candidateEmails);
  const newRawContacts = rawContacts.filter(
    c => !c.email || !existingEmails.has(c.email.toLowerCase())
  );
  process.stderr.write(`  Dedup: ${rawContacts.length} candidates, ${existingEmails.size} existing, ${newRawContacts.length} net-new\n`);

  // Step 5: Clay enrichment for net-new contacts
  let matchedContacts: ContactMatch[] = [];
  if (clayApiKey && newRawContacts.length > 0) {
    matchedContacts = await enrichContactsViaClay(newRawContacts, clayApiKey);
    process.stderr.write(`  Clay enriched: ${matchedContacts.length} contacts\n`);
  } else {
    // Build ContactMatch from raw data without Clay enrichment
    matchedContacts = newRawContacts.map(c => ({
      contact_id: randomUUID(),
      name: c.name,
      title: null,
      email: c.email,
      linkedin_url: null,
      company: c.company,
      company_domain: c.domain,
      source: 'exa' as ContactSource,
      confidence_score: null,
    }));
  }

  // Also include existing matches (already in datalake) as matches with 'datalake' source
  const existingMatches: ContactMatch[] = rawContacts
    .filter(c => c.email && existingEmails.has(c.email.toLowerCase()))
    .map(c => ({
      contact_id: randomUUID(),
      name: c.name,
      title: null,
      email: c.email,
      linkedin_url: null,
      company: c.company,
      company_domain: c.domain,
      source: 'datalake' as ContactSource,
      confidence_score: null,
    }));

  const allMatches = [...matchedContacts, ...existingMatches];

  // Step 6: Store new contacts in BigQuery
  await storeNewContacts(matchedContacts);

  // Step 7: Build and write SignalResult
  const signalResult: SignalResult = {
    result_id: randomUUID(),
    subscription_id: subscription.subscription_id,
    matched_contacts: allMatches,
    exa_results: exaResults,
    new_since_last_run: matchedContacts.length,
    created_at: new Date().toISOString(),
  };

  await writeSignalResult(signalResult);

  process.stderr.write(
    `  Signal complete: ${allMatches.length} total matches, ${matchedContacts.length} new, ` +
    `${exaCalls} Exa calls\n`
  );

  return signalResult;
}

// ═══════════════════════════════════════════════════════════════════════════
// V1: LEGACY ENRICHMENT PIPELINE (Find Companies → Job Postings → Recruiters → Clay Sync)
// ═══════════════════════════════════════════════════════════════════════════

// ── STEP 1: FIND COMPANIES ───────────────────────────────────────────────

async function findCompanies(
  industries: string[],
  location: string,
  maxCompanies: number,
  exaApiKey: string,
  stats: EnrichmentRunStats,
): Promise<DiscoveredCompany[]> {
  const allCompanies: DiscoveredCompany[] = [];
  const seenDomains = new Set<string>();

  for (const industry of industries) {
    if (exaThrottle.remainingCalls <= 0) break;
    if (allCompanies.length >= maxCompanies) break;

    const query = `companies in ${industry} industry ${location} hiring`;
    const cached = exaCache.get(query);
    let results: ExaSearchResult[];

    if (cached) {
      results = cached;
    } else {
      try {
        await exaThrottle.waitForSlot();
        const res = await fetch(`${EXA_API_BASE}/search`, {
          method: 'POST',
          headers: {
            'x-api-key': exaApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query,
            num_results: Math.min(maxCompanies, 30),
            use_autoprompt: true,
          }),
        });

        stats.exa_calls++;
        stats.cost_usd += EXA_COST_PER_CALL;

        if (!res.ok) {
          process.stderr.write(`Exa company search failed (${res.status}): ${query}\n`);
          continue;
        }

        const data = await res.json() as { results?: unknown[] };
        results = (data.results || []).map(parseExaResult);
        exaCache.set(query, results);
      } catch (err) {
        process.stderr.write(`Exa company search error: ${err instanceof Error ? err.message : err}\n`);
        continue;
      }
    }

    for (const result of results) {
      if (allCompanies.length >= maxCompanies) break;

      const domain = extractDomainFromUrl(result.url);
      if (domain && seenDomains.has(domain)) continue;
      if (domain) seenDomains.add(domain);

      const companyName = extractCompanyFromTitle(result.title) || domain || 'Unknown';

      allCompanies.push({
        name: companyName,
        domain,
        industry,
        location,
        headcount: null,
        description: result.text ? result.text.slice(0, 200) : null,
        source: 'exa',
      });
    }
  }

  stats.companies_found = allCompanies.length;
  process.stderr.write(`  Step 1: Found ${allCompanies.length} companies across ${industries.length} industries\n`);
  return allCompanies;
}

// ── STEP 2: JOB POSTING SIGNAL ───────────────────────────────────────────

async function findJobPostings(
  companies: DiscoveredCompany[],
  jobTitles: string[],
  seniority: SeniorityLevel | null,
  keywords: string[],
  exaApiKey: string,
  stats: EnrichmentRunStats,
): Promise<JobPostingMatch[]> {
  const allPostings: JobPostingMatch[] = [];

  const seniorityTerms = seniority
    ? SENIORITY_KEYWORDS[seniority].slice(0, 3)
    : [];

  for (const title of jobTitles.slice(0, 5)) {
    if (exaThrottle.remainingCalls <= 0) break;

    const seniorityClause = seniorityTerms.length > 0
      ? ` (${seniorityTerms.map(t => `"${t}"`).join(' OR ')})`
      : '';
    const keywordClause = keywords.length > 0 ? ` ${keywords.join(' ')}` : '';
    const query = `"${title}"${seniorityClause}${keywordClause} job posting United States`;

    const cached = exaCache.get(query);
    let results: ExaSearchResult[];

    if (cached) {
      results = cached;
    } else {
      try {
        await exaThrottle.waitForSlot();
        const res = await fetch(`${EXA_API_BASE}/search`, {
          method: 'POST',
          headers: {
            'x-api-key': exaApiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query,
            num_results: 20,
            use_autoprompt: true,
            include_domains: JOB_BOARD_DOMAINS,
          }),
        });

        stats.exa_calls++;
        stats.cost_usd += EXA_COST_PER_CALL;

        if (!res.ok) {
          process.stderr.write(`Exa job search failed (${res.status}): ${query}\n`);
          continue;
        }

        const data = await res.json() as { results?: unknown[] };
        results = (data.results || []).map(parseExaResult);
        exaCache.set(query, results);
      } catch (err) {
        process.stderr.write(`Exa job search error: ${err instanceof Error ? err.message : err}\n`);
        continue;
      }
    }

    for (const result of results) {
      const company = extractCompanyFromTitle(result.title) || extractCompanyFromUrl(result.url);
      const detectedSeniority = seniority ? detectSeniority(result.title, seniority) : null;

      allPostings.push({
        title: result.title,
        company: company || 'Unknown',
        company_domain: extractDomainFromUrl(result.url),
        url: result.url,
        posted_date: result.published_date,
        seniority: detectedSeniority,
        employment_type: null,
        location: 'United States',
        source: 'exa',
      });
    }
  }

  // Also search specifically for discovered companies' job postings
  const topCompanies = companies.filter(c => c.domain).slice(0, 10);
  for (const company of topCompanies) {
    if (exaThrottle.remainingCalls <= 0) break;

    const titleClause = jobTitles.slice(0, 3).map(t => `"${t}"`).join(' OR ');
    const query = `${titleClause} "${company.name}" job posting`;

    if (exaCache.has(query)) continue;

    try {
      await exaThrottle.waitForSlot();
      const res = await fetch(`${EXA_API_BASE}/search`, {
        method: 'POST',
        headers: {
          'x-api-key': exaApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          num_results: 5,
          use_autoprompt: true,
          include_domains: JOB_BOARD_DOMAINS,
        }),
      });

      stats.exa_calls++;
      stats.cost_usd += EXA_COST_PER_CALL;

      if (!res.ok) continue;

      const data = await res.json() as { results?: unknown[] };
      const results = (data.results || []).map(parseExaResult);
      exaCache.set(query, results);

      for (const result of results) {
        const detectedSeniority = seniority ? detectSeniority(result.title, seniority) : null;
        allPostings.push({
          title: result.title,
          company: company.name,
          company_domain: company.domain,
          url: result.url,
          posted_date: result.published_date,
          seniority: detectedSeniority,
          employment_type: null,
          location: 'United States',
          source: 'exa',
        });
      }
    } catch {
      continue;
    }
  }

  // Deduplicate by URL
  const seenUrls = new Set<string>();
  const deduped = allPostings.filter(p => {
    if (seenUrls.has(p.url)) return false;
    seenUrls.add(p.url);
    return true;
  });

  stats.postings_found = deduped.length;
  process.stderr.write(`  Step 2: Found ${deduped.length} job postings for ${jobTitles.length} roles\n`);
  return deduped.slice(0, MAX_POSTINGS_PER_NOTIFICATION);
}

// ── STEP 3: RECRUITER ENRICHMENT ─────────────────────────────────────────

async function enrichRecruiters(
  postings: JobPostingMatch[],
  exaApiKey: string | undefined,
  clayApiKey: string | undefined,
  stats: EnrichmentRunStats,
): Promise<Map<string, RecruiterContact>> {
  const recruiters = new Map<string, RecruiterContact>();
  const companies = [...new Set(postings.map(p => p.company))].slice(0, 10);

  for (const companyName of companies) {
    const posting = postings.find(p => p.company === companyName);
    const domain = posting?.company_domain;

    if (exaApiKey && exaThrottle.remainingCalls > 0) {
      const query = `"recruiter" OR "talent acquisition" "${companyName}" site:linkedin.com`;
      if (!exaCache.has(query)) {
        try {
          await exaThrottle.waitForSlot();
          const res = await fetch(`${EXA_API_BASE}/search`, {
            method: 'POST',
            headers: {
              'x-api-key': exaApiKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              query,
              num_results: 3,
              use_autoprompt: false,
              include_domains: ['linkedin.com'],
            }),
          });

          stats.exa_calls++;
          stats.cost_usd += EXA_COST_PER_CALL;

          if (res.ok) {
            const data = await res.json() as { results?: unknown[] };
            const results = (data.results || []).map(parseExaResult);
            exaCache.set(query, results);

            if (results.length > 0) {
              const top = results[0];
              const recruiter: RecruiterContact = {
                name: top.author || extractNameFromTitle(top.title),
                title: extractRoleFromTitle(top.title),
                email: null,
                linkedin_url: top.url,
                company: companyName,
              };

              if (clayApiKey && recruiter.name && domain) {
                try {
                  await clayThrottle.waitForSlot();
                  const clayRes = await fetch(`${CLAY_API_BASE}/enrichment/contact`, {
                    method: 'POST',
                    headers: {
                      'Authorization': `Bearer ${clayApiKey}`,
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      email: `${recruiter.name.toLowerCase().replace(/\s+/g, '.')}@${domain}`,
                      name: recruiter.name,
                    }),
                  });

                  stats.clay_calls++;
                  stats.cost_usd += CLAY_COST_PER_CALL;

                  if (clayRes.ok) {
                    const contactData = await clayRes.json() as Record<string, unknown>;
                    recruiter.email = contactData.verified_email
                      ? String(contactData.verified_email)
                      : contactData.email
                        ? String(contactData.email)
                        : null;
                  }
                } catch { /* Clay enrichment failed — continue without email */ }
              }

              recruiters.set(companyName, recruiter);
            }
          }
        } catch { /* Exa recruiter search failed — continue */ }
      }
    }
  }

  process.stderr.write(`  Step 3: Found ${recruiters.size} recruiter contacts\n`);
  return recruiters;
}

// ── STEP 4: CLAY WEBHOOK SYNC ────────────────────────────────────────────

export async function syncToClay(
  subscription: Subscription,
  postings: JobPostingMatch[],
  recruiters: Map<string, RecruiterContact>,
): Promise<boolean> {
  const webhookUrl = subscription.clay_table_webhook_url;
  if (!webhookUrl) return false;

  try {
    const rows = postings.map(posting => ({
      company_name: posting.company,
      company_domain: posting.company_domain,
      job_title: posting.title,
      job_url: posting.url,
      posted_date: posting.posted_date,
      seniority: posting.seniority,
      employment_type: posting.employment_type,
      location: posting.location,
      recruiter_name: recruiters.get(posting.company)?.name || null,
      recruiter_title: recruiters.get(posting.company)?.title || null,
      recruiter_email: recruiters.get(posting.company)?.email || null,
      recruiter_linkedin: recruiters.get(posting.company)?.linkedin_url || null,
      subscriber_email: subscription.subscriber_email,
      subscription_id: subscription.subscription_id,
      enriched_at: new Date().toISOString(),
    }));

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rows),
    });

    if (!res.ok) {
      process.stderr.write(`Clay webhook sync failed (${res.status})\n`);
      return false;
    }

    process.stderr.write(`  Step 4: Synced ${rows.length} rows to Clay table\n`);
    return true;
  } catch (err) {
    process.stderr.write(`Clay webhook sync error: ${err instanceof Error ? err.message : err}\n`);
    return false;
  }
}

// ── DEDUP AGAINST HISTORY ────────────────────────────────────────────────

async function getRecentlySentUrls(subscriptionId: string): Promise<Set<string>> {
  try {
    const bq = getBqClient();
    const [rows] = await bq.query({
      query: `
        SELECT matches_json
        FROM ${fqt('notification_history')}
        WHERE subscription_id = @sub_id
          AND sent_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
          AND status = 'sent'
      `,
      params: { sub_id: subscriptionId },
      useLegacySql: false,
    });

    const urls = new Set<string>();
    for (const row of rows as Record<string, unknown>[]) {
      try {
        const matches = typeof row.matches_json === 'string'
          ? JSON.parse(row.matches_json)
          : row.matches_json;
        if (Array.isArray(matches)) {
          for (const m of matches) {
            if (m?.job_posting?.url) urls.add(String(m.job_posting.url));
          }
        }
      } catch { /* skip malformed rows */ }
    }
    return urls;
  } catch {
    return new Set();
  }
}

// ── LEGACY PIPELINE ORCHESTRATOR ─────────────────────────────────────────

export interface EnrichmentResult {
  companies: DiscoveredCompany[];
  postings: JobPostingMatch[];
  recruiters: Map<string, RecruiterContact>;
  stats: EnrichmentRunStats;
  clay_synced: boolean;
}

export async function runEnrichmentForSubscriber(
  subscription: Subscription,
): Promise<EnrichmentResult> {
  const exaApiKey = process.env.EXA_API_KEY;
  const clayApiKey = process.env.CLAY_API_KEY;
  const stats: EnrichmentRunStats = {
    exa_calls: 0, clay_calls: 0, cost_usd: 0,
    companies_found: 0, postings_found: 0,
  };

  if (!exaApiKey) {
    process.stderr.write('EXA_API_KEY not configured — enrichment pipeline cannot run\n');
    return { companies: [], postings: [], recruiters: new Map(), stats, clay_synced: false };
  }

  // Step 1: Find Companies
  const companies = await findCompanies(
    subscription.target_industries,
    subscription.target_location || 'United States',
    subscription.max_companies,
    exaApiKey,
    stats,
  );

  // Step 2: Job Posting Signal
  const allPostings = await findJobPostings(
    companies,
    subscription.target_job_titles,
    subscription.target_seniority,
    subscription.target_keywords,
    exaApiKey,
    stats,
  );

  // Dedup against notification history
  const sentUrls = await getRecentlySentUrls(subscription.subscription_id);
  const newPostings = allPostings.filter(p => !sentUrls.has(p.url));

  // Step 3: Recruiter Enrichment
  const recruiters = await enrichRecruiters(
    newPostings.slice(0, MAX_POSTINGS_PER_NOTIFICATION),
    exaApiKey,
    clayApiKey,
    stats,
  );

  // Step 4: Sync to Clay
  const clay_synced = await syncToClay(subscription, newPostings, recruiters);

  return {
    companies,
    postings: newPostings.slice(0, MAX_POSTINGS_PER_NOTIFICATION),
    recruiters,
    stats,
    clay_synced,
  };
}

/**
 * Clear the Exa cache — call between daily runs to free memory.
 */
export function clearExaCache(): void {
  exaCache.clear();
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function parseExaResult(r: unknown): ExaSearchResult {
  const item = r as Record<string, unknown>;
  return {
    title: String(item.title || ''),
    url: String(item.url || ''),
    published_date: item.published_date ? String(item.published_date)
      : item.publishedDate ? String(item.publishedDate)
      : null,
    text: item.text ? String(item.text) : null,
    author: item.author ? String(item.author) : null,
  };
}

function extractDomainFromUrl(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.replace('www.', '');
    if (JOB_BOARD_DOMAINS.some(d => hostname.includes(d.replace('www.', '')))) return null;
    return hostname;
  } catch {
    return null;
  }
}

function extractCompanyFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;

    if (hostname.includes('greenhouse.io')) {
      const match = parsed.pathname.match(/^\/([^/]+)/);
      return match ? match[1] : null;
    }
    if (hostname.includes('lever.co')) {
      const match = parsed.pathname.match(/^\/([^/]+)/);
      return match ? match[1] : null;
    }
    return null;
  } catch {
    return null;
  }
}

function extractCompanyFromTitle(title: string): string | null {
  const atMatch = title.match(/\bat\s+(.+?)(?:\s*[-|]|\s*$)/i);
  if (atMatch) return atMatch[1].trim();

  const dashMatch = title.match(/^.+?\s*[-|]\s*(.+?)(?:\s*[-|]|\s*$)/);
  if (dashMatch) return dashMatch[1].trim();

  const hiringMatch = title.match(/^(.+?)\s+is\s+hiring/i);
  if (hiringMatch) return hiringMatch[1].trim();

  return null;
}

function extractNameFromTitle(title: string): string | null {
  const match = title.match(/^([^-|]+)/);
  if (match) {
    const name = match[1].trim();
    if (name.split(' ').length <= 4 && !name.includes('@')) return name;
  }
  return null;
}

function extractRoleFromTitle(title: string): string | null {
  const match = title.match(/[-|]\s*(.+?)(?:\s+at\s+|\s*[-|]|\s*$)/i);
  return match ? match[1].trim() : null;
}

function detectSeniority(title: string, targetLevel: SeniorityLevel): SeniorityLevel | null {
  const lower = title.toLowerCase();
  const keywords = SENIORITY_KEYWORDS[targetLevel];
  if (keywords.some(kw => lower.includes(kw))) return targetLevel;
  return null;
}
