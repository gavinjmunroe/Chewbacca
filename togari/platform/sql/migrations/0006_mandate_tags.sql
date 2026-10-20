-- Mandate tags
-- User-defined labels scoped to a mandate (e.g. "high-priority", "outreach-sent").

CREATE TABLE IF NOT EXISTS `togari_core.mandate_tags` (
  id          STRING    NOT NULL,
  tenant_id   STRING    NOT NULL,
  mandate_id  STRING    NOT NULL,
  name        STRING    NOT NULL,
  color       STRING,
  created_at  TIMESTAMP NOT NULL,
  PRIMARY KEY (id) NOT ENFORCED
)
CLUSTER BY tenant_id, mandate_id;
