-- Companies
-- Master record per company across all mandates and runs in a tenant.
-- `dc_id` is the DealCloud entry id when present (companies discovered via DC sync
-- or pushed there via XLSX import). `source_original` tracks discovery channel
-- (clay, grata, dealcloud, manual, etc.).

CREATE TABLE IF NOT EXISTS `togari_core.companies` (
  id                STRING    NOT NULL,
  tenant_id         STRING    NOT NULL,
  name              STRING    NOT NULL,
  website           STRING,
  address           STRING,
  dc_id             STRING,
  source_original   STRING,
  created_at        TIMESTAMP NOT NULL,
  updated_at        TIMESTAMP NOT NULL,
  PRIMARY KEY (id) NOT ENFORCED
)
CLUSTER BY tenant_id, website;
