-- Migration 001: Expand audit_log with per-tool invocation tracking columns
-- Run once against the existing table in BigQuery console.
-- BigQuery supports adding columns to a partitioned table without data loss.
-- Existing rows will have NULL for all new columns — this is expected.

ALTER TABLE `midyear-glazing-485303-u3.togari_data_lake.audit_log`
  ADD COLUMN IF NOT EXISTS user_id     STRING,
  ADD COLUMN IF NOT EXISTS tool_name   STRING,
  ADD COLUMN IF NOT EXISTS tokens_used INT64,
  ADD COLUMN IF NOT EXISTS cost_usd    FLOAT64,
  ADD COLUMN IF NOT EXISTS duration_ms INT64,
  ADD COLUMN IF NOT EXISTS success     BOOL;
