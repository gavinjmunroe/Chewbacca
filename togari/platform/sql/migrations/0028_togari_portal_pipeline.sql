-- 0028_togari_portal_pipeline.sql
--
-- New tables backing the Clay-outbound flagship, the Joe client portal
-- (DNC submissions + opportunity emails), and the agentic custom-field
-- schema registry. All land in togari_data_lake (the canonical dataset).
-- Tenancy key is client_id (the decided canonical key). Raw submissions
-- are preserved; custom fields are additive rows, never DDL.
--
-- Apply: bq query --use_legacy_sql=false --project_id=$GCP_PROJECT_ID < this_file
-- These are all net-new empty tables; nothing existing is altered.

-- ── Clay flagship: Rytual audience distribution target ────────────────
CREATE TABLE IF NOT EXISTS `togari_data_lake.rytual_audience` (
  audience_id     STRING    NOT NULL,
  client_id       STRING,
  email           STRING,
  full_name       STRING,
  company         STRING,
  company_domain  STRING,
  source          STRING,
  added_at        TIMESTAMP NOT NULL
)
CLUSTER BY client_id, email;

-- ── Joe portal: raw do-not-contact submissions (preserve original) ────
CREATE TABLE IF NOT EXISTS `togari_data_lake.dnc_submissions` (
  submission_id   STRING    NOT NULL,
  client_id       STRING,
  submitted_by    STRING,
  raw_json        JSON,
  free_text       STRING,
  suppressed_count INT64,
  status          STRING,        -- received | processed | failed
  created_at      TIMESTAMP NOT NULL
)
PARTITION BY DATE(created_at)
CLUSTER BY client_id, status;

-- ── Joe portal: opportunity-email request lifecycle ──────────────────
CREATE TABLE IF NOT EXISTS `togari_data_lake.opportunity_requests` (
  request_id      STRING    NOT NULL,
  client_id       STRING,
  subscriber_email STRING,
  subscription_id STRING,
  status          STRING,        -- requested | drafted | approved | sent | failed
  subject         STRING,
  body            STRING,
  message_id      STRING,
  created_at      TIMESTAMP NOT NULL,
  updated_at      TIMESTAMP
)
PARTITION BY DATE(created_at)
CLUSTER BY client_id, status;

-- ── Agentic schema registry: custom field definitions ────────────────
-- Custom fields are modeled as rows, not real columns, so a natural
-- language "reorganize my data" never runs destructive DDL and raw data
-- is always preserved.
CREATE TABLE IF NOT EXISTS `togari_data_lake.custom_field_defs` (
  field_id        STRING    NOT NULL,
  client_id       STRING    NOT NULL,
  entity          STRING    NOT NULL,   -- deal | contact | company | ...
  field_name      STRING    NOT NULL,
  field_type      STRING    NOT NULL,   -- string | number | date | bool | json
  description     STRING,
  is_active       BOOL,
  created_at      TIMESTAMP NOT NULL
)
CLUSTER BY client_id, entity;

-- ── Agentic schema registry: custom field values ─────────────────────
CREATE TABLE IF NOT EXISTS `togari_data_lake.custom_field_values` (
  value_id        STRING    NOT NULL,
  client_id       STRING    NOT NULL,
  entity          STRING    NOT NULL,
  entity_id       STRING    NOT NULL,
  field_id        STRING,
  field_name      STRING    NOT NULL,
  value_string    STRING,
  value_number    FLOAT64,
  value_bool      BOOL,
  value_json      JSON,
  updated_at      TIMESTAMP NOT NULL
)
CLUSTER BY client_id, entity, entity_id;
