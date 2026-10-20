-- Tiering run companies
-- One row per (tiering_run, company) being scored. Tracks per-company progress
-- inside a run: attempts, timing, processing log (free-form JSON the worker appends to).

CREATE TABLE IF NOT EXISTS `togari_core.tiering_run_companies` (
  id                STRING    NOT NULL,
  tenant_id         STRING    NOT NULL,
  tiering_run_id    STRING    NOT NULL,
  company_id        STRING    NOT NULL,
  status            STRING    NOT NULL,
  attempts          INT64,
  started_at        TIMESTAMP,
  finished_at       TIMESTAMP,
  error_message     STRING,
  processing_log    JSON,
  created_at        TIMESTAMP NOT NULL,
  PRIMARY KEY (id) NOT ENFORCED
)
CLUSTER BY tenant_id, tiering_run_id, status;
