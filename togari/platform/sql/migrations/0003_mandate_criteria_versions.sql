-- Mandate criteria versions
-- Each mandate has a history of criteria specs; one is active at a time
-- (referenced by mandates.active_criteria_version_id).

CREATE TABLE IF NOT EXISTS `togari_core.mandate_criteria_versions` (
  id                STRING    NOT NULL,
  tenant_id         STRING    NOT NULL,
  mandate_id        STRING    NOT NULL,
  version_number    INT64     NOT NULL,
  spec_text         STRING,
  key_data_points   JSON,
  created_at        TIMESTAMP NOT NULL,
  PRIMARY KEY (id) NOT ENFORCED
)
CLUSTER BY tenant_id, mandate_id;
