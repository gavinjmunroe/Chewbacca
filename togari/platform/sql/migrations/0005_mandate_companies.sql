-- Mandate companies
-- Join table between mandates and companies. A company can be on many mandates.
-- Soft-delete semantics: removed_at IS NULL means active. Re-adding flips removed_at
-- back to NULL rather than inserting a duplicate row.

CREATE TABLE IF NOT EXISTS `togari_core.mandate_companies` (
  mandate_id        STRING    NOT NULL,
  company_id        STRING    NOT NULL,
  tenant_id         STRING    NOT NULL,
  source_original   STRING,
  added_at          TIMESTAMP NOT NULL,
  removed_at        TIMESTAMP,
  PRIMARY KEY (mandate_id, company_id) NOT ENFORCED
)
CLUSTER BY tenant_id, mandate_id;
