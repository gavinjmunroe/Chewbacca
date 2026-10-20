-- Cost logs
-- Append-only ledger of every paid call the platform makes: AI tokens and external APIs.
-- service_type: ai | google_places | zoominfo | enformion | exa | crustdata | perplexity | grata
-- operation: business_overview | tier_result | image_analysis | relevance_check | person_search | etc.
-- model: the AI model id when service_type='ai' (e.g. 'gpt-5-mini', 'openai/gpt-5.4').
-- total_cost_cents is INT64; the worker computes this from pricing_config in admin_settings.

CREATE TABLE IF NOT EXISTS `togari_core.cost_logs` (
  id                  STRING    NOT NULL,
  tenant_id           STRING    NOT NULL,
  tiering_run_id      STRING,
  enrichment_run_id   STRING,
  company_id          STRING,
  service_type        STRING    NOT NULL,
  operation           STRING    NOT NULL,
  model               STRING,
  input_tokens        INT64,
  output_tokens       INT64,
  total_cost_cents    INT64     NOT NULL,
  metadata            JSON,
  created_at          TIMESTAMP NOT NULL,
  PRIMARY KEY (id) NOT ENFORCED
)
PARTITION BY DATE(created_at)
CLUSTER BY tenant_id, service_type;
