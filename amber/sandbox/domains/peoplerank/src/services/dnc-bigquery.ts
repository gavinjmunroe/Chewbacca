import { BigQuery } from '@google-cloud/bigquery';
import { createHash } from 'crypto';

const PROJECT_ID = 'midyear-glazing-485303-u3';
const DATASET_ID = 'togari_dnc';
const TABLE_ID = 'contacts';

const bqOptions: any = { projectId: PROJECT_ID };
const gcpCreds = process.env.GCP_CREDENTIALS_BASE64;
if (gcpCreds) {
  bqOptions.credentials = JSON.parse(
    Buffer.from(gcpCreds, 'base64').toString('utf-8')
  );
}

const bigquery = new BigQuery(bqOptions);

const TABLE_SCHEMA = [
  { name: 'id', type: 'STRING', mode: 'REQUIRED' as const },
  { name: 'owner_email', type: 'STRING', mode: 'REQUIRED' as const },
  { name: 'org_id', type: 'STRING', mode: 'REQUIRED' as const },
  { name: 'name', type: 'STRING', mode: 'NULLABLE' as const },
  { name: 'email', type: 'STRING', mode: 'NULLABLE' as const },
  { name: 'phone', type: 'STRING', mode: 'NULLABLE' as const },
  { name: 'linkedin_url', type: 'STRING', mode: 'NULLABLE' as const },
  { name: 'company', type: 'STRING', mode: 'NULLABLE' as const },
  { name: 'title', type: 'STRING', mode: 'NULLABLE' as const },
  { name: 'source_platform', type: 'STRING' },
  { name: 'imported_at', type: 'TIMESTAMP' },
];

export async function initDNCSchema(): Promise<void> {
  try {
    const dataset = bigquery.dataset(DATASET_ID);
    const [datasetExists] = await dataset.exists();
    if (!datasetExists) {
      await bigquery.createDataset(DATASET_ID);
      process.stderr.write(`Created BigQuery dataset: ${DATASET_ID}\n`);
    }

    const table = dataset.table(TABLE_ID);
    const [tableExists] = await table.exists();
    if (!tableExists) {
      await dataset.createTable(TABLE_ID, { schema: TABLE_SCHEMA });
      process.stderr.write(`Created BigQuery table: ${DATASET_ID}.${TABLE_ID}\n`);
    }
  } catch (error) {
    process.stderr.write(
      `Warning: DNC schema init failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
  }
}

interface ContactInput {
  name?: string;
  email?: string;
  phone?: string;
  linkedinUrl?: string;
  company?: string;
  title?: string;
}

export async function importContacts(
  ownerEmail: string,
  orgId: string,
  sourcePlatform: string,
  contacts: ContactInput[]
): Promise<{ imported: number; skipped: number }> {
  // Keep contacts that have either an email or a LinkedIn URL
  const valid = contacts.filter(
    (c) => (c.email && c.email.trim()) || (c.linkedinUrl && c.linkedinUrl.trim())
  );
  const skipped = contacts.length - valid.length;

  if (valid.length === 0) {
    return { imported: 0, skipped };
  }

  const now = new Date().toISOString();
  const rows = valid.map((c) => {
    const email = c.email ? c.email.toLowerCase().trim() : null;
    const linkedinUrl = c.linkedinUrl ? c.linkedinUrl.trim() : null;
    const hashInput = email || linkedinUrl!;
    return {
      id: createHash('sha256').update(hashInput).digest('hex').slice(0, 16),
      owner_email: ownerEmail,
      org_id: orgId,
      name: c.name || null,
      email,
      phone: c.phone || null,
      linkedin_url: linkedinUrl,
      company: c.company || null,
      title: c.title || null,
      source_platform: sourcePlatform,
      imported_at: now,
    };
  });

  // Batch insert in chunks of 500
  const table = bigquery.dataset(DATASET_ID).table(TABLE_ID);
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await table.insert(chunk);
  }

  return { imported: rows.length, skipped };
}

export async function checkDNC(
  email: string | undefined,
  userEmail: string,
  orgId: string,
  scope: 'individual' | 'organization',
  linkedinUrl?: string
): Promise<{ isDNC: boolean; owner?: string; name?: string }> {
  const useLinkedin = !email && linkedinUrl;
  const lookupField = useLinkedin ? 'linkedin_url' : 'email';
  const lookupValue = useLinkedin
    ? linkedinUrl!.trim()
    : email!.toLowerCase().trim();

  let query: string;
  let params: Record<string, string>;

  if (scope === 'individual') {
    query = `SELECT name, owner_email, source_platform FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_ID}\` WHERE ${lookupField} = @lookupValue AND owner_email = @userEmail LIMIT 1`;
    params = { lookupValue, userEmail };
  } else {
    query = `SELECT name, owner_email, source_platform FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_ID}\` WHERE ${lookupField} = @lookupValue AND org_id = @orgId LIMIT 1`;
    params = { lookupValue, orgId };
  }

  const [rows] = await bigquery.query({ query, params });

  if (rows.length > 0) {
    return {
      isDNC: true,
      owner: rows[0].owner_email,
      name: rows[0].name || undefined,
    };
  }
  return { isDNC: false };
}

export async function getDNCStatus(
  ownerEmail: string
): Promise<{ count: number; lastImport: string | null; platforms: string[] }> {
  const countQuery = `SELECT COUNT(*) as cnt FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_ID}\` WHERE owner_email = @ownerEmail`;
  const [countRows] = await bigquery.query({
    query: countQuery,
    params: { ownerEmail },
  });

  const lastImportQuery = `SELECT MAX(imported_at) as last_import FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_ID}\` WHERE owner_email = @ownerEmail`;
  const [lastRows] = await bigquery.query({
    query: lastImportQuery,
    params: { ownerEmail },
  });

  const platformsQuery = `SELECT DISTINCT source_platform FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_ID}\` WHERE owner_email = @ownerEmail`;
  const [platformRows] = await bigquery.query({
    query: platformsQuery,
    params: { ownerEmail },
  });

  return {
    count: Number(countRows[0]?.cnt ?? 0),
    lastImport: lastRows[0]?.last_import
      ? new Date(lastRows[0].last_import.value ?? lastRows[0].last_import).toISOString()
      : null,
    platforms: platformRows.map((r: any) => r.source_platform),
  };
}
