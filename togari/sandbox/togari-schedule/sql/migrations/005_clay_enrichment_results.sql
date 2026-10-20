-- Add pull_id and row_id to togari_structured_contacts
-- Allows the Clay enrichment webhook to write directly to the contacts table
-- and the data-pull pipeline to poll for its specific contacts by pull_id.
--
-- Run against: midyear-glazing-485303-u3.togari_data_lake

ALTER TABLE `midyear-glazing-485303-u3.togari_data_lake.togari_structured_contacts`
  ADD COLUMN IF NOT EXISTS pull_id STRING
    OPTIONS (description = 'data_pull_requests.pull_id — set when contact was added via a data pull'),
  ADD COLUMN IF NOT EXISTS row_id  STRING
    OPTIONS (description = 'UUID generated per contact per pull — used to match Clay callback rows');
