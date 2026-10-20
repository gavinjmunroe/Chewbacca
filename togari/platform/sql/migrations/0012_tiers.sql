-- Tiers
-- Output of a tiering run: per-company tier (1-4) + confidence + rationale.
-- Composite PK on (tiering_run_id, company_id) so a company can be re-scored in
-- successive runs and each result is kept.
-- `structured_rationale` is the typed object the agent emitted; `rationale` is the
-- human-readable summary.

CREATE TABLE IF NOT EXISTS `togari_core.tiers` (
  tiering_run_id        STRING    NOT NULL,
  company_id            STRING    NOT NULL,
  tenant_id             STRING    NOT NULL,
  tier                  INT64     NOT NULL,
  confidence_score      FLOAT64,
  rationale             STRING,
  structured_rationale  JSON,
  created_at            TIMESTAMP NOT NULL,
  PRIMARY KEY (tiering_run_id, company_id) NOT ENFORCED
)
CLUSTER BY tenant_id, tiering_run_id;
