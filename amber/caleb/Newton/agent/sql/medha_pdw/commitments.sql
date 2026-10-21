-- flaw #28: commitments table.
-- Promotes commitments out of the event_messages "direction = commitment" hack
-- into a first-class table the Phase 5 extractor, conflict scan, and T-24h
-- reminder cron can index cheaply.
--
-- Run from your shell (gcloud auth as caleb@bluemodernadvisory.com,
-- gcloud project midyear-glazing-485303-u3):
--
--   bq mk --table \
--     --description="Medha commitments (flaw #28)" \
--     midyear-glazing-485303-u3:medha_pdw.commitments \
--     tenant_id:STRING,commitment_id:STRING,event_id:STRING,person_id:STRING,item:STRING,normalized_item:STRING,status:STRING,source:STRING,committed_at:TIMESTAMP,reminded_at:TIMESTAMP,completed_at:TIMESTAMP
--
-- Grant the medha-agent SA WRITER (matches the existing dataset grant pattern):
--
--   bq update --source <(bq show --format=prettyjson midyear-glazing-485303-u3:medha_pdw \
--     | jq '.access += [{"role":"WRITER","userByEmail":"medha-agent@midyear-glazing-485303-u3.iam.gserviceaccount.com"}]') \
--     midyear-glazing-485303-u3:medha_pdw
--
-- (If the WRITER grant is already present at the dataset level for the SA,
-- the second command is a no-op and can be skipped.)
--
-- Equivalent CREATE TABLE for reference / drift-checking:

CREATE TABLE IF NOT EXISTS `midyear-glazing-485303-u3.medha_pdw.commitments` (
  tenant_id        STRING NOT NULL,
  commitment_id    STRING NOT NULL,
  event_id         STRING NOT NULL,
  person_id        STRING NOT NULL,
  item             STRING,
  normalized_item  STRING,
  status           STRING,  -- open | confirmed | completed | missed | cancelled
  source           STRING,  -- chat | dm | dashboard | vague_chat
  committed_at     TIMESTAMP,
  reminded_at      TIMESTAMP,
  completed_at     TIMESTAMP
);
