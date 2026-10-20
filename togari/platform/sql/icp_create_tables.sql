-- Website ICP list funnel — jobs + contact messages.
-- Run via: npx tsx src/scripts/bootstrap-icp.ts
-- Idempotent: CREATE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS `midyear-glazing-485303-u3.togari_core.icp_list_jobs` (
  job_id            STRING NOT NULL,   -- uuid; doubles as the Clay row_id passthrough
  created_at        TIMESTAMP NOT NULL,
  updated_at        TIMESTAMP,
  status            STRING NOT NULL,   -- pending|building|done|done_unsent|no_matches|failed|timed_out
  full_name         STRING,
  email             STRING NOT NULL,
  company           STRING,
  company_domain    STRING,            -- the requester's own domain
  company_description STRING,          -- optional: what they sell
  industry          STRING,            -- the industry the requester sells FROM
  icp_description   STRING NOT NULL,   -- free-text ideal customer profile
  company_size      STRING,            -- optional size band
  target_titles     ARRAY<STRING>,     -- roles to find inside each account
  ip_hash           STRING,            -- sha256 of client ip; raw ip is never stored
  dnc_suppressed    BOOL,
  work_email        BOOL,              -- false for gmail/outlook etc.
  lead_score        INT64,
  list_data         JSON,              -- the accounts/contacts Clay returned
  list_size         INT64,
  clay_status       STRING,            -- found|not_found|error
  callback_count    INT64,             -- observability for duplicate callbacks
  processed_at      TIMESTAMP,         -- idempotency guard for the Clay callback
  thankyou_emailed_at TIMESTAMP,       -- when the intake thank-you went out
  email_message_id  STRING,
  error             STRING
) PARTITION BY DATE(created_at);

CREATE TABLE IF NOT EXISTS `midyear-glazing-485303-u3.togari_core.website_contact_messages` (
  message_id  STRING NOT NULL,
  created_at  TIMESTAMP NOT NULL,
  full_name   STRING,
  email       STRING NOT NULL,
  message     STRING,
  ip_hash     STRING
) PARTITION BY DATE(created_at);

-- Website leads land in the CRM contacts table with a source tag + score.
ALTER TABLE `midyear-glazing-485303-u3.togari_data_lake.togari_structured_contacts`
  ADD COLUMN IF NOT EXISTS source_tag STRING,
  ADD COLUMN IF NOT EXISTS lead_score INT64,
  ADD COLUMN IF NOT EXISTS lead_score_detail JSON;

-- The list CSV email (or the fallback note), stamped by the Clay callback.
ALTER TABLE `midyear-glazing-485303-u3.togari_core.icp_list_jobs`
  ADD COLUMN IF NOT EXISTS list_emailed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS list_email_message_id STRING;
