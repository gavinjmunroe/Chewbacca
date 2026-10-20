/**
 * @togari/admin — Deal lookup for email routing
 *
 * Cross-references email senders against BigQuery deals table
 * to route Slack notifications to the deal owner.
 */

import { BigQueryClient } from '../bigquery/client';
import { createLogger } from '../observability/logger';
import { resolveDataset } from '../services/dataset-resolver';

const logger = createLogger('DealLookup');

export interface DealInfo {
  dealName: string;
  owner: string;
  contactEmail: string;
  contactName: string;
  stage: string;
}

const PROJECT_ID = 'midyear-glazing-485303-u3';

function dealsTableFqn(): string {
  return `${PROJECT_ID}.${resolveDataset()}.togari_structured_deals`;
}

let bqClient: BigQueryClient | null = null;

function getClient(): BigQueryClient {
  if (!bqClient) {
    const creds = process.env.GCP_CREDENTIALS_BASE64;
    if (!creds) throw new Error('GCP_CREDENTIALS_BASE64 not set');
    bqClient = new BigQueryClient(PROJECT_ID, null, creds);
  }
  return bqClient;
}

export async function lookupDealOwner(senderEmail: string): Promise<DealInfo | null> {
  try {
    const client = getClient();
    const sql = `SELECT deal_name, owner, contact_email, contact_full_name, stage
      FROM \`${dealsTableFqn()}\`
      WHERE LOWER(contact_email) = LOWER(@email)
      LIMIT 1`;

    const result = await client.executeQuery(sql, { email: senderEmail });

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      dealName: (row.deal_name as string) ?? '',
      owner: (row.owner as string) ?? '',
      contactEmail: (row.contact_email as string) ?? '',
      contactName: (row.contact_full_name as string) ?? '',
      stage: (row.stage as string) ?? '',
    };
  } catch (err) {
    logger.error('Deal lookup by email failed', err, { senderEmail });
    return null;
  }
}

export async function lookupDealOwnerByName(senderName: string): Promise<DealInfo | null> {
  try {
    if (!senderName || senderName.trim().length === 0) return null;

    const client = getClient();
    const sql = `SELECT deal_name, owner, contact_email, contact_full_name, stage
      FROM \`${dealsTableFqn()}\`
      WHERE LOWER(contact_full_name) = LOWER(@name)
      LIMIT 1`;

    const result = await client.executeQuery(sql, { name: senderName.trim() });

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      dealName: (row.deal_name as string) ?? '',
      owner: (row.owner as string) ?? '',
      contactEmail: (row.contact_email as string) ?? '',
      contactName: (row.contact_full_name as string) ?? '',
      stage: (row.stage as string) ?? '',
    };
  } catch (err) {
    logger.error('Deal lookup by name failed', err, { senderName });
    return null;
  }
}
