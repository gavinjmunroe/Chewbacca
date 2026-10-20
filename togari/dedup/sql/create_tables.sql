-- BigQuery DDL for Togari GTM OS
-- Dataset: togari_data_lake
-- Project: midyear-glazing-485303-u3
-- Run each statement individually in the BigQuery console, or via:
--   bq query --use_legacy_sql=false < sql/create_tables.sql

-- ─────────────────────────────────────────────
-- 1. deals
-- stage:    researching | contacted | conversation_started | discovery_scheduled |
--           discovery_complete | proposal_sent | negotiating | verbal_commit |
--           contract_sent | closed_won | closed_lost
-- pipeline: partnerships | inbound | outbound
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `midyear-glazing-485303-u3.togari_data_lake.togari_structured_deals` (
  deal_id        STRING    NOT NULL,
  client_id      STRING,
  deal_name      STRING,
  company        STRING,
  contact_ids    ARRAY<STRING>,              -- repeated: linked contact UUIDs
  value          FLOAT64,
  stage          STRING,                     -- enum: see header comment
  pipeline       STRING,                     -- enum: partnerships | inbound | outbound
  owner          STRING,
  close_date     DATE,
  notes          STRING,
  next_action    STRING,
  next_action_date DATE,
  created_at     TIMESTAMP,
  updated_at     TIMESTAMP,
  -- Contact fields (merged from external deals)
  contact_full_name  STRING,
  contact_first_name STRING,
  contact_last_name  STRING,
  contact_email      STRING,
  contact_linkedin   STRING,
  -- Deal metadata (merged from external deals)
  deal_source        STRING,
  deal_duration      STRING,
  deal_amount_cycle  STRING
)
PARTITION BY DATE(created_at)
OPTIONS (
  description = 'Sales deals — one row per deal, partitioned by creation date'
);

-- ─────────────────────────────────────────────
-- 2. activities
-- type: call | email | meeting | note
-- Partitioned by DATE(timestamp) — the primary time column for activities
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `midyear-glazing-485303-u3.togari_data_lake.activities` (
  activity_id  STRING    NOT NULL,
  deal_id      STRING,
  client_id    STRING,
  contact_id   STRING,
  type         STRING,                       -- enum: call | email | meeting | note
  content      STRING,
  timestamp    TIMESTAMP
)
PARTITION BY DATE(timestamp)
OPTIONS (
  description = 'Deal activity log (calls, emails, meetings, notes), partitioned by activity timestamp'
);

-- ─────────────────────────────────────────────
-- 3. pilots
-- milestones stored as native BigQuery JSON type
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `midyear-glazing-485303-u3.togari_data_lake.pilots` (
  pilot_id          STRING    NOT NULL,
  deal_id           STRING,
  client_id         STRING,
  pilot_start       DATE,
  pilot_end         DATE,
  success_criteria  ARRAY<STRING>,           -- repeated: list of success criteria strings
  milestones        JSON,                    -- flexible milestone tracking (native JSON type)
  status            STRING,
  health_score      FLOAT64,
  created_at        TIMESTAMP,
  updated_at        TIMESTAMP
)
OPTIONS (
  description = 'Pilot engagements linked to deals, with milestones and health tracking'
);

-- ─────────────────────────────────────────────
-- 4. pipeline_stages  (config / lookup table)
-- pipeline: partnerships | inbound | outbound
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `midyear-glazing-485303-u3.togari_data_lake.pipeline_stages` (
  stage_id      STRING    NOT NULL,
  client_id     STRING,
  stage_name    STRING,
  pipeline      STRING,                      -- enum: partnerships | inbound | outbound
  stage_order   INT64,                       -- sort order within a pipeline
  description   STRING,
  is_active     BOOL,
  auto_rules    JSON,                        -- automation rules for stage transitions
  created_at    TIMESTAMP,
  updated_at    TIMESTAMP
)
OPTIONS (
  description = 'Config table defining pipeline stage definitions and ordering'
);

-- ─────────────────────────────────────────────
-- 5. contacts
-- Data lives in togari_structured_contacts
-- Originally imported from gs://togari_contacts/raw_json_uploads/
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `midyear-glazing-485303-u3.togari_data_lake.togari_structured_contacts` (
  linkedinUrl     STRING,
  fullName        STRING,
  firstName       STRING,
  lastName        STRING,
  workEmail       STRING,
  phone           STRING,
  currentTitle    STRING,
  currentCompany  STRING,
  companyDomain   STRING,
  createdAt       TIMESTAMP
)
OPTIONS (
  description = 'Contact records — 42,754 contacts imported from GCS JSON backup'
);

-- ─────────────────────────────────────────────
-- 6. audit_log
-- Fire-and-forget audit trail for MCP tool invocations
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `midyear-glazing-485303-u3.togari_data_lake.audit_log` (
  client_id      STRING,
  user_id        STRING,
  tool_name      STRING,
  tokens_used    INT64,
  cost_usd       FLOAT64,
  duration_ms    INT64,
  success        BOOL,
  error_message  STRING,
  timestamp      TIMESTAMP
)
PARTITION BY DATE(timestamp)
OPTIONS (
  description = 'Audit log for MCP tool invocations — streaming inserts from audit-logger.ts'
);

-- ─────────────────────────────────────────────
-- 7. enrichments
-- Contact enrichment results from Clay, Exa, Structify APIs
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `midyear-glazing-485303-u3.togari_data_lake.enrichments` (
  enrichment_id       STRING    NOT NULL,
  client_id           STRING,
  contact_id          STRING,                    -- workEmail or linkedinUrl of the contact
  company_domain      STRING,
  clay_company        JSON,                      -- Clay company enrichment (revenue, headcount, tech_stack)
  clay_contact        JSON,                      -- Clay contact enrichment (verified email, phone, seniority)
  exa_news            JSON,                      -- Exa search results (company news, funding, launches)
  structify_normalized JSON,                     -- Normalized combined result
  source_apis         ARRAY<STRING>,             -- which APIs were called: clay, exa, structify
  cost_usd            FLOAT64,
  status              STRING,                    -- success | partial | failed
  error_message       STRING,
  enriched_at         TIMESTAMP,
  created_at          TIMESTAMP
)
PARTITION BY DATE(enriched_at)
OPTIONS (
  description = 'Contact enrichment results from Clay, Exa, Structify APIs'
);

-- ─────────────────────────────────────────────
-- 8. lead_lists
-- Named lead lists created by analytics_run_pipeline
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `midyear-glazing-485303-u3.togari_data_lake.lead_lists` (
  list_id        STRING    NOT NULL,
  client_id      STRING,
  list_name      STRING,
  contact_email  STRING,
  contact_name   STRING,
  company        STRING,
  title          STRING,
  persona        STRING,                         -- A | B | C buyer persona
  icp_score      FLOAT64,                        -- 0-100 ICP fit score
  enriched       BOOL,
  created_at     TIMESTAMP
)
PARTITION BY DATE(created_at)
OPTIONS (
  description = 'Named lead lists created by analytics_run_pipeline'
);
