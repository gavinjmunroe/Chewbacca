-- 0036_reply_items_lead_profile.sql
--
-- Who replied: the prospect's full name, title and company, sent by Clay on
-- the /replies intake as lead_name / lead_title / lead_company. They fill the
-- Slack card's Name / Title / Company line (which otherwise reads "Unknown")
-- and go into the Perplexity task message so a draft can greet the prospect by
-- name and speak to their role.
--
-- Apply: bq query --use_legacy_sql=false --project_id=$GCP_PROJECT_ID < this_file
-- Additive: existing rows get NULL in all three. Nothing is rewritten.
--
-- Apply this BEFORE deploying the code that writes them: the intake MERGE names
-- these columns, so against a table without them every /replies POST fails.

ALTER TABLE `togari_data_lake.reply_items`
  ADD COLUMN IF NOT EXISTS lead_name    STRING,   -- full name, as one string
  ADD COLUMN IF NOT EXISTS lead_title   STRING,
  ADD COLUMN IF NOT EXISTS lead_company STRING;
