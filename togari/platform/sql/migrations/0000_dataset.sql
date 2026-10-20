-- Togari Core dataset
-- Houses platform-level tables: mandates, runs, companies, contacts, costs, integrations.
-- Tenant isolation is enforced at the application layer via tenant_id columns; every
-- query in the app must filter by tenant_id. BigQuery does not support row-level security
-- the way Postgres does, so this is an app-layer contract for v1.

CREATE SCHEMA IF NOT EXISTS `togari_core`
OPTIONS (location = 'US');
