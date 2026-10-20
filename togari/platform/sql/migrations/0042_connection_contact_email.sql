-- 0042_connection_contact_email.sql
--
-- The customer contact's email, so the warm-intro digest can say how to
-- reach the person being asked for the introduction.
--
--   connection_items.person_email   sent by Clay's intake column (optional)
--   connection_paths.champion_email carried onto each path when it arrives
--
-- Both nullable: rows from before this have none, and a contact Clay has no
-- email for still produces a path. Where it is missing, a row_id that is
-- itself an email address is used instead (src/connections/paths.ts).
--
-- Apply: bq query --use_legacy_sql=false --project_id=$GCP_PROJECT_ID < this_file
-- Adds columns only; existing rows and data are untouched.

ALTER TABLE `togari_data_lake.connection_items`
  ADD COLUMN IF NOT EXISTS person_email STRING;

ALTER TABLE `togari_data_lake.connection_paths`
  ADD COLUMN IF NOT EXISTS champion_email STRING;
