-- Personal Data Warehouse (PDW) — BigQuery DDL
-- Dataset: togari_pdw
-- 360-degree relationship mapping across Gmail, Fireflies, Google Drive, and Loom

CREATE SCHEMA IF NOT EXISTS `togari_pdw`
OPTIONS (location = 'US');

-- Central entity for every person in the relationship graph
CREATE TABLE IF NOT EXISTS `togari_pdw.persons` (
  person_id           STRING    NOT NULL,   -- SHA-256 of primary email
  owner_id            STRING    NOT NULL,   -- whose data warehouse this is (e.g. "sagar")
  full_name           STRING,
  email_addresses     ARRAY<STRING>,
  phone_numbers       ARRAY<STRING>,
  linkedin_url        STRING,
  company             STRING,
  title               STRING,
  relationship_score  FLOAT64,              -- 0-100
  last_interaction_at TIMESTAMP,
  first_interaction_at TIMESTAMP,
  interaction_count   INT64,
  tags                ARRAY<STRING>,
  metadata            JSON,
  created_at          TIMESTAMP             NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  updated_at          TIMESTAMP             NOT NULL DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE(updated_at)
CLUSTER BY owner_id, person_id;

-- Every touchpoint across all channels
CREATE TABLE IF NOT EXISTS `togari_pdw.interactions` (
  interaction_id          STRING    NOT NULL,
  owner_id                STRING    NOT NULL,
  person_id               STRING    NOT NULL,   -- FK to persons
  counterparty_person_ids ARRAY<STRING>,         -- other participants
  channel                 STRING,                -- gmail | fireflies | gdrive | loom | slack | linkedin | manual
  direction               STRING,                -- inbound | outbound | bilateral
  interaction_type        STRING,                -- email | meeting | document_share | video | call | message
  subject                 STRING,
  summary                 STRING,                -- AI-generated
  raw_content_gcs_uri     STRING,
  sentiment               FLOAT64,               -- -1 to 1
  topics                  ARRAY<STRING>,
  action_items            ARRAY<STRING>,
  duration_seconds        INT64,
  participants            ARRAY<STRING>,
  source_id               STRING,                -- original ID from source system
  source_metadata         JSON,
  occurred_at             TIMESTAMP              NOT NULL,
  ingested_at             TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE(occurred_at)
CLUSTER BY owner_id, person_id, channel;

-- Edges in the relationship graph
CREATE TABLE IF NOT EXISTS `togari_pdw.relationships` (
  relationship_id     STRING    NOT NULL,
  owner_id            STRING    NOT NULL,
  person_a_id         STRING    NOT NULL,
  person_b_id         STRING    NOT NULL,
  relationship_type   STRING,                -- colleague | prospect | partner | friend | vendor | advisor
  strength_score      FLOAT64,               -- 0-100
  total_interactions  INT64,
  last_interaction_at TIMESTAMP,
  first_interaction_at TIMESTAMP,
  shared_topics       ARRAY<STRING>,
  context_summary     STRING,
  metadata            JSON,
  created_at          TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  updated_at          TIMESTAMP              NOT NULL DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE(updated_at)
CLUSTER BY owner_id, person_a_id, person_b_id;

-- Track each data ingest job
CREATE TABLE IF NOT EXISTS `togari_pdw.ingestion_runs` (
  run_id              STRING    NOT NULL,
  owner_id            STRING    NOT NULL,
  source              STRING,                -- gmail | fireflies | gdrive | loom
  status              STRING,                -- running | completed | failed | partial
  records_processed   INT64,
  records_failed      INT64,
  started_at          TIMESTAMP              NOT NULL,
  completed_at        TIMESTAMP,
  error_message       STRING,
  watermark           STRING                 -- last processed ID/timestamp for incremental sync
)
PARTITION BY DATE(started_at)
CLUSTER BY owner_id, source;
