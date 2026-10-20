-- Togari pending clarifications — persistent thread-scoped resume state
--
-- Replaces the in-memory `pendingClarifications` Map in
-- src/transports/slack/index.ts. When a tool returns status
-- 'needs_clarification', the runner inserts one row here keyed by
-- thread_ts. On the next user message in the same thread, the runner
-- checks this table first: if there's an unexpired matching row, it
-- merges the row's `partial_state` into the new request context so the
-- in-flight write completes from where the user left off.
--
-- Query pattern:
--   SELECT * FROM togari_pending_clarifications
--   WHERE thread_ts = @thread_ts
--     AND resolved_at IS NULL
--     AND expires_at > CURRENT_TIMESTAMP()
--   ORDER BY created_at DESC
--   LIMIT 1
--
-- expires_at defaults to created_at + 24h.

CREATE TABLE IF NOT EXISTS `midyear-glazing-485303-u3.togari_data_lake.togari_pending_clarifications` (
  clarification_id   STRING    NOT NULL,
  thread_ts          STRING    NOT NULL,
  channel_id         STRING,
  user_id            STRING,
  tenant_id          STRING    NOT NULL,
  original_message   STRING,
  partial_state      JSON,
  question_asked     STRING,
  tool_name          STRING,
  created_at         TIMESTAMP NOT NULL,
  expires_at         TIMESTAMP NOT NULL,
  resolved_at        TIMESTAMP,
  resolved_with      STRING,
  PRIMARY KEY (clarification_id) NOT ENFORCED
)
PARTITION BY DATE(created_at)
CLUSTER BY tenant_id, thread_ts;
