-- =============================================================================
-- BigQuery Row Access Policies — Multi-Tenant Isolation
-- Dataset: togari_data_lake
-- Project: midyear-glazing-485303-u3
--
-- MCP Service Account: togari-mcp-midyear-glazing-485@midyear-glazing-485303-u3.iam.gserviceaccount.com
-- Current tenant: bma (Blue Monitor Advisory)
--
-- Naming convention: rap_<table>_<tenant_slug>
-- See 02_grant_new_tenant.sql for the per-tenant grant template.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- DEALS
-- -----------------------------------------------------------------------------
-- DROP ALL ROW ACCESS POLICIES ON `midyear-glazing-485303-u3.togari_data_lake.togari_structured_deals`;

CREATE ROW ACCESS POLICY rap_deals_bma
  ON `midyear-glazing-485303-u3.togari_data_lake.togari_structured_deals`
  GRANT TO (
    "serviceAccount:togari-mcp-midyear-glazing-485@midyear-glazing-485303-u3.iam.gserviceaccount.com",
    "domain:bluemodernadvisory.com"
  )
  FILTER USING (client_id = 'bma');

-- -----------------------------------------------------------------------------
-- ACTIVITIES
-- -----------------------------------------------------------------------------
-- DROP ALL ROW ACCESS POLICIES ON `midyear-glazing-485303-u3.togari_data_lake.activities`;

CREATE ROW ACCESS POLICY rap_activities_bma
  ON `midyear-glazing-485303-u3.togari_data_lake.activities`
  GRANT TO (
    "serviceAccount:togari-mcp-midyear-glazing-485@midyear-glazing-485303-u3.iam.gserviceaccount.com",
    "domain:bluemodernadvisory.com"
  )
  FILTER USING (client_id = 'bma');

-- -----------------------------------------------------------------------------
-- PILOTS
-- -----------------------------------------------------------------------------
-- DROP ALL ROW ACCESS POLICIES ON `midyear-glazing-485303-u3.togari_data_lake.pilots`;

CREATE ROW ACCESS POLICY rap_pilots_bma
  ON `midyear-glazing-485303-u3.togari_data_lake.pilots`
  GRANT TO (
    "serviceAccount:togari-mcp-midyear-glazing-485@midyear-glazing-485303-u3.iam.gserviceaccount.com",
    "domain:bluemodernadvisory.com"
  )
  FILTER USING (client_id = 'bma');

-- -----------------------------------------------------------------------------
-- PIPELINE_STAGES
-- -----------------------------------------------------------------------------
-- DROP ALL ROW ACCESS POLICIES ON `midyear-glazing-485303-u3.togari_data_lake.pipeline_stages`;

CREATE ROW ACCESS POLICY rap_pipeline_stages_bma
  ON `midyear-glazing-485303-u3.togari_data_lake.pipeline_stages`
  GRANT TO (
    "serviceAccount:togari-mcp-midyear-glazing-485@midyear-glazing-485303-u3.iam.gserviceaccount.com",
    "domain:bluemodernadvisory.com"
  )
  FILTER USING (client_id = 'bma');

-- -----------------------------------------------------------------------------
-- CONTACTS (no client_id column — restrict table-level access via TRUE filter)
-- -----------------------------------------------------------------------------
-- DROP ALL ROW ACCESS POLICIES ON `midyear-glazing-485303-u3.togari_data_lake.togari_structured_contacts`;

CREATE ROW ACCESS POLICY rap_contacts_bma
  ON `midyear-glazing-485303-u3.togari_data_lake.togari_structured_contacts`
  GRANT TO (
    "serviceAccount:togari-mcp-midyear-glazing-485@midyear-glazing-485303-u3.iam.gserviceaccount.com",
    "domain:bluemodernadvisory.com"
  )
  FILTER USING (TRUE);

-- =============================================================================
-- FUTURE TABLES — uncomment each block once the table is created
-- =============================================================================

-- CREATE ROW ACCESS POLICY rap_enrichments_bma
--   ON `midyear-glazing-485303-u3.togari_data_lake.enrichments`
--   GRANT TO ("serviceAccount:togari-mcp-midyear-glazing-485@midyear-glazing-485303-u3.iam.gserviceaccount.com")
--   FILTER USING (client_id = 'bma');

-- =============================================================================
-- NOTES
-- =============================================================================
-- 1. Policies apply to SELECT and DML — tenants cannot read or write
--    another tenant's rows even with table-level dataEditor role.
-- 2. Tables with NO policy are fully visible to anyone with table access.
--    Always create policies before granting tenant SAs table access.
-- 3. Admins (bigquery.admin, roles/owner) bypass row access policies.
--    Never use admin credentials for tenant service accounts.
-- 4. To update a policy: DROP ALL ROW ACCESS POLICIES ON <table>, then recreate.
-- 5. All deals must have client_id set (e.g. 'bma') or they will be invisible
--    to the MCP service account.
-- =============================================================================
