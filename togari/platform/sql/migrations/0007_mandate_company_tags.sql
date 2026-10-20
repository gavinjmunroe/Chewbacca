-- Mandate company tags
-- Many-to-many between (mandate, company) pairs and tags.

CREATE TABLE IF NOT EXISTS `togari_core.mandate_company_tags` (
  mandate_id  STRING NOT NULL,
  company_id  STRING NOT NULL,
  tag_id      STRING NOT NULL,
  tenant_id   STRING NOT NULL,
  PRIMARY KEY (mandate_id, company_id, tag_id) NOT ENFORCED
)
CLUSTER BY tenant_id, mandate_id;
