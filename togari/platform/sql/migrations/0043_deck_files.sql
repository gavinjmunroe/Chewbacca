-- Decks served at /d/<token>, stored in Togari's own table.
--
-- 2026-10-13: every Slack-hosted deck went file_not_found and four Zeutara
-- investors (Gary Zimmerman, Jeremy Jonker, Eric Chin, Joseph Akpan) got 404s.
-- The same PDFs were loaded here under their original tokens so the links in
-- those inboxes open again. Those links are live in investors' email: never
-- drop, truncate or replace this table, and never delete a token's rows.
--
-- One row per 6MB part: BigQuery returns at most 20MB per row and the Qube
-- deck alone is 19MB (25MB encoded). Read in part order and concatenate.
-- Created by hand with `bq load` on 2026-10-13; this file records the shape.
CREATE TABLE IF NOT EXISTS `midyear-glazing-485303-u3.togari_data_lake.deck_files` (
  token STRING,
  client_id STRING,
  company STRING,
  file_name STRING,
  mime STRING,
  part INT64,
  content BYTES,
  added_at TIMESTAMP
);
