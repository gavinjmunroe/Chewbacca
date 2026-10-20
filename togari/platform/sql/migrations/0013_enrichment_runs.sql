-- Enrichment runs
-- Sibling of tiering_runs for contact-discovery jobs. Mode is sequential | agent;
-- agent_summary captures the final natural-language audit log the agent produced.

CREATE TABLE IF NOT EXISTS `togari_core.enrichment_runs` (
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
  agent_summary         STRING,
  started_at            TIMESTAMP,
  finished_at           TIMESTAMP,
  error_message         STRING,
  created_at            TIMESTAMP NOT NULL,
  PRIMARY KEY (id) NOT ENFORCED
)
PARTITION BY DATE(created_at)
CLUSTER BY tenant_id, status;
