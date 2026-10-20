import { BigQuery } from '@google-cloud/bigquery';
import { createHash } from 'crypto';

const PROJECT_ID = 'midyear-glazing-485303-u3';
const DATASET_ID = 'togari_dnc';
const TABLE_ID = 'contacts';

function createBigQueryClient(): BigQuery {
  const options: ConstructorParameters<typeof BigQuery>[0] = { projectId: PROJECT_ID };
  const b64 = process.env.GCP_CREDENTIALS_BASE64;
  if (b64) {
    options.credentials = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
  }
  return new BigQuery(options);
}

const bigquery = createBigQueryClient();

export async function initDNCSchema(): Promise<void> {
  const dataset = bigquery.dataset(DATASET_ID);

  const [datasetExists] = await dataset.exists();
  if (!datasetExists) {
    await dataset.create({ location: 'US' });
  }

  const table = dataset.table(TABLE_ID);
  const [tableExists] = await table.exists();
  if (!tableExists) {
    await table.create({
      schema: {
        fields: [
          { name: 'id', type: 'STRING', mode: 'REQUIRED' },
          { name: 'owner_email', type: 'STRING', mode: 'REQUIRED' },
          { name: 'org_id', type: 'STRING', mode: 'REQUIRED' },
          { name: 'name', type: 'STRING', mode: 'NULLABLE' },
          { name: 'email', type: 'STRING', mode: 'REQUIRED' },
          { name: 'phone', type: 'STRING', mode: 'NULLABLE' },
          { name: 'linkedin_url', type: 'STRING', mode: 'NULLABLE' },
          { name: 'company', type: 'STRING', mode: 'NULLABLE' },
          { name: 'title', type: 'STRING', mode: 'NULLABLE' },
          { name: 'source_platform', type: 'STRING', mode: 'NULLABLE' },
          { name: 'imported_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
        ],
      },
    });
  }
}

function hashEmail(email: string): string {
  return createHash('sha256').update(email.toLowerCase()).digest('hex').substring(0, 16);
}

export interface ContactInput {
  name?: string;
  email?: string;
  phone?: string;
  linkedinUrl?: string;
  company?: string;
  title?: string;
  sourcePlatform?: string;
}

export async function importContacts(
  ownerEmail: string,
  orgId: string,
  contacts: ContactInput[]
): Promise<number> {
  const sourcePlatform = contacts[0]?.sourcePlatform ?? 'gmail';

  // Delete existing rows for this owner+platform (idempotent re-import)
  const deleteQuery = `
    DELETE FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_ID}\`
    WHERE owner_email = @ownerEmail
      AND source_platform = @sourcePlatform
  `;
  await bigquery.query({
    query: deleteQuery,
    params: { ownerEmail, sourcePlatform },
  });

  // Filter out contacts with no email
  const valid = contacts.filter((c) => c.email && c.email.trim() !== '');
  if (valid.length === 0) return 0;

  const now = new Date().toISOString();
  const rows = valid.map((c) => ({
    id: hashEmail(c.email!),
    owner_email: ownerEmail,
    org_id: orgId,
    name: c.name ?? null,
    email: c.email!.toLowerCase().trim(),
    phone: c.phone ?? null,
    linkedin_url: c.linkedinUrl ?? null,
    company: c.company ?? null,
    title: c.title ?? null,
    source_platform: c.sourcePlatform ?? 'gmail',
    imported_at: now,
  }));

  const table = bigquery.dataset(DATASET_ID).table(TABLE_ID);
  const CHUNK_SIZE = 500;

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    await table.insert(chunk);
  }

  return valid.length;
}

export async function checkDNC(
  email: string,
  userEmail: string,
  orgId: string,
  scope: 'individual' | 'organization'
): Promise<{ isDNC: boolean; owner?: string; name?: string }> {
  let query: string;
  let params: Record<string, string>;

  if (scope === 'individual') {
    query = `
      SELECT owner_email, name
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_ID}\`
      WHERE email = @email
        AND owner_email = @userEmail
      LIMIT 1
    `;
    params = { email: email.toLowerCase().trim(), userEmail };
  } else {
    query = `
      SELECT owner_email, name
      FROM \`${PROJECT_ID}.${DATASET_ID}.${TABLE_ID}\`
      WHERE email = @email
        AND org_id = @orgId
      LIMIT 1
    `;
    params = { email: email.toLowerCase().trim(), orgId };
  }

  const [rows] = await bigquery.query({ query, params });

  if (rows.length === 0) {
    return { isDNC: false };
  }

  const row = rows[0] as { owner_email: string; name: string | null };
  return {
    isDNC: true,
    owner: row.owner_email,
    name: row.name ?? undefined,
  };
}
