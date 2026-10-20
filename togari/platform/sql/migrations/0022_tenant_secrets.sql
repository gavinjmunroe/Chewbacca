-- Tenant secrets
-- Per-tenant credential store (OpenAI keys, ZoomInfo PKI triple, Anthropic keys, etc.).
-- AES-256-GCM ciphertext written by src/secrets/tenantSecrets.ts. The master key
-- (TENANT_SECRETS_MASTER_KEY env var, 32 bytes / 64 hex chars) is held only by
-- Togari's runtime; plaintext NEVER lives in BigQuery.
--
-- Composite uniqueness on (tenant_id, key_name) is enforced at app layer via
-- MERGE in setTenantSecret. BigQuery does not support unique constraints.
--
-- Cluster + partition tuned for the dominant access pattern: point-lookup by
-- (tenant_id, key_name) on every server-side LLM / external-API call.

CREATE TABLE IF NOT EXISTS `togari_core.tenant_secrets` (
  tenant_id      STRING    NOT NULL,
  key_name       STRING    NOT NULL,
  ciphertext_b64 STRING    NOT NULL,
  nonce_b64      STRING    NOT NULL,
  auth_tag_b64   STRING    NOT NULL,
  created_at     TIMESTAMP NOT NULL,
  rotated_at     TIMESTAMP
)
PARTITION BY DATE(created_at)
CLUSTER BY tenant_id, key_name
OPTIONS (
  description = "Per-tenant API keys + secrets, AES-256-GCM encrypted with TENANT_SECRETS_MASTER_KEY from env. Plaintext NEVER lives in BQ. Composite key (tenant_id, key_name) enforced at app layer via MERGE."
);
