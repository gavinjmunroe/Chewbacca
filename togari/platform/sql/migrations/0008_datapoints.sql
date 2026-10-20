-- Datapoints
-- Append-only fact table of discovered facts about a company
-- (e.g. revenue=12M, hq_state=TX, owner_age=58). Each row carries provenance
-- via source_type + source_evidence_url so analysts can audit.
--
-- Partitioned by ingestion day for cost efficiency; clustered by tenant + company + key
-- for the common access pattern "give me all datapoints for company X with key Y".

CREATE TABLE IF NOT EXISTS `togari_core.datapoints` (
  id                  STRING    NOT NULL,
  tenant_id           STRING    NOT NULL,
  company_id          STRING    NOT NULL,
  `key`               STRING    NOT NULL,
  value               STRING,
  source_type         STRING,
  source_evidence_url STRING,
  created_at          TIMESTAMP NOT NULL,
  PRIMARY KEY (id) NOT ENFORCED
)
PARTITION BY DATE(created_at)
CLUSTER BY tenant_id, company_id, `key`;
