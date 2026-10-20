-- Uploaded decks stay in Slack; /d/<token> serves them. src/replies/decks.ts.
ALTER TABLE `midyear-glazing-485303-u3.togari_data_lake.client_decks`
  ADD COLUMN IF NOT EXISTS token STRING,
  ADD COLUMN IF NOT EXISTS slack_file_id STRING,
  ADD COLUMN IF NOT EXISTS file_name STRING;
