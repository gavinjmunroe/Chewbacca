-- 0035_perplexity_calls.sql
--
-- One row per call to Perplexity, which is the only spend protection there is.
-- Perplexity never reports what a call cost, so a counter we keep ourselves is
-- the only thing standing between a retry loop and an empty account (plan step
-- 08f). Every dispatch and every chase-up writes here before it calls.
--
-- Partitioned by day because the only question ever asked of it is "how many
-- calls has this account made today", which then reads one partition.
--
-- Apply: bq query --use_legacy_sql=false --project_id=$GCP_PROJECT_ID < this_file
-- Net-new empty table; nothing existing is altered.

CREATE TABLE IF NOT EXISTS `togari_data_lake.perplexity_calls` (
  call_id    STRING    NOT NULL,  -- uuid, for tracing a call back to its log line
  account    STRING    NOT NULL,  -- which Perplexity login was billed
  row_id     STRING,              -- the reply this was for, when there is one
  kind       STRING,              -- dispatch | chase
  created_at TIMESTAMP NOT NULL
)
PARTITION BY DATE(created_at)
CLUSTER BY account;
