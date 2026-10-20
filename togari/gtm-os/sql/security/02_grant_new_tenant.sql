-- =============================================================================
-- Grant New Tenant Access — Template
-- Dataset: togari_data_lake
-- Project: midyear-glazing-485303-u3
--
-- Run this block whenever a new tenant is onboarded.
-- Replace ALL occurrences of:
--   'new-tenant'  → the tenant slug  (e.g. 'beta-health')
--   'tenant-new-tenant@...' → the tenant's GCP service account email
--
-- Steps:
--   1. Create the GCP service account for the tenant (in GCP Console or gcloud)
--   2. Grant the SA table-level BigQuery roles (below)
--   3. Create row access policies for each table (below)
--   4. Run the isolation test in 03_test_isolation.sql to verify
-- =============================================================================

-- -----------------------------------------------------------------------------
-- STEP 1 — Grant table-level roles to the tenant service account
-- (Run via gcloud or GCP Console IAM — BigQuery SQL cannot grant project roles)
-- -----------------------------------------------------------------------------
-- gcloud projects add-iam-policy-binding midyear-glazing-485303-u3 \
--   --member="serviceAccount:tenant-new-tenant@midyear-glazing-485303-u3.iam.gserviceaccount.com" \
--   --role="roles/bigquery.dataEditor"
--
-- gcloud projects add-iam-policy-binding midyear-glazing-485303-u3 \
--   --member="serviceAccount:tenant-new-tenant@midyear-glazing-485303-u3.iam.gserviceaccount.com" \
--   --role="roles/bigquery.jobUser"

-- -----------------------------------------------------------------------------
-- STEP 2 — Create row access policies for the new tenant
-- Replace 'new-tenant' and the SA email throughout.
-- -----------------------------------------------------------------------------

CREATE ROW ACCESS POLICY rap_deals_new_tenant
  ON `midyear-glazing-485303-u3.togari_data_lake.togari_structured_deals`
  GRANT TO ("serviceAccount:tenant-new-tenant@midyear-glazing-485303-u3.iam.gserviceaccount.com")
  FILTER USING (client_id = 'new-tenant');

CREATE ROW ACCESS POLICY rap_activities_new_tenant
  ON `midyear-glazing-485303-u3.togari_data_lake.activities`
  GRANT TO ("serviceAccount:tenant-new-tenant@midyear-glazing-485303-u3.iam.gserviceaccount.com")
  FILTER USING (client_id = 'new-tenant');

CREATE ROW ACCESS POLICY rap_pilots_new_tenant
  ON `midyear-glazing-485303-u3.togari_data_lake.pilots`
  GRANT TO ("serviceAccount:tenant-new-tenant@midyear-glazing-485303-u3.iam.gserviceaccount.com")
  FILTER USING (client_id = 'new-tenant');

CREATE ROW ACCESS POLICY rap_pipeline_stages_new_tenant
  ON `midyear-glazing-485303-u3.togari_data_lake.pipeline_stages`
  GRANT TO ("serviceAccount:tenant-new-tenant@midyear-glazing-485303-u3.iam.gserviceaccount.com")
  FILTER USING (client_id = 'new-tenant');

-- Uncomment as additional tables are created:
-- CREATE ROW ACCESS POLICY rap_contacts_new_tenant ...
-- CREATE ROW ACCESS POLICY rap_lead_lists_new_tenant ...
-- CREATE ROW ACCESS POLICY rap_enrichments_new_tenant ...
-- CREATE ROW ACCESS POLICY rap_outreach_sequences_new_tenant ...
-- CREATE ROW ACCESS POLICY rap_audit_log_new_tenant ...

-- -----------------------------------------------------------------------------
-- STEP 3 — Verify (see 03_test_isolation.sql for full test suite)
-- -----------------------------------------------------------------------------
-- Run as the NEW tenant's service account:
--   SELECT COUNT(*) FROM `midyear-glazing-485303-u3.togari_data_lake.togari_structured_deals`
--   WHERE client_id != 'new-tenant';
-- Expected result: 0 rows
