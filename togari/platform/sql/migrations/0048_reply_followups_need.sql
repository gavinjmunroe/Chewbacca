-- 0048_reply_followups_need.sql
--
-- What a follow-up parked as 'waiting_on_principal' is waiting for: one of
-- booking_slots, form, deck, number, intro, other, plus the sentence the
-- principal was tagged with in the client channel (src/replies/repair.ts).
--
-- Until this is applied the repair loop still parks rows and posts the need
-- to Slack; it only skips storing the need here (store.followupNeedColumns
-- reads INFORMATION_SCHEMA before writing or selecting these columns).
--
-- Apply: bq query --use_legacy_sql=false --project_id=$GCP_PROJECT_ID < this_file
-- Adds two nullable columns; existing rows read NULL.

ALTER TABLE `togari_data_lake.reply_followups`
  ADD COLUMN IF NOT EXISTS need STRING,
  ADD COLUMN IF NOT EXISTS need_text STRING;
