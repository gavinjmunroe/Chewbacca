-- 0046_campaign_events_status.sql
--
-- Clay's own status for the campaign (Campaign > Status on every event, e.g.
-- ACTIVE), so the campaign calendar says Sending or Paused from Clay rather
-- than guessing from the last send date. Status-change events are stored too,
-- as event_type 'status', and never counted as activity.
--
-- Apply: bq query --use_legacy_sql=false --project_id=$GCP_PROJECT_ID < this_file
-- Adds one nullable column; existing rows read NULL.

ALTER TABLE `togari_data_lake.campaign_events`
  ADD COLUMN IF NOT EXISTS campaign_status STRING;
