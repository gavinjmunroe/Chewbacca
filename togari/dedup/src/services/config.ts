/**
 * Configuration for the Togari MCP Server.
 * Loads secrets from GCP Secret Manager first, falls back to environment variables.
 */

import { getSecret } from './secret-manager';

export interface McpConfig {
  gcpProjectId: string;
  bigqueryDataset: string;
  bigqueryTable: string;
  bigqueryDealsTable: string;
  anthropicApiKey: string;
  exaApiKey?: string;
  clayApiKey?: string;
  structifyApiKey?: string;
  googleApplicationCredentials?: string;
  gcpCredentialsBase64?: string;
  internalApiKeys?: string[];
  externalApiKeys?: string[];
}

/**
 * Load config — tries GCP Secret Manager first for sensitive values,
 * falls back to env vars for local dev / stdio mode.
 */
export async function loadConfig(): Promise<McpConfig> {
  const missing: string[] = [];

  const gcpProjectId = process.env.GCP_PROJECT_ID;
  if (!gcpProjectId) missing.push('GCP_PROJECT_ID');

  const bigqueryDataset = process.env.BIGQUERY_DATASET;
  if (!bigqueryDataset) missing.push('BIGQUERY_DATASET');

  const bigqueryTable = process.env.BIGQUERY_TABLE;
  if (!bigqueryTable) missing.push('BIGQUERY_TABLE');

  // Try Secret Manager first for API key, fall back to env var
  let anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (gcpProjectId) {
    const smKey = await getSecret('anthropic-api-key', gcpProjectId);
    if (smKey) {
      anthropicApiKey = smKey;
      process.stderr.write('Config: ANTHROPIC_API_KEY loaded from Secret Manager\n');
    }
  }
  if (!anthropicApiKey) missing.push('ANTHROPIC_API_KEY');

  // Try Secret Manager for GCP credentials base64
  let gcpCredentialsBase64 = process.env.GCP_CREDENTIALS_BASE64;
  if (gcpProjectId && !gcpCredentialsBase64) {
    const smCreds = await getSecret('gcp-credentials-base64', gcpProjectId);
    if (smCreds) {
      gcpCredentialsBase64 = smCreds;
      process.stderr.write('Config: GCP_CREDENTIALS_BASE64 loaded from Secret Manager\n');
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
        'Set these in your environment or Claude Desktop config.'
    );
  }

  return {
    gcpProjectId:       gcpProjectId!,
    bigqueryDataset:    bigqueryDataset!,
    bigqueryTable:      bigqueryTable!,
    bigqueryDealsTable: process.env.BIGQUERY_DEALS_TABLE ?? '',
    anthropicApiKey:    anthropicApiKey!,
    exaApiKey:          process.env.EXA_API_KEY,
    clayApiKey:         process.env.CLAY_API_KEY,
    structifyApiKey:    process.env.STRUCTIFY_API_KEY,
    googleApplicationCredentials: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    gcpCredentialsBase64: gcpCredentialsBase64 || undefined,
    internalApiKeys: process.env.TOGARI_INTERNAL_KEYS
      ? process.env.TOGARI_INTERNAL_KEYS.split(',').map((k) => k.trim()).filter(Boolean)
      : undefined,
    externalApiKeys: process.env.TOGARI_EXTERNAL_KEYS
      ? process.env.TOGARI_EXTERNAL_KEYS.split(',').map((k) => k.trim()).filter(Boolean)
      : undefined,
  };
}
