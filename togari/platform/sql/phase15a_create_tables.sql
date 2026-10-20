-- Phase 1.5a — Tenant-scoped user directory + reminder migration staging.
-- Dataset: togari_data_lake (alongside existing deals / activities).
-- Both tables are tenant-scoped; every query in the code path filters
-- on tenant_id. `tenant_id = 'bma'` is the default for Blue Modern Advisory.
--
-- This file is idempotent. Run via:
--   bq query --use_legacy_sql=false --project_id=midyear-glazing-485303-u3 \
--     < sql/phase15a_create_tables.sql
-- or via:
--   npx tsx src/scripts/bootstrap-1.5a.ts

-- ────────────────────────────────────────────────────────────────
-- 1. togari_data_lake.users  — the team directory
-- ────────────────────────────────────────────────────────────────
--
-- user_id is a stable UUID so that migrating transports (Slack →
-- iMessage → Teams) doesn't require re-keying every reminder. Every
-- per-transport identifier (slack_user_id today; imessage_id, teams_id
-- later) is a secondary column.

CREATE TABLE IF NOT EXISTS `midyear-glazing-485303-u3.togari_data_lake.users` (
  user_id              STRING    NOT NULL,
  tenant_id            STRING    NOT NULL,
  email                STRING,
  first_name           STRING,
  last_name            STRING,
  slack_user_id        STRING,
  slack_display_name   STRING,
  preferred_transport  STRING,
  timezone             STRING,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  updated_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP()
)
CLUSTER BY tenant_id, user_id;

-- ────────────────────────────────────────────────────────────────
-- 2. togari_data_lake.reminders_migration_staging
-- ────────────────────────────────────────────────────────────────
--
-- Captures every currently-scheduled reminder from every source medium
-- so 1.5c can migrate them to a consolidated schema without loss.
--
-- (source_medium, source_id) is the idempotency key — re-running the
-- capture script MUST NOT create duplicate rows (enforced by MERGE).

CREATE TABLE IF NOT EXISTS `midyear-glazing-485303-u3.togari_data_lake.reminders_migration_staging` (
  staging_id             STRING    NOT NULL,
  source_medium          STRING    NOT NULL,  -- slack_scheduled | bigquery | node_cron | cloud_tasks | other
  source_id              STRING    NOT NULL,
  original_creator       STRING,
  original_text          STRING,
  fire_at                TIMESTAMP,
  channel_or_recipient   STRING,
  raw_payload            JSON,
  captured_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP(),
  migrated_to_new_system BOOL      NOT NULL DEFAULT FALSE,
  migrated_at            TIMESTAMP
)
CLUSTER BY source_medium, source_id;
