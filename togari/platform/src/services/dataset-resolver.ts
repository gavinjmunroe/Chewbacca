// single-tenant — BMA org only, always togari_data_lake

const DATASET = "togari_data_lake";

/**
 * Returns the BigQuery dataset name for the current request.
 */
export function resolveDataset(): string {
  return DATASET;
}

/**
 * Returns the BigQuery dataset name for the given tenant.
 * Signature kept for callers that pass an explicit tenantId.
 */
export function resolveDatasetFor(_tenantId: string): string {
  return DATASET;
}

/**
 * Build a fully-qualified BigQuery table reference.
 * Example: qualifiedTable("deals")
 *   → "midyear-glazing-485303-u3.togari_data_lake.deals"
 */
export function qualifiedTable(tableName: string, projectId?: string): string {
  const project = projectId ?? process.env.GCP_PROJECT_ID;
  if (!project) {
    throw new Error("qualifiedTable() requires GCP_PROJECT_ID env var");
  }
  return `${project}.${DATASET}.${tableName}`;
}
