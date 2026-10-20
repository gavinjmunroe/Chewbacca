-- Enrichment jobs
-- Pub/Sub fan-out tracking: one row per individual enrichment task spawned by the
-- scheduler. Different from enrichment_run_companies in that a single company
-- may have multiple jobs (one per tool: Exa search, then CrustData enrich, etc.)
-- when the worker decomposes the agent loop into parallel sub-tasks.

CREATE TABLE IF NOT EXISTS `togari_core.enrichment_jobs` (
  id              STRING    NOT NULL,
  tenant_id       STRING    NOT NULL,
  mandate_id      STRING,
  company_id      STRING,
  job_type        STRING    NOT NULL,
  status          STRING    NOT NULL,
  payload         JSON,
  result          JSON,
  started_at      TIMESTAMP,
  finished_at     TIMESTAMP,
  error_message   STRING,
  created_at      TIMESTAMP NOT NULL,
  PRIMARY KEY (id) NOT ENFORCED
)
PARTITION BY DATE(created_at)
CLUSTER BY tenant_id, status, job_type;
