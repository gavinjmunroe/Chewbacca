-- Mandates
-- A mandate is a buy-side search thesis (e.g. "midmarket precision machining roll-ups in TX").
-- References `tenants.id` (not enforced).
-- `active_criteria_version_id` references `mandate_criteria_versions.id` (not enforced).

CREATE TABLE IF NOT EXISTS `togari_core.mandates` (
  id                          STRING    NOT NULL,
  tenant_id                   STRING    NOT NULL,
  name                        STRING    NOT NULL,
  context                     STRING,
  active_criteria_version_id  STRING,
  tool_settings               JSON,
  is_deleted                  BOOL      NOT NULL,
  created_at                  TIMESTAMP NOT NULL,
  updated_at                  TIMESTAMP NOT NULL,
  PRIMARY KEY (id) NOT ENFORCED
)
CLUSTER BY tenant_id;
