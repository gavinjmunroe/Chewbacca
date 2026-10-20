-- Add target_companies to opportunity_subscriptions
-- Allows subscribers to restrict signal monitoring to a specific list of companies.
--
-- Run against: midyear-glazing-485303-u3.togari_data_lake

ALTER TABLE `midyear-glazing-485303-u3.togari_data_lake.opportunity_subscriptions`
  ADD COLUMN IF NOT EXISTS target_companies ARRAY<STRING>
    OPTIONS (description = 'Optional list of specific company names to monitor; empty array means all companies');
