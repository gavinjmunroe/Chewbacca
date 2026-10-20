-- =============================================================================
-- Migration: togari → togari_data_lake
-- Project: midyear-glazing-485303-u3
--
-- Run each statement one at a time in the BigQuery console.
-- After confirming data is correct in togari_data_lake, drop the togari dataset.
-- =============================================================================

-- STEP 0 — Create the new dataset (skip if it already exists)
-- Run via bq CLI or BigQuery console:
--   CREATE SCHEMA IF NOT EXISTS `midyear-glazing-485303-u3.togari_data_lake`;

-- =============================================================================
-- STEP 1 — Copy deals → togari_structured_deals (with deduplication)
-- =============================================================================
CREATE TABLE IF NOT EXISTS `midyear-glazing-485303-u3.togari_data_lake.togari_structured_deals` (
  deal_id          STRING    NOT NULL,
  client_id        STRING,
  deal_name        STRING,
  company          STRING,
  contact_ids      ARRAY<STRING>,
  value            FLOAT64,
  stage            STRING,
  pipeline         STRING,
  owner            STRING,
  close_date       DATE,
  notes            STRING,
  next_action      STRING,
  next_action_date DATE,
  created_at       TIMESTAMP,
  updated_at       TIMESTAMP
)
PARTITION BY DATE(created_at)
OPTIONS (
  description = 'Sales deals — one row per deal, partitioned by creation date. Migrated from togari.deals.'
);

-- Insert with deduplication (keep the most recently updated row per deal_id)
INSERT INTO `midyear-glazing-485303-u3.togari_data_lake.togari_structured_deals`
SELECT
  deal_id, client_id, deal_name, company, contact_ids,
  value, stage, pipeline, owner, close_date,
  notes, next_action, next_action_date, created_at, updated_at
FROM (
  SELECT
    *,
    ROW_NUMBER() OVER (PARTITION BY deal_id ORDER BY updated_at DESC) AS _rn
  FROM `midyear-glazing-485303-u3.togari.deals`
)
WHERE _rn = 1;

-- Verify row count
-- SELECT COUNT(*) AS total FROM `midyear-glazing-485303-u3.togari_data_lake.togari_structured_deals`;
-- SELECT COUNT(DISTINCT deal_id) AS unique_deals FROM `midyear-glazing-485303-u3.togari.deals`;

-- =============================================================================
-- STEP 2 — Copy activities (as-is)
-- =============================================================================
CREATE TABLE IF NOT EXISTS `midyear-glazing-485303-u3.togari_data_lake.activities` (
  activity_id  STRING    NOT NULL,
  deal_id      STRING,
  client_id    STRING,
  contact_id   STRING,
  type         STRING,
  content      STRING,
  timestamp    TIMESTAMP
)
PARTITION BY DATE(timestamp)
OPTIONS (
  description = 'Deal activity log (calls, emails, meetings, notes). Migrated from togari.activities.'
);

INSERT INTO `midyear-glazing-485303-u3.togari_data_lake.activities`
  (activity_id, deal_id, client_id, contact_id, type, content, timestamp)
SELECT
  activity_id, deal_id, client_id, contact_id, type, content, timestamp
FROM `midyear-glazing-485303-u3.togari.activities`;

-- =============================================================================
-- STEP 3 — Copy pilots (as-is)
-- =============================================================================
CREATE TABLE IF NOT EXISTS `midyear-glazing-485303-u3.togari_data_lake.pilots` (
  pilot_id          STRING    NOT NULL,
  deal_id           STRING,
  client_id         STRING,
  pilot_start       DATE,
  pilot_end         DATE,
  success_criteria  ARRAY<STRING>,
  milestones        JSON,
  status            STRING,
  health_score      FLOAT64,
  created_at        TIMESTAMP,
  updated_at        TIMESTAMP
)
OPTIONS (
  description = 'Pilot engagements linked to deals. Migrated from togari.pilots.'
);

INSERT INTO `midyear-glazing-485303-u3.togari_data_lake.pilots`
  (pilot_id, deal_id, client_id, pilot_start, pilot_end,
   success_criteria, milestones, status, health_score, created_at, updated_at)
SELECT
  pilot_id, deal_id, client_id, pilot_start, pilot_end,
  success_criteria, milestones, status, health_score, created_at, updated_at
FROM `midyear-glazing-485303-u3.togari.pilots`;

-- =============================================================================
-- STEP 4 — Copy pipeline_stages (as-is)
-- =============================================================================
CREATE TABLE IF NOT EXISTS `midyear-glazing-485303-u3.togari_data_lake.pipeline_stages` (
  stage_id      STRING    NOT NULL,
  client_id     STRING,
  stage_name    STRING,
  pipeline      STRING,
  stage_order   INT64,
  description   STRING,
  is_active     BOOL,
  auto_rules    JSON,
  created_at    TIMESTAMP,
  updated_at    TIMESTAMP
)
OPTIONS (
  description = 'Pipeline stage definitions. Migrated from togari.pipeline_stages.'
);

INSERT INTO `midyear-glazing-485303-u3.togari_data_lake.pipeline_stages`
  (stage_id, client_id, stage_name, pipeline, stage_order,
   description, is_active, auto_rules, created_at, updated_at)
SELECT
  stage_id, client_id, stage_name, pipeline, stage_order,
  description, is_active, auto_rules, created_at, updated_at
FROM `midyear-glazing-485303-u3.togari.pipeline_stages`;

-- =============================================================================
-- STEP 5 — Verify all data migrated
-- =============================================================================
-- Run these and compare counts:
-- SELECT 'togari.deals' AS src, COUNT(*) FROM `midyear-glazing-485303-u3.togari.deals`
-- UNION ALL
-- SELECT 'togari_data_lake.togari_structured_deals', COUNT(*) FROM `midyear-glazing-485303-u3.togari_data_lake.togari_structured_deals`
-- UNION ALL
-- SELECT 'togari.activities', COUNT(*) FROM `midyear-glazing-485303-u3.togari.activities`
-- UNION ALL
-- SELECT 'togari_data_lake.activities', COUNT(*) FROM `midyear-glazing-485303-u3.togari_data_lake.activities`
-- UNION ALL
-- SELECT 'togari.pilots', COUNT(*) FROM `midyear-glazing-485303-u3.togari.pilots`
-- UNION ALL
-- SELECT 'togari_data_lake.pilots', COUNT(*) FROM `midyear-glazing-485303-u3.togari_data_lake.pilots`
-- UNION ALL
-- SELECT 'togari.pipeline_stages', COUNT(*) FROM `midyear-glazing-485303-u3.togari.pipeline_stages`
-- UNION ALL
-- SELECT 'togari_data_lake.pipeline_stages', COUNT(*) FROM `midyear-glazing-485303-u3.togari_data_lake.pipeline_stages`;

-- =============================================================================
-- STEP 6 — Drop the old dataset (ONLY after verifying Step 5)
-- =============================================================================
-- DROP TABLE IF EXISTS `midyear-glazing-485303-u3.togari.deals`;
-- DROP TABLE IF EXISTS `midyear-glazing-485303-u3.togari.activities`;
-- DROP TABLE IF EXISTS `midyear-glazing-485303-u3.togari.pilots`;
-- DROP TABLE IF EXISTS `midyear-glazing-485303-u3.togari.pipeline_stages`;
-- DROP SCHEMA IF EXISTS `midyear-glazing-485303-u3.togari`;
