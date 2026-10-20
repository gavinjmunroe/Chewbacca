-- Enrichment run companies
-- Sibling of tiering_run_companies for enrichment. Adds agent_summary so per-company
-- agent reasoning is queryable without re-reading the full processing log.

CREATE TABLE IF NOT EXISTS `togari_core.enrichment_run_companies` (
  id                    STRING    NOT NULL,
  tenant_id             STRING    NOT NULL,
  enrichment_run_id     STRING    NOT NULL,
  company_id            STRING    NOT NULL,
  status                STRING    NOT NULL,
  attempts              INT64,
  started_at            TIMESTAMP,
  finished_at           TIMESTAMP,
  error_message         STRING,
  processing_log        JSON,
  agent_summary         STRING,
  created_at            TIMESTAMP NOT NULL,
  PRIMARY KEY (id) NOT ENFORCED
)
CLUSTER BY tenant_id, enrichment_run_id, status;
