-- 0045_reply_card_actions.sql
--
-- What happened to a reply: an answer went out (a Slack card, a modal,
-- auto-send or the assistant), or a person skipped it or marked it done outside
-- email. The campaign calendar counts a reply as still needing an answer until
-- one of these lands for that prospect.
--
-- Its own append-only table, not a column on reply_items: a sent reply's
-- reply_items row is deleted (forgetAnsweredReply in slack-actions.ts), and
-- some clients' cards never had a reply_items row at all.
--
-- Written by src/replies/card-actions.ts only, one INSERT each.
--
-- Apply: bq query --use_legacy_sql=false --project_id=$GCP_PROJECT_ID < this_file
-- Net-new empty table; nothing existing is altered.

CREATE TABLE IF NOT EXISTS `togari_data_lake.reply_card_actions` (
  client_id     STRING    NOT NULL,
  lead_email    STRING    NOT NULL,  -- the prospect the card was about, lowercased
  campaign_id   STRING,
  campaign_name STRING,
  action        STRING    NOT NULL,  -- sent | skipped | done
  by_user       STRING,              -- Slack username, or 'togari' for its own sends
  acted_at      TIMESTAMP NOT NULL
)
PARTITION BY DATE(acted_at)
CLUSTER BY client_id, lead_email;
