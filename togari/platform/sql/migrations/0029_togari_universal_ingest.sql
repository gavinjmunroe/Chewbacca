-- 0029_togari_universal_ingest.sql
--
-- Raw landing table for universal ingestion. Togari as a data lakehouse:
-- ANY submitted data (text, CSV, JSON, XLSX, file) is preserved here
-- verbatim before AI extraction routes structured entities into the CRM
-- tables. Raw is never mutated, so extraction is always re-runnable and
-- nothing is lost. Tenancy key is client_id.
--
-- Apply: bq query --use_legacy_sql=false --project_id=$GCP_PROJECT_ID < this_file
-- Net-new empty table; nothing existing is altered.

CREATE TABLE IF NOT EXISTS `togari_data_lake.raw_ingestions` (
  ingestion_id     STRING    NOT NULL,
  client_id        STRING,
  source           STRING,        -- portal | mcp | api | clay | gmail | ...
  content_type     STRING,        -- text | csv | json | xlsx | file
  raw_text         STRING,        -- original free-form / decoded content
  raw_json         JSON,          -- original structured payload when present
  file_name        STRING,
  status           STRING,        -- received | processed | failed
  extracted_count  INT64,
  summary          STRING,
  created_at       TIMESTAMP NOT NULL
)
PARTITION BY DATE(created_at)
CLUSTER BY client_id, status;
