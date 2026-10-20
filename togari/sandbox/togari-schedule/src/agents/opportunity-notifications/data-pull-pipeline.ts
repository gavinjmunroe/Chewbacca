/**
 * Data Pull Pipeline — One-Time Ad Hoc Contact List Exports
 *
 * Pipeline:
 *   1. Claude translates natural_language_query → BigQuery SQL
 *   2. Query togari_structured_contacts (scoped by client_id if applicable)
 *   3. If datalake has enough → skip to step 6
 *   4. If shortfall: Exa discovery for companies/people matching the NL query
 *   5. Clay enrichment for each discovered contact → store in BigQuery
 *   6. Compile final contact list (datalake + newly enriched)
 *   7. Generate CSV
 *   8. Upload CSV to GCS (tenants/{client_id}/data-pulls/{pull_id}.csv)
 *   9. Update DataPullRequest status → 'ready', set csv_url to signed GCS URL
 *  10. Send email notification with download link
 */

import Anthropic from '@anthropic-ai/sdk';
import { BigQuery } from '@google-cloud/bigquery';
import { randomUUID } from 'crypto';
import {
  calculateDataPullCost,
  type DataPullRequest,
  type DataPullResult,
  type StructuredContact,
  type ContactSource,
  type CompanySize,
} from './types';

// ─── Constants ────────────────────────────────────────────────────────────

const EXA_API_BASE = 'https://api.exa.ai';
const CLAY_API_BASE = 'https://api.clay.com/v1';
const GCS_API_BASE = 'https://storage.googleapis.com';
const EXA_COST_PER_CALL = 0.001;
const CLAY_COST_PER_CALL = 0.01;
const CSV_COLUMNS = ['name', 'email', 'title', 'company', 'linkedin'] as const;

// ─── Pricing ─────────────────────────────────────────────────────────────

/**
 * Re-export the canonical tiered pricing from types.ts.
 * Tiered: $0.50/contact for first 250, $0.30 for 251-1000, $0.20 for 1001+
 */
export { calculateDataPullCost };

/** @deprecated Use calculateDataPullCost from types.ts instead */
export function estimateDataPullCost(requestedCount: number): number {
  return calculateDataPullCost(requestedCount);
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

// ─── GCS Access Token ────────────────────────────────────────────────────

async function getGcsAccessToken(): Promise<string> {
  const gcpCredentialsBase64 = process.env.GCP_CREDENTIALS_BASE64;
  if (!gcpCredentialsBase64) {
    throw new Error('GCP_CREDENTIALS_BASE64 not configured — cannot upload to GCS');
  }

  const credentials = JSON.parse(
    Buffer.from(gcpCredentialsBase64, 'base64').toString('utf-8')
  ) as { client_email: string; private_key: string; token_uri?: string };

  // Create JWT for GCS access
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/devstorage.read_write',
    aud: credentials.token_uri || 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })).toString('base64url');

  // Sign with private key
  const crypto = await import('crypto');
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(credentials.private_key, 'base64url');
  const jwt = `${header}.${payload}.${signature}`;

  // Exchange JWT for access token
  const tokenRes = await fetch(credentials.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!tokenRes.ok) {
    throw new Error(`GCS token exchange failed (${tokenRes.status})`);
  }

  const tokenData = await tokenRes.json() as { access_token: string };
  return tokenData.access_token;
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP 1: NL QUERY → BIGQUERY SQL
// ═══════════════════════════════════════════════════════════════════════════

async function translateQueryToSql(nlQuery: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Fallback: simple keyword search using inline literals (BigQuery params not
    // supported here — queryDatalake passes no params object to bq.query())
    const keywords = nlQuery.split(/\s+/).filter(w => w.length > 2).slice(0, 5);
    const conditions = keywords.map(kw => {
      const safe = kw.toLowerCase().replace(/'/g, "\\'");
      return `(LOWER(fullName) LIKE '%${safe}%' OR LOWER(currentTitle) LIKE '%${safe}%' OR LOWER(currentCompany) LIKE '%${safe}%')`;
    }).join(' OR ');
    return `SELECT * FROM ${fqt('togari_structured_contacts')} WHERE ${conditions || '1=1'}`;
  }

  try {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Convert this natural language request into a precise BigQuery SQL query against a contacts table.

Table: ${fqt('togari_structured_contacts')}
Columns:
  - linkedinUrl (STRING)
  - fullName (STRING)
  - firstName (STRING)
  - lastName (STRING)
  - workEmail (STRING)
  - phone (STRING)
  - currentTitle (STRING)       -- job title, e.g. "VP of Sales", "Head of Engineering"
  - currentCompany (STRING)     -- company name only, e.g. "Stripe", "Acme Corp"
  - companyDomain (STRING)      -- e.g. "stripe.com"
  - location (STRING)           -- city/region, e.g. "New York, NY", "San Francisco, CA"
  - industry (STRING)           -- e.g. "SaaS", "FinTech", "Healthcare"
  - createdAt (TIMESTAMP)

Request: "${nlQuery}"

Rules:
- Return ONLY the SQL query, no explanation or markdown
- Always include a LIMIT clause (max 10000)
- Use LOWER() for case-insensitive matching
- Use LIKE with % wildcards for partial matches
- Select all columns with SELECT *
- Do NOT use parameterized queries — use inline string literals
- CRITICAL: Use AND to combine filters across different semantic groups (role, location, industry).
  Only use OR within the same semantic group (e.g. title synonyms).
  Example for "VP of Sales in New York":
    WHERE (LOWER(currentTitle) LIKE '%vp of sales%' OR LOWER(currentTitle) LIKE '%vice president of sales%')
      AND (LOWER(location) LIKE '%new york%')
- CRITICAL: Only filter on a column if the request clearly specifies that criterion.
  If a criterion (e.g. location, industry) cannot be reliably matched to an available column,
  OMIT that filter entirely rather than guessing at a loose match on an unrelated column.
  Never match location against currentCompany or currentTitle.
- For industry/company-type filters (e.g. "SaaS", "fintech"), filter on the industry column
  if present in the request, not on currentCompany.`,
      }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim();

    // Strip markdown code fences if present
    const sql = text.replace(/^```sql\n?/i, '').replace(/\n?```$/i, '').trim();

    // Basic safety check — must be a SELECT
    if (!sql.toUpperCase().startsWith('SELECT')) {
      throw new Error('Generated SQL is not a SELECT query');
    }

    return sql;
  } catch (err) {
    process.stderr.write(`SQL generation error: ${err instanceof Error ? err.message : err}\n`);
    process.stderr.write(`  SQL generation failed — skipping datalake, will use Exa discovery instead.\n`);
    // Return 0 rows so processDataPull falls through to Exa discovery.
    // Returning random contacts (LIMIT 100 with no WHERE) would deliver wrong results to the client.
    return `SELECT * FROM ${fqt('togari_structured_contacts')} WHERE 1=0 LIMIT 0`;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP 2: QUERY DATALAKE
// ═══════════════════════════════════════════════════════════════════════════

async function queryDatalake(
  sql: string,
  requestedCount: number,
): Promise<StructuredContact[]> {
  try {
    const bq = getBqClient();
    const [rows] = await bq.query({
      query: sql,
      useLegacySql: false,
    });

    return (rows as Record<string, unknown>[]).slice(0, requestedCount).map(row => ({
      name: row.fullName ? String(row.fullName) : `${row.firstName || ''} ${row.lastName || ''}`.trim(),
      title: row.currentTitle ? String(row.currentTitle) : null,
      email: row.workEmail ? String(row.workEmail) : null,
      phone: row.phone ? String(row.phone) : null,
      linkedin_url: row.linkedinUrl ? String(row.linkedinUrl) : null,
      company: row.currentCompany ? String(row.currentCompany) : '',
      company_domain: row.companyDomain ? String(row.companyDomain) : null,
      industry: null,
      company_size: null,
      location: null,
      source: 'datalake' as ContactSource,
      enriched_at: row.createdAt ? String(row.createdAt) : new Date().toISOString(),
    }));
  } catch (err) {
    process.stderr.write(`Datalake query error: ${err instanceof Error ? err.message : err}\n`);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// STEPS 4-5: EXA DISCOVERY + CLAY ENRICHMENT FOR SHORTFALL
// ═══════════════════════════════════════════════════════════════════════════

async function discoverAndEnrich(
  pullId: string,
  nlQuery: string,
  count: number,
): Promise<{ contacts: StructuredContact[]; cost: number }> {
  const exaApiKey = process.env.EXA_API_KEY;
  const clayApiKey = process.env.CLAY_API_KEY;
  let cost = 0;

  if (!exaApiKey) {
    process.stderr.write('EXA_API_KEY not configured — cannot discover new contacts\n');
    return { contacts: [], cost: 0 };
  }

  // Step 4: Exa search for people matching the query
  const discovered: Array<{
    name: string;
    title: string | null;
    company: string;
    /** Company domain (e.g. "ecovadis.com"). Null when not derivable from Exa results. */
    company_domain: string | null;
    url: string;
  }> = [];

  const queries = [
    `${nlQuery} linkedin profile`,
    `${nlQuery} site:linkedin.com/in`,
  ];

  for (const query of queries) {
    if (discovered.length >= count) break;

    try {
      const res = await fetch(`${EXA_API_BASE}/search`, {
        method: 'POST',
        headers: {
          'x-api-key': exaApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          // Over-request so post-filtering still leaves enough profiles
          num_results: Math.min(Math.max(count * 4, 25), 100),
          // Exa's dedicated category for LinkedIn profile pages —
          // far more reliable than include_domains alone, which still
          // returns LinkedIn posts, jobs, and company pages.
          category: 'linkedin profile',
          include_domains: ['linkedin.com'],
        }),
      });

      cost += EXA_COST_PER_CALL;

      if (!res.ok) continue;

      const data = await res.json() as { results?: Array<Record<string, unknown>> };
      for (const r of data.results || []) {
        if (discovered.length >= count) break;
        const title = String(r.title || '');
        const url = String(r.url || '');

        // Only accept LinkedIn profile pages — reject posts, jobs, company pages, etc.
        if (!url.match(/linkedin\.com\/in\/[^/]+/)) continue;

        const parsed = parseLinkedInTitle(title);
        if (!parsed) continue;
        // extractDomainFromUrl skips linkedin.com (it's in the blocklist), so
        // for LinkedIn profile URLs we derive the company domain from the
        // company name instead — e.g. "EcoVadis" → "ecovadis.com".
        const company_domain = parsed.company
          ? guessCompanyDomain(parsed.company)
          : null;
        discovered.push({
          name: parsed.name,
          title: parsed.title,
          company: parsed.company || 'Unknown',
          company_domain,
          url,
        });
      }
    } catch (err) {
      process.stderr.write(`Exa discovery error: ${err instanceof Error ? err.message : err}\n`);
    }
  }

  process.stderr.write(`  Discovered ${discovered.length} potential contacts via Exa\n`);

  // Step 5: Push contacts to Clay table source → poll for email enrichment results
  //
  // Flow:
  //   1. INSERT pending rows into clay_enrichment_results (pull_id + row_id as key)
  //   2. POST each contact to CLAY_SOURCE_WEBHOOK_URL (Clay creates a table row
  //      and runs the email waterfall)
  //   3. Clay HTTP API action POSTs results back to /webhooks/clay-enrichment,
  //      which UPDATEs clay_enrichment_results status → 'complete'
  //   4. Poll BigQuery until all rows complete (or timeout after 3 min)

  const now = new Date().toISOString();
  const claySourceUrl = process.env.CLAY_SOURCE_WEBHOOK_URL;

  if (!claySourceUrl) {
    process.stderr.write(
      '  CLAY_SOURCE_WEBHOOK_URL not configured — skipping Clay enrichment, emails will be empty.\n' +
      '  Set CLAY_SOURCE_WEBHOOK_URL to the HTTP source webhook URL from your Clay table.\n',
    );
  }

  // Build row map: row_id → discovered contact
  const rowMap = new Map(discovered.map(d => [randomUUID(), d]));

  const enrichedContacts: StructuredContact[] = [];

  if (claySourceUrl && rowMap.size > 0) {
    const bq = getBqClient();
    const dataset = process.env.BIGQUERY_DATASET ?? 'togari_data_lake';
    const project = process.env.GCP_PROJECT_ID ?? 'midyear-glazing-485303-u3';

    // 5a: INSERT contacts into togari_structured_contacts without email yet.
    // pull_id + row_id let us find these rows again when Clay calls back.
    try {
      await bq.dataset(dataset).table('togari_structured_contacts').insert(
        [...rowMap.entries()].map(([rowId, d]) => {
          const nameParts = d.name.split(' ');
          return {
            pull_id:        pullId,
            row_id:         rowId,
            linkedinUrl:    d.url.includes('linkedin.com') ? d.url : null,
            fullName:       d.name,
            firstName:      nameParts[0] || null,
            lastName:       nameParts.slice(1).join(' ') || null,
            workEmail:      null,
            phone:          null,
            currentTitle:   d.title || null,
            currentCompany: d.company,
            companyDomain:  d.company_domain || null,
            createdAt:      { value: now },
          };
        })
      );
      process.stderr.write(`  Inserted ${rowMap.size} contacts into togari_structured_contacts (emails pending)\n`);
    } catch (err) {
      process.stderr.write(`  togari_structured_contacts insert error: ${err instanceof Error ? err.message : err}\n`);
    }

    // 5b: POST each contact to Clay source webhook
    let pushCount = 0;
    for (const [rowId, d] of rowMap.entries()) {
      try {
        const res = await fetch(claySourceUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            row_id:         rowId,
            name:           d.name,
            company:        d.company,
            company_domain: d.company_domain,
            linkedin_url:   d.url,
          }),
        });
        if (res.ok) {
          pushCount++;
        } else {
          const body = await res.text().catch(() => '<no body>');
          process.stderr.write(`  Clay push HTTP ${res.status} for "${d.name}": ${body.slice(0, 200)}\n`);
        }
        cost += CLAY_COST_PER_CALL;
      } catch (err) {
        process.stderr.write(`  Clay push error for "${d.name}": ${err instanceof Error ? err.message : err}\n`);
      }
    }
    process.stderr.write(`  Pushed ${pushCount}/${rowMap.size} contacts to Clay\n`);

    // 5c: Poll BigQuery for completed rows (Clay calls back to /webhooks/clay-enrichment)
    const POLL_INTERVAL_MS = 5_000;
    const POLL_TIMEOUT_MS  = 3 * 60_000; // 3 minutes
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    const rowIds = [...rowMap.keys()];

    process.stderr.write(`  Polling for Clay enrichment results (timeout: ${POLL_TIMEOUT_MS / 1000}s)...\n`);

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

      try {
        const queryResult = await bq.query({
          query: `
            SELECT row_id, workEmail, currentCompany
            FROM \`${project}.${dataset}.togari_structured_contacts\`
            WHERE row_id IN UNNEST(@row_ids) AND pull_id = @pull_id
          `,
          params: { row_ids: rowIds, pull_id: pullId },
        });
        const rows = (queryResult[0] as Array<{ row_id: string; workEmail: string | null; currentCompany: string | null }>);

        const completeCount = rows.filter(r => r.workEmail !== null).length;
        process.stderr.write(`  Clay enrichment: ${completeCount}/${rowMap.size} rows have email\n`);

        if (completeCount >= rowMap.size) {
          for (const row of rows) {
            const d = rowMap.get(row.row_id as unknown as ReturnType<typeof randomUUID>);
            if (!d) continue;
            enrichedContacts.push({
              name:           d.name,
              title:          d.title,
              email:          row.workEmail || null,
              phone:          null,
              linkedin_url:   d.url.includes('linkedin.com') ? d.url : null,
              company:        row.currentCompany || d.company,
              company_domain: d.company_domain,
              industry:       null,
              company_size:   null,
              location:       null,
              source:         'clay' as ContactSource,
              enriched_at:    now,
            });
          }
          break;
        }
      } catch (err) {
        process.stderr.write(`  Clay poll error: ${err instanceof Error ? err.message : err}\n`);
      }
    }

    // Timeout fallback: use whatever we have plus raw Exa for missing rows
    if (enrichedContacts.length < rowMap.size) {
      const enrichedRowIds = new Set(enrichedContacts.map(c => c.name));
      for (const [, d] of rowMap.entries()) {
        if (!enrichedRowIds.has(d.name)) {
          enrichedContacts.push({
            name:           d.name,
            title:          d.title,
            email:          null,
            phone:          null,
            linkedin_url:   d.url.includes('linkedin.com') ? d.url : null,
            company:        d.company,
            company_domain: d.company_domain,
            industry:       null,
            company_size:   null,
            location:       null,
            source:         'exa' as ContactSource,
            enriched_at:    now,
          });
        }
      }
      process.stderr.write(`  Clay poll timed out — ${enrichedContacts.length} contacts returned (some emails may be empty)\n`);
    }
  } else {
    // No Clay source URL — fall back to raw Exa data with no emails
    for (const d of discovered) {
      enrichedContacts.push({
        name:           d.name,
        title:          d.title,
        email:          null,
        phone:          null,
        linkedin_url:   d.url.includes('linkedin.com') ? d.url : null,
        company:        d.company,
        company_domain: d.company_domain,
        industry:       null,
        company_size:   null,
        location:       null,
        source:         'exa' as ContactSource,
        enriched_at:    now,
      });
    }
  }

  return { contacts: enrichedContacts, cost };
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP 7: CSV GENERATION
// ═══════════════════════════════════════════════════════════════════════════

function generateCsv(contacts: StructuredContact[]): string {
  const header = CSV_COLUMNS.join(',');
  const rows = contacts.map(c => {
    const values = [
      c.name,
      c.email || '',
      c.title || '',
      c.company,
      c.linkedin_url || '',
    ];
    return values.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });
  return [header, ...rows].join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP 8: GCS UPLOAD
// ═══════════════════════════════════════════════════════════════════════════

async function uploadCsvToGcs(
  clientId: string,
  pullId: string,
  csvContent: string,
): Promise<string> {
  const bucket = process.env.GCS_DATA_PULL_BUCKET || 'togari-data-pulls';
  const objectPath = `tenants/${clientId}/data-pulls/${pullId}.csv`;

  try {
    const accessToken = await getGcsAccessToken();

    const uploadRes = await fetch(
      `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(objectPath)}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'text/csv',
        },
        body: csvContent,
      },
    );

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      throw new Error(`GCS upload failed (${uploadRes.status}): ${errText}`);
    }

    process.stderr.write(`  Uploaded CSV to gs://${bucket}/${objectPath}\n`);

    // Generate signed URL (valid for 7 days)
    const signedUrl = await generateSignedUrl(bucket, objectPath, accessToken);
    return signedUrl;
  } catch (err) {
    process.stderr.write(`GCS upload error: ${err instanceof Error ? err.message : err}\n`);
    // Fallback: return the GCS path as a reference
    return `gs://${bucket}/${objectPath}`;
  }
}

async function generateSignedUrl(
  bucket: string,
  objectPath: string,
  _accessToken: string,
): Promise<string> {
  // GCS V4 signed URL — no Bearer token required by the downloader.
  // Valid for 7 days (604,800 s — the V4 maximum).
  const gcpCredentialsBase64 = process.env.GCP_CREDENTIALS_BASE64;
  if (!gcpCredentialsBase64) {
    return `gs://${bucket}/${objectPath}`;
  }

  const creds = JSON.parse(
    Buffer.from(gcpCredentialsBase64, 'base64').toString('utf-8'),
  ) as { client_email: string; private_key: string };

  const crypto = await import('crypto');

  const expiresSecs  = 7 * 24 * 60 * 60; // 604800
  const now          = new Date();
  const datestamp    = now.toISOString().slice(0, 10).replace(/-/g, '');  // YYYYMMDD
  const timestamp    = now.toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z'; // YYYYMMDDTHHmmssZ
  const credScope    = `${datestamp}/auto/storage/goog4_request`;
  const serviceAcct  = creds.client_email;
  const encodedPath  = '/' + bucket + '/' + objectPath.split('/').map(encodeURIComponent).join('/');

  const canonicalHeaders  = 'host:storage.googleapis.com\n';
  const signedHeaders     = 'host';

  const queryParams = [
    `X-Goog-Algorithm=GOOG4-RSA-SHA256`,
    `X-Goog-Credential=${encodeURIComponent(`${serviceAcct}/${credScope}`)}`,
    `X-Goog-Date=${timestamp}`,
    `X-Goog-Expires=${expiresSecs}`,
    `X-Goog-SignedHeaders=${signedHeaders}`,
  ].join('&');

  const canonicalRequest = [
    'GET',
    encodedPath,
    queryParams,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const hashedCanonical = crypto
    .createHash('sha256')
    .update(canonicalRequest)
    .digest('hex');

  const stringToSign = [
    'GOOG4-RSA-SHA256',
    timestamp,
    credScope,
    hashedCanonical,
  ].join('\n');

  const sign      = crypto.createSign('RSA-SHA256');
  sign.update(stringToSign);
  const signature = sign.sign(creds.private_key, 'hex');

  return (
    `https://storage.googleapis.com${encodedPath}` +
    `?${queryParams}&X-Goog-Signature=${signature}`
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP 10: EMAIL NOTIFICATION
// ═══════════════════════════════════════════════════════════════════════════

async function sendDataPullReadyEmail(
  clientEmail: string,
  pullId: string,
  contactCount: number,
  csvUrl: string,
): Promise<void> {
  const gmailToken = process.env.GMAIL_ACCESS_TOKEN || process.env.GMAIL_REFRESH_TOKEN;
  if (!gmailToken) {
    process.stderr.write(`  [email-skip] Would notify ${clientEmail}: ${contactCount} contacts ready at ${csvUrl}\n`);
    return;
  }

  const subject = `Your data pull is ready — ${contactCount} contacts`;
  const htmlBody = `
    <!DOCTYPE html>
    <html>
    <body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:0 auto;padding:20px;color:#333;">
      <h1 style="font-size:22px;color:#1a1a1a;">Your Data Pull is Ready</h1>
      <p>We've compiled <strong>${contactCount} contacts</strong> matching your request.</p>
      <p style="margin:24px 0;">
        <a href="${csvUrl}" style="background:#1a73e8;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:500;">
          Download CSV
        </a>
      </p>
      <p style="color:#666;font-size:13px;">Pull ID: ${pullId}<br>This link expires in 7 days.</p>
      <hr style="border:none;border-top:1px solid #e0e0e0;margin:24px 0;">
      <p style="font-size:12px;color:#999;">Powered by Togari</p>
    </body>
    </html>`;

  const textBody = `Your data pull is ready — ${contactCount} contacts.\n\nDownload: ${csvUrl}\n\nPull ID: ${pullId}\nLink expires in 7 days.`;

  const mimeMessage = [
    `To: ${clientEmail}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="togari-dp-boundary"',
    '',
    '--togari-dp-boundary',
    'Content-Type: text/plain; charset=utf-8',
    '',
    textBody,
    '--togari-dp-boundary',
    'Content-Type: text/html; charset=utf-8',
    '',
    htmlBody,
    '--togari-dp-boundary--',
  ].join('\r\n');

  const encoded = Buffer.from(mimeMessage).toString('base64url');

  try {
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${gmailToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: encoded }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      process.stderr.write(`  Email send failed (${res.status}): ${errBody}\n`);
    } else {
      process.stderr.write(`  Sent data pull notification to ${clientEmail}\n`);
    }
  } catch (err) {
    process.stderr.write(`  Email error: ${err instanceof Error ? err.message : err}\n`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DATA PULL REQUEST CRUD (BigQuery)
// ═══════════════════════════════════════════════════════════════════════════

export async function createDataPullRecord(
  clientId: string,
  nlQuery: string,
  requestedCount: number,
  stripeCheckoutId: string | null,
): Promise<DataPullRequest> {
  const bq = getBqClient();
  const dataset = process.env.BIGQUERY_DATASET ?? 'togari_data_lake';
  const now = new Date().toISOString();

  const request: DataPullRequest = {
    pull_id: randomUUID(),
    client_id: clientId,
    natural_language_query: nlQuery,
    requested_count: requestedCount,
    datalake_matches: 0,
    enrichment_needed: 0,
    status: 'pending',
    csv_url: null,
    cost_usd: estimateDataPullCost(requestedCount),
    stripe_checkout_id: stripeCheckoutId,
    created_at: now,
    updated_at: now,
  };

  await bq.dataset(dataset).table('data_pull_requests').insert([request]);
  return request;
}

export async function getDataPullRequest(pullId: string): Promise<DataPullRequest | null> {
  const bq = getBqClient();
  const [rows] = await bq.query({
    query: `SELECT * FROM ${fqt('data_pull_requests')} WHERE pull_id = @id LIMIT 1`,
    params: { id: pullId },
    useLegacySql: false,
  });

  if (!rows || (rows as unknown[]).length === 0) return null;
  const row = (rows as Record<string, unknown>[])[0];
  return rowToDataPullRequest(row);
}

export async function listDataPullRequests(clientId: string): Promise<DataPullRequest[]> {
  const bq = getBqClient();
  const [rows] = await bq.query({
    query: `
      SELECT * FROM ${fqt('data_pull_requests')}
      WHERE client_id = @client_id
      ORDER BY created_at DESC
      LIMIT 50
    `,
    params: { client_id: clientId },
    useLegacySql: false,
  });

  return (rows as Record<string, unknown>[]).map(rowToDataPullRequest);
}

async function updateDataPullRequest(
  pullId: string,
  updates: Partial<Pick<DataPullRequest, 'status' | 'csv_url' | 'cost_usd' | 'datalake_matches' | 'enrichment_needed'>>,
): Promise<void> {
  const bq = getBqClient();
  const setClauses: string[] = ['updated_at = CURRENT_TIMESTAMP()'];
  const params: Record<string, unknown> = { id: pullId };

  if (updates.status !== undefined) {
    setClauses.push('status = @status');
    params.status = updates.status;
  }
  if (updates.csv_url !== undefined) {
    setClauses.push('csv_url = @csv_url');
    params.csv_url = updates.csv_url;
  }
  if (updates.cost_usd !== undefined) {
    setClauses.push('cost_usd = @cost_usd');
    params.cost_usd = updates.cost_usd;
  }
  if (updates.datalake_matches !== undefined) {
    setClauses.push('datalake_matches = @datalake_matches');
    params.datalake_matches = updates.datalake_matches;
  }
  if (updates.enrichment_needed !== undefined) {
    setClauses.push('enrichment_needed = @enrichment_needed');
    params.enrichment_needed = updates.enrichment_needed;
  }

  await bq.query({
    query: `UPDATE ${fqt('data_pull_requests')} SET ${setClauses.join(', ')} WHERE pull_id = @id`,
    params,
    useLegacySql: false,
  });
}

function rowToDataPullRequest(row: Record<string, unknown>): DataPullRequest {
  return {
    pull_id: String(row.pull_id),
    client_id: String(row.client_id),
    natural_language_query: String(row.natural_language_query),
    requested_count: Number(row.requested_count || 0),
    datalake_matches: Number(row.datalake_matches || 0),
    enrichment_needed: Number(row.enrichment_needed || 0),
    status: String(row.status || 'pending') as DataPullRequest['status'],
    csv_url: row.csv_url ? String(row.csv_url) : null,
    cost_usd: Number(row.cost_usd || 0),
    stripe_checkout_id: row.stripe_checkout_id ? String(row.stripe_checkout_id) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PIPELINE ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════════

export async function processDataPull(request: DataPullRequest): Promise<DataPullResult> {
  process.stderr.write(`\n[DataPull] Processing ${request.pull_id} for client ${request.client_id}\n`);
  process.stderr.write(`  Query: "${request.natural_language_query}"\n`);
  process.stderr.write(`  Requested: ${request.requested_count} contacts\n`);

  // Mark as processing
  await updateDataPullRequest(request.pull_id, { status: 'processing' });

  let apiCost = 0; // Track external API costs (Exa + Clay)

  // Step 1: Translate NL query → SQL
  process.stderr.write('  Step 1: Generating SQL from natural language query...\n');
  const sql = await translateQueryToSql(request.natural_language_query);
  process.stderr.write(`  SQL: ${sql}\n`);

  // Step 2: Query datalake
  process.stderr.write('  Step 2: Querying datalake...\n');
  const datalakeContacts = await queryDatalake(sql, request.requested_count);
  const datalakeCount = datalakeContacts.length;
  process.stderr.write(`  Found ${datalakeCount} contacts in datalake\n`);

  await updateDataPullRequest(request.pull_id, { datalake_matches: datalakeCount });

  // Step 3: Check if we have enough
  let enrichedContacts: StructuredContact[] = [];
  let enrichmentNeeded = 0;

  if (datalakeCount < request.requested_count) {
    // Step 4-5: Discover + enrich shortfall
    enrichmentNeeded = request.requested_count - datalakeCount;
    process.stderr.write(`  Steps 4-5: Need ${enrichmentNeeded} more contacts, running discovery...\n`);

    await updateDataPullRequest(request.pull_id, { enrichment_needed: enrichmentNeeded });

    const { contacts, cost } = await discoverAndEnrich(
      request.pull_id,
      request.natural_language_query,
      enrichmentNeeded,
    );
    enrichedContacts = contacts;
    apiCost += cost;
    process.stderr.write(`  Enriched ${enrichedContacts.length} new contacts\n`);
  } else {
    process.stderr.write('  Datalake has enough contacts — skipping enrichment\n');
  }

  // Step 6: Compile final list
  const allContacts = [...datalakeContacts, ...enrichedContacts].slice(0, request.requested_count);
  process.stderr.write(`  Step 6: Final list: ${allContacts.length} contacts\n`);

  // Step 7: Generate CSV
  process.stderr.write('  Step 7: Generating CSV...\n');
  const csvContent = generateCsv(allContacts);

  // Step 8: Upload to GCS
  process.stderr.write('  Step 8: Uploading to GCS...\n');
  const csvUrl = await uploadCsvToGcs(request.client_id, request.pull_id, csvContent);

  // Step 9: Update request status — use tiered pricing for customer cost
  const totalCost = calculateDataPullCost(allContacts.length);
  await updateDataPullRequest(request.pull_id, {
    status: 'ready',
    csv_url: csvUrl,
    cost_usd: totalCost,
  });

  // Step 10: Send notification email
  process.stderr.write('  Step 10: Sending notification...\n');
  // Try to get client email from client_id (look up subscription or use the ID as email)
  const clientEmail = request.client_id.includes('@')
    ? request.client_id
    : `${request.client_id}@togari.com`; // Fallback; in practice client_id maps to an account
  await sendDataPullReadyEmail(clientEmail, request.pull_id, allContacts.length, csvUrl);

  const result: DataPullResult = {
    contacts: allContacts,
    total_from_datalake: datalakeCount,
    total_enriched_new: enrichedContacts.length,
    csv_download_url: csvUrl,
  };

  process.stderr.write(
    `  [DataPull] Complete: ${allContacts.length} contacts ` +
    `(${datalakeCount} datalake + ${enrichedContacts.length} enriched), ` +
    `cost: $${totalCost}\n`
  );

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// STRIPE: ONE-TIME CHECKOUT SESSION
// ═══════════════════════════════════════════════════════════════════════════

export async function createDataPullCheckout(
  pullId: string,
  clientEmail: string,
  contactCount: number,
): Promise<string | null> {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    process.stderr.write('STRIPE_SECRET_KEY not configured — skipping checkout\n');
    return null;
  }

  const costCents = Math.round(calculateDataPullCost(contactCount) * 100);

  try {
    const checkoutRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeSecretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'mode': 'payment',
        'customer_email': clientEmail,
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][product_data][name]': `Data Pull — ${contactCount} contacts`,
        'line_items[0][price_data][product_data][description]': `One-time contact list export (${contactCount} contacts)`,
        'line_items[0][price_data][unit_amount]': String(costCents),
        'line_items[0][quantity]': '1',
        'allow_promotion_codes': 'true',
        'metadata[pull_id]': pullId,
        'metadata[product_type]': 'data_pull',
        'success_url': process.env.STRIPE_SUCCESS_URL || 'https://bluemodernadvisory.com/checkout/success',
        'cancel_url': process.env.STRIPE_CANCEL_URL || 'https://bluemodernadvisory.com/checkout/canceled',
      }),
    });

    if (!checkoutRes.ok) {
      const errText = await checkoutRes.text();
      process.stderr.write(`Stripe checkout failed (${checkoutRes.status}): ${errText}\n`);
      return null;
    }

    const session = await checkoutRes.json() as { id?: string; url?: string };
    return session.url ?? null;
  } catch (err) {
    process.stderr.write(`Stripe checkout error: ${err instanceof Error ? err.message : err}\n`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parses a LinkedIn profile page title into name / title / company.
 *
 * LinkedIn profile titles follow predictable patterns:
 *   "First Last - Title at Company | LinkedIn"
 *   "First Last - Title | LinkedIn"
 *   "First Last | LinkedIn"
 *   "First Last - Title - Company | LinkedIn"   (older format, no "at")
 *
 * Returns null for non-person results (posts, follower counts, ads, etc).
 */
function parseLinkedInTitle(
  rawTitle: string,
): { name: string; title: string | null; company: string | null } | null {
  // Strip trailing " | LinkedIn" / " - LinkedIn"
  const cleaned = rawTitle.replace(/\s*[|-]\s*LinkedIn\s*$/i, '').trim();
  if (!cleaned) return null;

  // First " - " separates the person from their title/company
  const dashIdx = cleaned.indexOf(' - ');
  const name = (dashIdx === -1 ? cleaned : cleaned.slice(0, dashIdx)).trim();

  if (!isLikelyPersonName(name)) return null;

  let title: string | null = null;
  let company: string | null = null;

  if (dashIdx !== -1) {
    const remainder = cleaned.slice(dashIdx + 3).trim();

    // Prefer "Title at Company" or "Title @ Company" split
    const atMatch = remainder.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
    if (atMatch) {
      title = atMatch[1].trim();
      company = atMatch[2].trim();
    } else {
      // Fall back to dash split: "Title - Company"
      const parts = remainder.split(/\s+-\s+/);
      title = parts[0]?.trim() || null;
      company = parts[1]?.trim() || null;
    }
  }

  return { name, title, company };
}

function isLikelyPersonName(name: string): boolean {
  const words = name.split(/\s+/);
  if (words.length < 2 || words.length > 5) return false;
  if (name.length > 60) return false;
  if (/\d/.test(name)) return false;
  if (name.includes('@')) return false;
  if (/\b(jobs?|hiring|post|profile|page|group|company|inc\.?|llc\.?|ltd\.?|followers?)\b/i.test(name)) return false;
  return true;
}

/**
 * Best-effort company domain from a company name.
 * Strips legal suffixes, lowercases, removes spaces/punctuation → "<slug>.com".
 * Used when the source URL is a LinkedIn profile (so the URL domain is
 * linkedin.com, not the company's own domain).
 *
 * Examples:
 *   "EcoVadis"              → "ecovadis.com"
 *   "Acme Corp"             → "acmecorp.com"
 *   "Blue Modern Advisory"  → "bluemodernadvisory.com"
 *   "Unknown"               → null
 */
function guessCompanyDomain(company: string): string | null {
  if (!company || company.toLowerCase() === 'unknown') return null;
  const slug = company
    .toLowerCase()
    .replace(/\b(inc\.?|llc\.?|ltd\.?|corp\.?|co\.?|group|holdings?|technologies?|solutions?|services?|systems?)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
  return slug ? `${slug}.com` : null;
}

function extractDomainFromUrl(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.replace('www.', '');
    // Skip social/job board domains
    const skipDomains = ['linkedin.com', 'twitter.com', 'facebook.com', 'indeed.com', 'greenhouse.io', 'lever.co'];
    if (skipDomains.some(d => hostname.includes(d))) return null;
    return hostname;
  } catch {
    return null;
  }
}
