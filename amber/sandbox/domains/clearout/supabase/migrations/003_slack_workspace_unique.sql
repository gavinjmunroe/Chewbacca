-- Fix Slack channel uniqueness: add unique constraint on (user_id, type, workspace_id)
-- for channels without account_email (Slack, iMessage, etc.)
CREATE UNIQUE INDEX IF NOT EXISTS channels_slack_workspace_unique
  ON channels(user_id, type, workspace_id)
  WHERE workspace_id IS NOT NULL;
