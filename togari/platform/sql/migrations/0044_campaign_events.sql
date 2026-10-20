-- 0044_campaign_events.sql
--
-- Every send, reply and bounce from a client's Clay campaigns, for the campaign
-- calendar at /dash/<token>/calendar (src/routes/campaign-calendar.ts).
--
-- Clay writes each campaign's events to that campaign's own Events table. An
-- HTTP API column on that table POSTs each row to /campaign-events
-- (src/routes/campaign-events.ts), which streams it in here. Setup per client
-- and per campaign: docs/CAMPAIGN_CALENDAR_NEW_CLIENT.md.
--
-- Streamed, not MERGEd. A campaign's history arrives as thousands of rows at
-- once when the column is first added, and BigQuery queues only a handful of
-- DML statements per table before refusing the rest. event_id rides as the
-- streaming insertId, which drops most retries, and every read takes the
-- first row per (client_id, event_id) for the rest (src/campaigns/calendar.ts).
--
-- A reply's text is never stored. Togari sorts it into `outcome` on arrival
-- (src/campaigns/events.ts) and keeps only that.
--
-- Apply: bq query --use_legacy_sql=false --project_id=$GCP_PROJECT_ID < this_file
-- Net-new empty table; nothing existing is altered.

CREATE TABLE IF NOT EXISTS `togari_data_lake.campaign_events` (
  event_id      STRING    NOT NULL,  -- Clay's row id in the campaign's Events table
  client_id     STRING    NOT NULL,  -- replybot client, e.g. 'serif'
  event_type    STRING    NOT NULL,  -- sent | reply | bounce
  campaign_id   STRING,              -- Clay's campaign id
  campaign_name STRING,
  lead_email    STRING,              -- the prospect, lowercased
  lead_name     STRING,
  step          INT64,               -- sequence step of a send, 1 = first email
  occurred_at   TIMESTAMP NOT NULL,  -- when Clay says it happened
  -- Replies only: interested | needs_read | ooo | pass | opt_out | redirect | later | auto
  outcome       STRING,
  -- Optional, typed into the Clay column by whoever sets the campaign up.
  planned_start DATE,
  planned_end   DATE,
  received_at   TIMESTAMP NOT NULL   -- when Togari got it
)
PARTITION BY DATE(occurred_at)
CLUSTER BY client_id, event_type;
