/**
 * Server configuration for togari-clay.
 * Loads secrets from @togari/admin (Secret Manager + env var fallback).
 */

import { getSecret, getOptionalSecret } from '@togari/admin';

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
  stripeWebhookSecret?: string;
  framerWebhookSecret?: string;
  cronSecret?: string;
}

/**
 * Load config — uses @togari/admin getSecret (Secret Manager → env var fallback).
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
  const smKey = await getOptionalSecret('anthropic-api-key');
  if (smKey) {
    anthropicApiKey = smKey;
    process.stderr.write('Config: ANTHROPIC_API_KEY loaded from Secret Manager\n');
  }
  if (!anthropicApiKey) missing.push('ANTHROPIC_API_KEY');

  // Try Secret Manager for GCP credentials base64
  let gcpCredentialsBase64 = process.env.GCP_CREDENTIALS_BASE64;
  if (!gcpCredentialsBase64) {
    const smCreds = await getOptionalSecret('gcp-credentials-base64');
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
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    framerWebhookSecret: process.env.FRAMER_WEBHOOK_SECRET,
    cronSecret: process.env.CRON_SECRET,
    internalApiKeys: process.env.TOGARI_INTERNAL_KEYS
      ? process.env.TOGARI_INTERNAL_KEYS.split(',').map((k) => k.trim()).filter(Boolean)
      : undefined,
    externalApiKeys: process.env.TOGARI_EXTERNAL_KEYS
      ? process.env.TOGARI_EXTERNAL_KEYS.split(',').map((k) => k.trim()).filter(Boolean)
      : undefined,
  };
}
