/**
 * Configuration for the Togari MCP Server.
 * All values loaded from environment variables.
 */

export interface McpConfig {
  gcpProjectId: string;
  bigqueryDataset: string;
  bigqueryTable: string;
  anthropicApiKey: string;
  /** Optional — if not set, falls back to GOOGLE_APPLICATION_CREDENTIALS env var or ADC */
  googleApplicationCredentials?: string;
  /** Optional — base64-encoded GCP service account JSON credentials */
  gcpCredentialsBase64?: string;
  /** Optional — API keys granting internal access, parsed from TOGARI_INTERNAL_KEYS */
  internalApiKeys?: string[];
  /** Optional — API keys granting external access, parsed from TOGARI_EXTERNAL_KEYS */
  externalApiKeys?: string[];
  /** Optional — BigQuery table for deals data, loaded from BIGQUERY_DEALS_TABLE */
  bigqueryDealsTable?: string;
}

export function loadConfig(): McpConfig {
  const missing: string[] = [];

  const gcpProjectId = process.env.GCP_PROJECT_ID;
  if (!gcpProjectId) missing.push('GCP_PROJECT_ID');

  const bigqueryDataset = process.env.BIGQUERY_DATASET;
  if (!bigqueryDataset) missing.push('BIGQUERY_DATASET');

  const bigqueryTable = process.env.BIGQUERY_TABLE;
  if (!bigqueryTable) missing.push('BIGQUERY_TABLE');

  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) missing.push('ANTHROPIC_API_KEY');

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
        'Set these in your environment or Claude Desktop config.'
    );
  }

  return {
    gcpProjectId: gcpProjectId!,
    bigqueryDataset: bigqueryDataset!,
    bigqueryTable: bigqueryTable!,
    anthropicApiKey: anthropicApiKey!,
    googleApplicationCredentials: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    gcpCredentialsBase64: process.env.GCP_CREDENTIALS_BASE64,
    internalApiKeys: process.env.TOGARI_INTERNAL_KEYS
      ? process.env.TOGARI_INTERNAL_KEYS.split(',').map((k) => k.trim()).filter(Boolean)
      : undefined,
    externalApiKeys: process.env.TOGARI_EXTERNAL_KEYS
      ? process.env.TOGARI_EXTERNAL_KEYS.split(',').map((k) => k.trim()).filter(Boolean)
      : undefined,
    bigqueryDealsTable: process.env.BIGQUERY_DEALS_TABLE,
  };
}
