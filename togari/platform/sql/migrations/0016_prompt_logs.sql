-- Prompt logs
-- Append-only record of every AI call: input, prompt, output, plus the processing
-- step that issued it. Used for retrospectives, prompt iteration, and debugging.

CREATE TABLE IF NOT EXISTS `togari_core.prompt_logs` (
  id                STRING    NOT NULL,
  tenant_id         STRING    NOT NULL,
  input             STRING,
  prompt            STRING,
  output            STRING,
  metadata          JSON,
  company_id        STRING,
  tiering_run_id    STRING,
  processing_step   STRING,
  created_at        TIMESTAMP NOT NULL,
  PRIMARY KEY (id) NOT ENFORCED
)
PARTITION BY DATE(created_at)
CLUSTER BY tenant_id, processing_step;
