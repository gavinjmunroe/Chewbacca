-- 0030_togari_clay_connector.sql
--
-- Backing table for the universal Clay connector. Togari exposes one
-- endpoint (POST /clay/v1/sync) that a user adds as an HTTP API enrichment
-- column to ANY Clay table. Unknown tables auto-register here on first row,
-- so the connector works on every table with zero per-table setup.
--
-- Apply: bq query --use_legacy_sql=false --project_id=$GCP_PROJECT_ID < this_file
-- Net-new empty table; nothing existing is altered.

CREATE TABLE IF NOT EXISTS `togari_data_lake.clay_table_registry` (
  table_key     STRING    NOT NULL,   -- Clay table identifier / name
  client_id     STRING,
  status        STRING,               -- active | paused
  row_count     INT64,
  first_seen_at TIMESTAMP NOT NULL,
  last_seen_at  TIMESTAMP
)
CLUSTER BY client_id, table_key;
