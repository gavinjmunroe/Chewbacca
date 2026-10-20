-- Togari reminders — first-class persistent reminder rows
--
-- Closes audit §2.1: today reminders are fire-and-forget via Slack's
-- chat.scheduleMessage (no BQ row, no way to list/cancel after the fact).
-- The tool-use runner's `set_reminder` handler now writes one row here
-- per scheduled reminder, stores the chat.scheduleMessage id, and posts a
-- small confirmation message with a [❌ Cancel] button. Cancel updates
-- this row's status to 'cancelled' and deletes the scheduled Slack
-- message via chat.deleteScheduledMessage.
--
-- status lifecycle: 'scheduled' → ('cancelled' | 'fired' | 'failed')
-- 'fired' is a future-work column; today chat.scheduleMessage doesn't
-- notify us when it actually fires. See plan §7 punted follow-up.

CREATE TABLE IF NOT EXISTS `midyear-glazing-485303-u3.togari_data_lake.togari_reminders` (
  reminder_id                  STRING        NOT NULL,
  slack_scheduled_message_id   STRING,                     -- id from chat.scheduleMessage (Q…)
  slack_reminder_id            STRING,                     -- id from reminders.add (Rm…)
  slack_api_method             STRING,                     -- 'reminders.add' | 'chat.scheduleMessage'
  confirmation_channel         STRING,
  confirmation_ts              STRING,
  channel                      STRING,
  thread_ts                    STRING,
  creator_user_id              STRING,
  target_user_id               STRING,
  mentioned_user_ids           ARRAY<STRING>,
  original_text                STRING,
  reminder_text                STRING,
  parsed_intent                JSON,
  scheduled_at                 TIMESTAMP,
  fired_at                     TIMESTAMP,
  cancelled_at                 TIMESTAMP,
  cancelled_by                 STRING,
  status                       STRING        NOT NULL,
  tenant_id                    STRING        NOT NULL,
  created_at                   TIMESTAMP     NOT NULL,
  updated_at                   TIMESTAMP     NOT NULL,
  PRIMARY KEY (reminder_id) NOT ENFORCED
)
PARTITION BY DATE(created_at)
CLUSTER BY tenant_id, status, target_user_id;
