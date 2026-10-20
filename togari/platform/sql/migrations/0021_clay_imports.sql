-- Clay imports
-- Audit log for inbound Clay webhook ingestions (Tab 5 writes here).
-- payload_hash is sha256(canonicalJSON(payload)); used by Tab 5 to dedupe replays.
-- Composite uniqueness on (tenant_id, clay_run_id) is enforced at app layer:
-- Tab 5's persister does a SELECT-then-INSERT pattern; BQ has no unique constraints.

CREATE TABLE IF NOT EXISTS `togari_core.clay_imports` (
  id              STRING    NOT NULL,
  tenant_id       STRING    NOT NULL,
  clay_run_id     STRING    NOT NULL,
  clay_table_id   STRING,
  mandate_id      STRING,
  payload_hash    STRING    NOT NULL,
  total_records   INT64,
  company_count   INT64,
  contact_count   INT64,
  status          STRING    NOT NULL,
  error_message   STRING,
  received_at     TIMESTAMP NOT NULL,
  processed_at    TIMESTAMP,
  PRIMARY KEY (id) NOT ENFORCED
)
PARTITION BY DATE(received_at)
CLUSTER BY tenant_id, status;
