-- Tiering runs
-- One row per tiering job (a batch of companies being scored against a mandate).
-- Status lifecycle: pending -> queued -> running -> completed | failed | paused | stopped.
-- `priority` + `preempted_by` support the queued-status preemption model from autotier.
-- Cost columns are denormalized aggregations of cost_logs, refreshed by the worker.

CREATE TABLE IF NOT EXISTS `togari_core.tiering_runs` (
  id                    STRING    NOT NULL,
  tenant_id             STRING    NOT NULL,
  mandate_id            STRING    NOT NULL,
  criteria_version_id   STRING,
  status                STRING    NOT NULL,
  mode                  STRING,
  tool_settings         JSON,
  priority              INT64,
  preempted_by          STRING,
  total_cost_cents      INT64,
  cost_breakdown        JSON,
  key_data_points       JSON,
  started_at            TIMESTAMP,
  finished_at           TIMESTAMP,
  error_message         STRING,
  created_at            TIMESTAMP NOT NULL,
  PRIMARY KEY (id) NOT ENFORCED
)
PARTITION BY DATE(created_at)
CLUSTER BY tenant_id, status;
