-- 0050_connection_research_mode.sql
--
-- How each warm-intro person was researched, now that the shared network
-- (0049, togari_core.network_*) is checked before Perplexity is paid
-- (src/network/reuse.ts):
--
--   research_mode       reuse  served from the network, no Perplexity call
--                       topup  the network plus a smaller call for the missing
--                              colleagues and buyer seats
--                       full   researched from scratch, as before
--                       NULL   researched before this column existed (full)
--   reused_result_json  for reuse and topup: the stored histories the row
--                       started from, as {"result": ConnectionResultPayload,
--                       "colleague_ids": [...]}. A top-up's result is merged
--                       with this when it arrives, so its paths cover both.
--
-- Until this is applied, reuse stays off and every person is researched in
-- full (store.researchModeColumns reads INFORMATION_SCHEMA first).
--
-- Apply: bq query --use_legacy_sql=false --project_id=$GCP_PROJECT_ID < this_file
-- Adds two nullable columns; existing rows read NULL.

ALTER TABLE `togari_data_lake.connection_items`
  ADD COLUMN IF NOT EXISTS research_mode STRING,
  ADD COLUMN IF NOT EXISTS reused_result_json STRING;
