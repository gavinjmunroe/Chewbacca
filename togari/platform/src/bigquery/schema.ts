/**
 * Togari Core BigQuery schema (TypeScript types).
 *
 * Mirrors the DDL in sql/migrations/0001..0021 exactly. Use these types when
 * inserting or reading rows via the @google-cloud/bigquery client.
 *
 * Conventions
 *   - All IDs are STRING (UUIDs stored as text). No numeric SERIAL.
 *   - All TIMESTAMP columns map to ISO-8601 strings on the wire; the BQ client
 *     returns BigQueryTimestamp objects on read. The types here represent the
 *     *write* shape; callers convert on read as needed.
 *   - JSON columns map to `unknown` so callers narrow with their own schema.
 *   - Optional columns are typed `T | null` (BQ returns null, not undefined).
 *   - Tenant isolation is enforced at the app layer: every query must filter
 *     by tenant_id. See sql/README.md for the contract.
 *
 * Dataset: togari_core
 */

// Tenants -------------------------------------------------------------------

export interface Tenant {
  id: string;
  name: string;
  created_at: string;
}

// Mandates ------------------------------------------------------------------

export interface Mandate {
  id: string;
  tenant_id: string;
  name: string;
  context: string | null;
  active_criteria_version_id: string | null;
  tool_settings: unknown | null;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface MandateCriteriaVersion {
  id: string;
  tenant_id: string;
  mandate_id: string;
  version_number: number;
  spec_text: string | null;
  key_data_points: unknown | null;
  created_at: string;
}

// Companies and joins -------------------------------------------------------

export interface Company {
  id: string;
  tenant_id: string;
  name: string;
  website: string | null;
  address: string | null;
  dc_id: string | null;
  source_original: string | null;
  created_at: string;
  updated_at: string;
}

export interface MandateCompany {
  mandate_id: string;
  company_id: string;
  tenant_id: string;
  source_original: string | null;
  added_at: string;
  removed_at: string | null;
}

export interface MandateTag {
  id: string;
  tenant_id: string;
  mandate_id: string;
  name: string;
  color: string | null;
  created_at: string;
}

export interface MandateCompanyTag {
  mandate_id: string;
  company_id: string;
  tag_id: string;
  tenant_id: string;
}

// Datapoints ----------------------------------------------------------------

export interface Datapoint {
  id: string;
  tenant_id: string;
  company_id: string;
  key: string;
  value: string | null;
  source_type: string | null;
  source_evidence_url: string | null;
  created_at: string;
}

// Contacts ------------------------------------------------------------------

export interface Contact {
  id: string;
  tenant_id: string;
  company_id: string;
  enrichment_run_id: string | null;
  source: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  email: string | null;
  email_verified: boolean | null;
  mobile_phone: string | null;
  business_phone: string | null;
  linkedin_url: string | null;
  dc_contact_id: string | null;
  contact_info: unknown | null;
  is_primary: boolean | null;
  primary_score: number | null;
  primary_reason: string | null;
  created_at: string;
  updated_at: string;
}

// Tiering and enrichment runs ----------------------------------------------

export type RunStatus =
  | "pending"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "paused"
  | "stopped";

export type TieringRunMode = "sequential" | "agent";
export type EnrichmentRunMode = "sequential" | "agent";

export interface TieringRun {
  id: string;
  tenant_id: string;
  mandate_id: string;
  criteria_version_id: string | null;
  status: RunStatus;
  mode: TieringRunMode | null;
  tool_settings: unknown | null;
  priority: number | null;
  preempted_by: string | null;
  total_cost_cents: number | null;
  cost_breakdown: unknown | null;
  key_data_points: unknown | null;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  created_at: string;
}

export type RunCompanyStatus =
  | "pending"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export interface TieringRunCompany {
  id: string;
  tenant_id: string;
  tiering_run_id: string;
  company_id: string;
  status: RunCompanyStatus;
  attempts: number | null;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  processing_log: unknown | null;
  created_at: string;
}

export interface Tier {
  tiering_run_id: string;
  company_id: string;
  tenant_id: string;
  /** 1 = best, 4 = worst. App layer enforces the 1-4 range. */
  tier: 1 | 2 | 3 | 4;
  confidence_score: number | null;
  rationale: string | null;
  structured_rationale: unknown | null;
  created_at: string;
}

export interface EnrichmentRun {
  id: string;
  tenant_id: string;
  mandate_id: string;
  criteria_version_id: string | null;
  status: RunStatus;
  mode: EnrichmentRunMode | null;
  tool_settings: unknown | null;
  priority: number | null;
  preempted_by: string | null;
  total_cost_cents: number | null;
  cost_breakdown: unknown | null;
  key_data_points: unknown | null;
  agent_summary: string | null;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  created_at: string;
}

export interface EnrichmentRunCompany {
  id: string;
  tenant_id: string;
  enrichment_run_id: string;
  company_id: string;
  status: RunCompanyStatus;
  attempts: number | null;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  processing_log: unknown | null;
  agent_summary: string | null;
  created_at: string;
}

// Cost and prompt logs ------------------------------------------------------

export type CostServiceType =
  | "ai"
  | "google_places"
  | "zoominfo"
  | "enformion"
  | "exa"
  | "crustdata"
  | "perplexity"
  | "grata";

export interface CostLog {
  id: string;
  tenant_id: string;
  tiering_run_id: string | null;
  enrichment_run_id: string | null;
  company_id: string | null;
  service_type: CostServiceType;
  operation: string;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  total_cost_cents: number;
  metadata: unknown | null;
  created_at: string;
}

export interface PromptLog {
  id: string;
  tenant_id: string;
  input: string | null;
  prompt: string | null;
  output: string | null;
  metadata: unknown | null;
  company_id: string | null;
  tiering_run_id: string | null;
  processing_step: string | null;
  created_at: string;
}

// Admin settings ------------------------------------------------------------

/**
 * Shape of the `pricing_config` admin_settings row. Mirrors autotier's
 * DEFAULT_PRICING_CONFIG. Pricing units:
 *   - ai.*.input_per_1m / output_per_1m: cents per 1,000,000 tokens
 *   - ai.*.web_search_per_call: cents per web-search tool call
 *   - external.*: cents per call
 */
export interface PricingConfig {
  ai: Record<
    string,
    {
      input_per_1m: number;
      output_per_1m: number;
      web_search_per_call?: number;
    }
  >;
  external: Record<string, number>;
}

export interface AdminSetting {
  key: string;
  tenant_id: string;
  value: unknown;
  updated_at: string;
}

// Enrichment job fan-out ----------------------------------------------------

export type EnrichmentJobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

export interface EnrichmentJob {
  id: string;
  tenant_id: string;
  mandate_id: string | null;
  company_id: string | null;
  job_type: string;
  status: EnrichmentJobStatus;
  payload: unknown | null;
  result: unknown | null;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  created_at: string;
}

// Clay webhook ingestion ----------------------------------------------------

export type ClayImportStatus = "pending" | "completed" | "failed";

export interface ClayImport {
  id: string;
  tenant_id: string;
  clay_run_id: string;
  clay_table_id: string | null;
  mandate_id: string | null;
  payload_hash: string;
  total_records: number | null;
  company_count: number | null;
  contact_count: number | null;
  status: ClayImportStatus;
  error_message: string | null;
  received_at: string;
  processed_at: string | null;
}

// Tenant secrets ------------------------------------------------------------

/**
 * Per-tenant encrypted credential store. Plaintext NEVER lives in BQ; reads
 * and writes go through src/secrets/tenantSecrets.ts which AES-256-GCM
 * encrypts with the runtime master key (TENANT_SECRETS_MASTER_KEY).
 */
export interface TenantSecret {
  tenant_id: string;
  key_name: string;
  ciphertext_b64: string;
  nonce_b64: string;
  auth_tag_b64: string;
  created_at: string;
  rotated_at: string | null;
}

// Table name registry -------------------------------------------------------

/**
 * Fully-qualified BigQuery table names for the togari_core dataset.
 * Use these constants instead of string literals to keep table references
 * grep-able across the codebase.
 */
export const TOGARI_CORE_TABLES = {
  tenants: "togari_core.tenants",
  mandates: "togari_core.mandates",
  mandate_criteria_versions: "togari_core.mandate_criteria_versions",
  companies: "togari_core.companies",
  mandate_companies: "togari_core.mandate_companies",
  mandate_tags: "togari_core.mandate_tags",
  mandate_company_tags: "togari_core.mandate_company_tags",
  datapoints: "togari_core.datapoints",
  contacts: "togari_core.contacts",
  tiering_runs: "togari_core.tiering_runs",
  tiering_run_companies: "togari_core.tiering_run_companies",
  tiers: "togari_core.tiers",
  enrichment_runs: "togari_core.enrichment_runs",
  enrichment_run_companies: "togari_core.enrichment_run_companies",
  cost_logs: "togari_core.cost_logs",
  prompt_logs: "togari_core.prompt_logs",
  admin_settings: "togari_core.admin_settings",
  enrichment_jobs: "togari_core.enrichment_jobs",
  clay_imports: "togari_core.clay_imports",
  tenant_secrets: "togari_core.tenant_secrets",
} as const;

export type TogariCoreTableName = keyof typeof TOGARI_CORE_TABLES;
