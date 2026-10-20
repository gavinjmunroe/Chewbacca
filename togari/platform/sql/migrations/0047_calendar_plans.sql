-- 0047_calendar_plans.sql
--
-- Conferences added from the campaign calendar page (src/campaigns/plans.ts):
-- a name and the days its outreach should run. Each one's dates go on every
-- campaign named after it, or it gets a planned bar of its own.
--
-- Removing one stamps removed_at; rows are never deleted, so a mistaken
-- removal can be undone by clearing it.
--
-- Apply: bq query --use_legacy_sql=false --project_id=$GCP_PROJECT_ID < this_file
-- Net-new empty table; nothing existing is altered.

CREATE TABLE IF NOT EXISTS `togari_data_lake.calendar_plans` (
  plan_id     STRING    NOT NULL,
  client_id   STRING    NOT NULL,
  name        STRING    NOT NULL,  -- the conference, matched to campaign names
  start_date  DATE      NOT NULL,  -- when its outreach should start
  end_date    DATE      NOT NULL,  -- and end
  created_at  TIMESTAMP NOT NULL,
  removed_at  TIMESTAMP            -- set when taken off the calendar
)
CLUSTER BY client_id;
