-- =============================================================================
-- Row Access Policy Isolation Tests
-- Dataset: togari_data_lake
-- Project: midyear-glazing-485303-u3
--
-- Run each test block AS THE TENANT'S SERVICE ACCOUNT, not as an admin.
-- Admins bypass row access policies — the test is only valid when run
-- with the tenant SA credentials.
--
-- How to run as a tenant SA:
--   gcloud auth activate-service-account \
--     tenant-acme@midyear-glazing-485303-u3.iam.gserviceaccount.com \
--     --key-file=/path/to/tenant-acme-key.json
--   bq query --use_legacy_sql=false --project_id=midyear-glazing-485303-u3 \
--     "$(cat 03_test_isolation.sql)"
--
-- All tests below should return 0. Any non-zero result is a policy gap.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- TEST 1 — Tenant A cannot see Tenant B's rows in deals
-- Run as: tenant-acme SA
-- Expected: 0
-- -----------------------------------------------------------------------------
SELECT COUNT(*) AS cross_tenant_leak
FROM `midyear-glazing-485303-u3.togari_data_lake.togari_structured_deals`
WHERE client_id != 'acme';

-- -----------------------------------------------------------------------------
-- TEST 2 — Tenant A can only see their own rows in deals
-- Run as: tenant-acme SA
-- Expected: > 0 (if acme has deals), confirms policy is not blocking own data
-- -----------------------------------------------------------------------------
SELECT COUNT(*) AS own_rows_visible
FROM `midyear-glazing-485303-u3.togari_data_lake.togari_structured_deals`
WHERE client_id = 'acme';

-- -----------------------------------------------------------------------------
-- TEST 3 — Cross-tenant leak check across all tables
-- Run as: tenant-acme SA
-- Expected: all counts = 0
-- -----------------------------------------------------------------------------
SELECT 'deals' AS table_name,
       COUNT(*)
FROM `midyear-glazing-485303-u3.togari_data_lake.togari_structured_deals`
WHERE client_id != 'acme'

UNION ALL

SELECT 'activities',
       COUNT(*)
FROM `midyear-glazing-485303-u3.togari_data_lake.activities`
WHERE client_id != 'acme'

UNION ALL

SELECT 'pilots',
       COUNT(*)
FROM `midyear-glazing-485303-u3.togari_data_lake.pilots`
WHERE client_id != 'acme'

UNION ALL

SELECT 'pipeline_stages',
       COUNT(*)
FROM `midyear-glazing-485303-u3.togari_data_lake.pipeline_stages`
WHERE client_id != 'acme';

-- Add UNION ALL blocks here as new tables are created.

-- -----------------------------------------------------------------------------
-- TEST 4 — Confirm row access policies are active on each table
-- Run as: admin (project owner)
-- Expected: each table shows at least one policy
-- -----------------------------------------------------------------------------
SELECT table_catalog, table_schema, table_name, policy_name, grantee_list
FROM `midyear-glazing-485303-u3.togari_data_lake`.INFORMATION_SCHEMA.ROW_ACCESS_POLICIES
ORDER BY table_name, policy_name;

-- -----------------------------------------------------------------------------
-- TEST 5 — Verify tenant A cannot write a row with tenant B's client_id
-- Run as: tenant-acme SA
-- Expected: 0 rows inserted (BigQuery will reject or silently filter on DML)
-- Note: BigQuery row access policies block DML to non-visible rows.
-- -----------------------------------------------------------------------------
-- INSERT INTO `midyear-glazing-485303-u3.togari_data_lake.togari_structured_deals`
--   (deal_id, client_id, deal_name, company, pipeline, stage, owner,
--    next_action, next_action_date, created_at, updated_at)
-- VALUES
--   (GENERATE_UUID(), 'other-tenant', 'Fake Deal', 'Evil Corp',
--    'outbound', 'contacted', 'hacker',
--    'steal data', DATE('2026-01-01'),
--    CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP());
-- Verify: SELECT COUNT(*) FROM deals WHERE client_id = 'other-tenant';
-- Expected: 0

-- =============================================================================
-- REMEDIATION — If any test returns non-zero
-- =============================================================================
-- 1. Check that the row access policy exists:
--    SELECT * FROM INFORMATION_SCHEMA.ROW_ACCESS_POLICIES
--    WHERE table_name = '<table>' AND policy_name LIKE '%acme%';
--
-- 2. If missing, re-run 01_row_access_policies.sql for the affected table.
--
-- 3. Confirm you are running tests as the tenant SA, not as an admin.
--    Admin roles (bigquery.admin, roles/owner) bypass all row access policies.
-- =============================================================================
