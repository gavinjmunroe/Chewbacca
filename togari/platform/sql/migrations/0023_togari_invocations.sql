-- Togari tool-use loop invocations audit log
-- One row per `runClaudeLoop` invocation triggered by the Togari tool-use
-- runner (src/core/tool-use-runner.ts). Persists the full tool-call trace
-- alongside the final response so post-hoc audit, debugging, and the
-- "what did Togari just do" conversation-memory feature can query it.
--
-- The dataset is the per-tenant data lake. Tables are created on demand
-- per tenant — see sql/phase15a_create_tables.sql for the pattern.
--
-- tools_called is JSON: array of objects with shape
--   { name: string, input: object, output: object|string,
--     duration_ms: number, status: 'ok'|'error'|'needs_clarification' }
-- final_response is the assistant's final text (after the loop ended).
-- iteration_count is the number of /v1/messages roundtrips that ran.

CREATE TABLE IF NOT EXISTS `midyear-glazing-485303-u3.togari_data_lake.togari_invocations` (
  invocation_id          STRING    NOT NULL,
  user_id                STRING,
  channel_id             STRING,
  thread_ts              STRING,
  tenant_id              STRING    NOT NULL,
  original_message       STRING,
  tools_called           JSON,
  final_response         STRING,
  iteration_count        INT64,
  started_at             TIMESTAMP NOT NULL,
  completed_at           TIMESTAMP,
  error_text             STRING,
  total_input_tokens     INT64,
  total_output_tokens    INT64,
  PRIMARY KEY (invocation_id) NOT ENFORCED
)
PARTITION BY DATE(started_at)
CLUSTER BY tenant_id, user_id;
