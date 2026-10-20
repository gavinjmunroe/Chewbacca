-- Opportunity Notification Engine tables
-- Run against: midyear-glazing-485303-u3.togari_data_lake
--
-- Maps to Clay workflow:
--   Step 1: "Find Companies" — target_industries, target_company_sizes, target_location
--   Step 2: "Job Posting" signal — target_job_titles, target_seniority, target_employment_type, posting_limit
--   Step 3: Enrichment + notification delivery

CREATE TABLE IF NOT EXISTS `midyear-glazing-485303-u3.togari_data_lake.opportunity_subscriptions` (
  subscription_id        STRING    NOT NULL,
  subscriber_email       STRING    NOT NULL,
  subscriber_name        STRING,

  -- Pricing plan
  plan                   STRING    DEFAULT 'starter',   -- starter | growth
  max_companies          INT64     DEFAULT 50,

  -- Step 1: Find Companies (Clay "Find Companies" table — set up manually per client)
  target_industries      ARRAY<STRING>,
  target_company_sizes   ARRAY<STRING>,     -- LinkedIn employee count brackets: A-I
  target_location        STRING    DEFAULT 'United States',

  -- Step 2: Job Posting signal (Clay "Job Posting" enrichment + Exa supplement)
  target_job_titles      ARRAY<STRING>,
  target_seniority       STRING,            -- single value: internship, entry_level, associate, mid_senior, director, executive
  target_employment_type STRING,            -- full_time, part_time, contract, temporary, internship, volunteer
  posting_limit_per_company INT64  DEFAULT 10,
  target_keywords        ARRAY<STRING>,

  -- Notification preferences
  notification_channels  ARRAY<STRING>,     -- email, slack (supports multiple)
  slack_channel_id       STRING,
  notification_email     STRING,

  -- Clay integration
  clay_table_webhook_url STRING,            -- Pre-configured Clay table webhook URL per client
  clay_results_table_id  STRING,            -- Identifier for the Clay table (operator reference)

  -- Billing (Stripe)
  stripe_customer_id     STRING,
  stripe_subscription_id STRING,
  stripe_price_id        STRING,
  payment_status         STRING    DEFAULT 'pending',   -- pending | active | past_due | canceled

  -- State
  status                 STRING    DEFAULT 'active',    -- active | paused | canceled
  last_enrichment_at     TIMESTAMP,
  last_notification_at   TIMESTAMP,
  created_at             TIMESTAMP,
  updated_at             TIMESTAMP
)
PARTITION BY DATE(created_at)
OPTIONS (
  description = 'Opportunity notification subscriptions — maps Framer form inputs to Clay/Exa enrichment pipeline'
);

CREATE TABLE IF NOT EXISTS `midyear-glazing-485303-u3.togari_data_lake.notification_history` (
  notification_id      STRING    NOT NULL,
  subscription_id      STRING    NOT NULL,
  channel              STRING    NOT NULL,
  status               STRING    NOT NULL,      -- sent | failed | skipped
  error_message        STRING,
  matches_count        INT64,
  matches_json         JSON,                    -- full payload: postings + contacts + drafts
  exa_calls_used       INT64,
  clay_calls_used      INT64,
  enrichment_cost_usd  FLOAT64,
  sent_at              TIMESTAMP,
  created_at           TIMESTAMP
)
PARTITION BY DATE(sent_at)
OPTIONS (
  description = 'History of opportunity notifications sent to subscribers'
);
