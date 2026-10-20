-- DealCloud settings
-- Per-tenant cache of DealCloud configuration: entry-type IDs (discovered at first
-- connect, since they differ per DC tenant), mandate definitions, industry tree
-- (industry -> vertical -> sub-vertical via parent_id self-reference).
--
-- type values: 'entry_type' | 'mandate' | 'industry' | 'vertical' | 'sub_vertical'

CREATE TABLE IF NOT EXISTS `togari_core.dealcloud_settings` (
  id          STRING    NOT NULL,
  tenant_id   STRING    NOT NULL,
  type        STRING    NOT NULL,
  `key`       STRING    NOT NULL,
  value       STRING,
  parent_id   STRING,
  created_at  TIMESTAMP NOT NULL,
  PRIMARY KEY (id) NOT ENFORCED
)
CLUSTER BY tenant_id, type;
