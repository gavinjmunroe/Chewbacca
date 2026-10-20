-- Opportunity Engine V2: Signal Subscriptions + One-Time Data Pulls
-- Run against: midyear-glazing-485303-u3.togari_data_lake
--
-- Changes:
--   1. Add signal subscription columns to opportunity_subscriptions
--   2. Create signal_subscriptions VIEW (new name, same data)
--   3. Create data_pull_requests table (one-time ad hoc pulls)
--   4. Create signal_results table (per-run results history)

-- ─── Step 1: Add V2 columns to existing opportunity_subscriptions ────────

ALTER TABLE `midyear-glazing-485303-u3.togari_data_lake.opportunity_subscriptions`
  ADD COLUMN IF NOT EXISTS signal_query STRING;

ALTER TABLE `midyear-glazing-485303-u3.togari_data_lake.opportunity_subscriptions`
  ADD COLUMN IF NOT EXISTS monitor_frequency STRING DEFAULT 'daily';

ALTER TABLE `midyear-glazing-485303-u3.togari_data_lake.opportunity_subscriptions`
  ADD COLUMN IF NOT EXISTS companies_limit INT64;

ALTER TABLE `midyear-glazing-485303-u3.togari_data_lake.opportunity_subscriptions`
  ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMP;

ALTER TABLE `midyear-glazing-485303-u3.togari_data_lake.opportunity_subscriptions`
  ADD COLUMN IF NOT EXISTS total_matches_found INT64 DEFAULT 0;

-- ─── Step 2: Create signal_subscriptions VIEW ────────────────────────────
-- BigQuery does not support ALTER TABLE RENAME. This view provides the new
-- name while preserving the original table for existing queries.

CREATE VIEW IF NOT EXISTS `midyear-glazing-485303-u3.togari_data_lake.signal_subscriptions` AS
SELECT * FROM `midyear-glazing-485303-u3.togari_data_lake.opportunity_subscriptions`;

-- ─── Step 3: Create data_pull_requests table ─────────────────────────────

CREATE TABLE IF NOT EXISTS `midyear-glazing-485303-u3.togari_data_lake.data_pull_requests` (
  pull_id                STRING    NOT NULL,
  client_id              STRING    NOT NULL,
  natural_language_query STRING    NOT NULL,
  requested_count        INT64,
  datalake_matches       INT64     DEFAULT 0,
  enrichment_needed      INT64     DEFAULT 0,
  status                 STRING    DEFAULT 'pending',   -- pending | processing | ready | delivered
  csv_url                STRING,
  cost_usd               FLOAT64   DEFAULT 0,
  stripe_checkout_id     STRING,
  created_at             TIMESTAMP,
  updated_at             TIMESTAMP
)
PARTITION BY DATE(created_at)
OPTIONS (
  description = 'One-time data pull requests — ad hoc contact list exports with per-pull Stripe checkout'
);

-- ─── Step 4: Create signal_results table ─────────────────────────────────

CREATE TABLE IF NOT EXISTS `midyear-glazing-485303-u3.togari_data_lake.signal_results` (
  result_id              STRING    NOT NULL,
  subscription_id        STRING    NOT NULL,
  matched_contacts       JSON,                          -- ContactMatch[] serialized
  exa_results            JSON,                          -- ExaResult[] serialized
  new_since_last_run     INT64     DEFAULT 0,
  created_at             TIMESTAMP
)
PARTITION BY DATE(created_at)
OPTIONS (
  description = 'Signal subscription run results — one row per scheduled signal execution'
);
